import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExtractor, createPopplerReader } from '../src/ingest/extract.js';
import { parsePicklist } from '../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../src/ingest/parseSampleNote.js';
import { parseSalesOrder } from '../src/ingest/parseSalesOrder.js';
import { joinToJob } from '../src/ingest/join.js';
import { enrichJob } from '../src/enrich/enrichJob.js';
import {
  createShortLinkService, createXgdProvider, createMemoryStore,
} from '../src/enrich/shortlink.js';
import { resolve as resolveTemplate } from '../src/template/schema.js';
import { emit } from '../src/render/zpl.js';
import { guard, isPrintable } from '../src/render/guard.js';
import { loadConfig } from '../src/config.js';
import { field, textOf } from '../src/model/types.js';
import { formatQuantity } from '../src/model/qty.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');

const PARSERS = {
  picklist: parsePicklist,
  sampleNote: parseSampleNote,
  salesOrder: parseSalesOrder,
};

/** Uploads in, one job out, with no process ever spawned. */
async function ingest(files, config) {
  const texts = new Map(files.map((f) => [f.path, f.text]));
  const extractor = createExtractor({
    readers: [createPopplerReader({
      run: async (command, args) => (command.endsWith('pdfinfo')
        ? { stdout: 'Pages:          1\n', stderr: '' }
        : { stdout: texts.get(args[1]), stderr: '' }),
    })],
  });

  /** @type {Record<string, object|undefined>} */
  const parsed = {};
  for (const file of files) {
    const extracted = await extractor.extract(file.path);
    parsed[extracted.kind] = PARSERS[extracted.kind](extracted.layoutText, {
      dateOrder: config.dateOrder,
    });
  }
  return joinToJob(parsed, { id: 'job-e2e', now: '2026-09-06T00:00:00.000Z' });
}

test('uploads become one job, classified without being told which is which', async () => {
  const config = loadConfig({ env: {} });
  const { job, buckets, warnings } = await ingest([
    { path: '/tmp/a.pdf', text: read('picklist-PL-76120') },
    { path: '/tmp/b.pdf', text: read('sample-note-RSMINV26091087') },
  ], config);

  assert.equal(job.source.sampleNoteNo, 'RSMINV26091087');
  assert.equal(job.source.picklistNo, 'PL-76120');
  assert.equal(textOf(job.customer), 'Jay Jay Mills Lanka (PVT) Ltd');
  assert.equal(job.lines.length, 6);
  assert.equal(buckets.matched.length, 6);
  assert.deepEqual(warnings, []);
  assert.ok(job.lines.every((l) => l.status === 'incomplete'),
    'nothing is ready until the operator supplies dates and a batch code');
});

test('all three document types are recognised from the same upload path', async () => {
  const config = loadConfig({ env: {} });
  const extractor = createExtractor({
    readers: [createPopplerReader({
      run: async (command, args) => (command.endsWith('pdfinfo')
        ? { stdout: 'Pages:          1\n', stderr: '' }
        : { stdout: read(args[1].replace(/\.pdf$/, '')), stderr: '' }),
    })],
  });
  const expected = {
    'picklist-PL-76120': 'picklist',
    'sample-note-RSMINV26091087': 'sampleNote',
    'sales-order-RSMSO26090032': 'salesOrder',
  };
  for (const [fixture, kind] of Object.entries(expected)) {
    const result = await extractor.extract(`${fixture}.pdf`);
    assert.equal(result.kind, kind, fixture);
  }
  assert.equal(config.dateOrder, 'MDY');
});

test('upload order does not matter', async () => {
  const config = loadConfig({ env: {} });
  const forwards = await ingest([
    { path: '/tmp/a.pdf', text: read('sample-note-RSMINV26091087') },
    { path: '/tmp/b.pdf', text: read('picklist-PL-76120') },
  ], config);
  const backwards = await ingest([
    { path: '/tmp/b.pdf', text: read('picklist-PL-76120') },
    { path: '/tmp/a.pdf', text: read('sample-note-RSMINV26091087') },
  ], config);
  assert.deepEqual(forwards.job.source, backwards.job.source);
  assert.deepEqual(forwards.buckets.matched, backwards.buckets.matched);
});

test('a job goes from documents to printable ZPL with a scannable QR', async () => {
  const config = loadConfig({ env: {} });
  const { job: joined } = await ingest([
    { path: '/tmp/a.pdf', text: read('picklist-PL-76120') },
    { path: '/tmp/b.pdf', text: read('sample-note-RSMINV26091087') },
  ], config);

  // The five things only the operator can supply.
  joined.manufacturer = field('Miscellaneous Supplier', 'manual');
  const target = joined.lines[0];
  target.mnfDate = field('05/2026', 'manual');
  target.expDate = field('05/2028', 'manual');
  target.batchCode = field('JUR260725', 'manual');

  const { job, warnings } = enrichJob(joined, { config });
  const line = job.lines[0];
  assert.equal(line.status, 'ready');
  assert.equal(textOf(line.displayName), 'FW-777-Hybrid White', 'verbatim from the Picklist');
  assert.equal(formatQuantity(textOf(line.qtyAmount), textOf(line.qtyUom)), '0.30KG');
  assert.ok(!warnings.some((w) => w.severity === 'error'));

  // The ClickUp link is shortened through x.gd before anything is printed.
  let seed = 7;
  const shortLinks = createShortLinkService({
    provider: createXgdProvider({
      apiKey: '0af50e06255c7004f9ad71338f5ad56e',
      fetch: async (url) => {
        const q = new URL(url).searchParams;
        return { json: async () => ({ status: 200, shorturl: `https://x.gd/${q.get('shortid')}` }) };
      },
    }),
    store: createMemoryStore(),
    random: () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; },
  });
  const link = await shortLinks.mint('https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC');
  assert.ok(link.plan.magnification >= 3, 'confirmed scannable before printing');

  const template = resolveTemplate(
    JSON.parse(readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8')),
    203,
  );
  const { zpl, placed } = emit(template, {
    customer: job.customer,
    docNo: job.docNo,
    manufacturer: job.manufacturer,
    displayName: line.displayName,
    qtyText: field(formatQuantity(textOf(line.qtyAmount), textOf(line.qtyUom)), 'extracted'),
    mnfDate: line.mnfDate,
    expDate: line.expDate,
    batchCode: line.batchCode,
    qrPayload: field(link.qrPayload, 'derived'),
  }, { copies: 1 });

  assert.equal(isPrintable(guard(placed)), true, JSON.stringify(guard(placed)));
  assert.ok(zpl.includes('FW-777-Hybrid White'));
  assert.ok(zpl.includes('QTY :- 0.30KG'));
  assert.ok(zpl.includes('MANUFACTURER - Miscellaneous Supplier'));
  assert.ok(zpl.includes('JUR260725'), 'the batch code, exactly as typed');
  assert.ok(zpl.includes(link.qrPayload));
  assert.match(zpl, /\^BCN,48,Y,N,N/, 'native barcode, text below the bars');
});
