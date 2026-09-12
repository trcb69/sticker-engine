import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrichJob } from '../src/enrich/enrichJob.js';
import { loadConfig } from '../src/config.js';
import { parsePicklist } from '../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../src/ingest/parseSampleNote.js';
import { joinToJob } from '../src/ingest/join.js';
import { field, isPresent, textOf } from '../src/model/types.js';
import { formatQuantity } from '../src/model/qty.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const config = loadConfig({ env: {} });

const baseJob = () => joinToJob({
  sampleNote: parseSampleNote(read('sample-note-RSMINV26091087.txt'), { dateOrder: 'MDY' }),
  picklist: parsePicklist(read('picklist-PL-76120.txt'), { dateOrder: 'MDY' }),
}, { id: 'job-1', now: '2026-09-06T00:00:00.000Z' }).job;

const run = (job = baseJob(), cfg = config) => enrichJob(job, { config: cfg });
const codes = (warnings) => warnings.map((w) => w.code);

/* -- Name and quantity come straight off the document --------------------- */

test('the item name is the Picklist description, printed verbatim', () => {
  const { job } = run();
  assert.deepEqual(
    job.lines.map((l) => textOf(l.displayName)),
    ['FW-777-Hybrid White', 'FC-777 Hybrid Clear', '8700T Clear Paste',
      '8700W White Paste', 'REACTANT E-10', 'PES 2072 100-200'],
  );
  assert.equal(job.lines[0].displayName.provenance, 'extracted', 'not derived — nothing was looked up');
});

test('the quantity keeps the numeral and unit the Picklist stated', () => {
  const line = run().job.lines[0];
  assert.equal(textOf(line.qtyAmount), '0.30');
  assert.equal(textOf(line.qtyUom), 'kg');
  assert.equal(formatQuantity(textOf(line.qtyAmount), textOf(line.qtyUom)), '0.30KG');
});

test('a volume line prints as a volume, with no conversion either way', () => {
  const job = baseJob();
  job.lines[0].qtyAmount = field('310', 'extracted');
  job.lines[0].qtyUom = field('ml', 'extracted');
  const line = run(job).job.lines[0];
  assert.equal(formatQuantity(textOf(line.qtyAmount), textOf(line.qtyUom)), '310ML');
});

test('a quantity with no unit on the Picklist is flagged, not guessed at', () => {
  const job = baseJob();
  job.lines[0].qtyUom = { value: null, provenance: 'missing' };
  const result = run(job);
  const warning = result.warnings.find((w) => w.code === 'QTY_UNIT_MISSING');
  assert.equal(warning.line, 1);
  assert.match(warning.message, /print without one/);
});

/* -- Manufacturer --------------------------------------------------------- */

test('the manufacturer is defaulted and tagged derived', () => {
  const { job } = run();
  assert.equal(textOf(job.manufacturer), 'Miscellaneous Supplier');
  assert.equal(job.manufacturer.provenance, 'derived');
});

test('a pasted manufacturer is not overwritten', () => {
  const job = baseJob();
  job.manufacturer = field('Acme Chemicals Ltd', 'manual');
  const { job: enriched } = run(job);
  assert.equal(textOf(enriched.manufacturer), 'Acme Chemicals Ltd');
  assert.equal(enriched.manufacturer.provenance, 'manual');
});

test('a configured default replaces the built-in one', () => {
  const custom = loadConfig({ env: { STICKER_DEFAULT_MANUFACTURER: 'Standard Holdings' } });
  assert.equal(textOf(run(baseJob(), custom).job.manufacturer), 'Standard Holdings');
});

test('with no default and nothing pasted, the operator is told', () => {
  const none = loadConfig({ env: { STICKER_DEFAULT_MANUFACTURER: '' } });
  const result = run(baseJob(), none);
  assert.ok(codes(result.warnings).includes('MANUFACTURER_MISSING'));
});

/* -- Dates ---------------------------------------------------------------- */

test('dates are typed by hand and are not derived from anything', () => {
  const line = run().job.lines[0];
  assert.equal(isPresent(line.mnfDate), false);
  assert.equal(isPresent(line.expDate), false);
  assert.match(line.expDate.note, /Entered by the operator/);
});

test('a date not in MM/YYYY form warns but still prints as entered', () => {
  const job = baseJob();
  job.lines[0].mnfDate = field('May 2026', 'manual');
  const result = run(job);
  assert.ok(codes(result.warnings).includes('MNF_DATE_FORMAT'));
  assert.equal(textOf(result.job.lines[0].mnfDate), 'May 2026', 'unchanged');
});

test('an expiry before the manufacture date is an error, not a warning', () => {
  const job = baseJob();
  job.lines[0].mnfDate = field('05/2026', 'manual');
  job.lines[0].expDate = field('05/2025', 'manual');
  const warning = run(job).warnings.find((w) => w.code === 'EXPIRY_BEFORE_MANUFACTURE');
  assert.equal(warning.severity, 'error');
  assert.match(warning.message, /One of the two dates is wrong/);
});

test('a valid date pair raises nothing, including across a year boundary', () => {
  const job = baseJob();
  job.lines[0].mnfDate = field('11/2026', 'manual');
  job.lines[0].expDate = field('02/2027', 'manual');
  assert.ok(!codes(run(job).warnings).includes('EXPIRY_BEFORE_MANUFACTURE'));
});

/* -- Readiness ------------------------------------------------------------ */

test('a line is ready only when all five required fields are present', () => {
  const job = baseJob();
  const target = job.lines[0];
  assert.equal(run(job).job.lines[0].status, 'incomplete', 'name and quantity alone are not enough');

  target.mnfDate = field('05/2026', 'manual');
  assert.equal(run(job).job.lines[0].status, 'incomplete');

  target.expDate = field('05/2028', 'manual');
  assert.equal(run(job).job.lines[0].status, 'incomplete', 'still no batch code');

  target.batchCode = field('JUR260725', 'manual');
  const ready = run(job).job.lines[0];
  assert.equal(ready.status, 'ready');
  for (const key of ['displayName', 'qtyAmount', 'mnfDate', 'expDate', 'batchCode']) {
    assert.equal(isPresent(ready[key]), true, key);
  }
});

/* -- Batch codes ---------------------------------------------------------- */

test('any batch code is accepted, because it is pasted from outside the system', () => {
  const job = baseJob();
  job.lines[0].batchCode = field('lot 44/b (drum 3)', 'manual');
  const result = run(job);
  assert.equal(textOf(result.job.lines[0].batchCode), 'lot 44/b (drum 3)');
  assert.ok(!codes(result.warnings).some((c) => c.startsWith('BATCH_')));
});

test('a configured pattern turns the format check back on', () => {
  const strict = loadConfig({ env: { STICKER_BATCH_PATTERN: '^[A-Z]{3}\\d{6}$' } });
  const job = baseJob();
  job.lines[0].batchCode = field('JUR26O725', 'manual');
  const result = run(job, strict);
  assert.equal(textOf(result.job.lines[0].batchCode), 'JUR26O725', 'still printed as typed');
  const warning = result.warnings.find((w) => w.code === 'BATCH_CONFUSABLE_CHARACTER');
  assert.equal(warning.detail.suggestion, 'JUR260725');
});

test('a batch code reused across two different items is flagged either way', () => {
  const job = baseJob();
  job.lines[0].batchCode = field('JUR260725', 'manual');
  job.lines[1].batchCode = field('JUR260725', 'manual');
  const warning = run(job).warnings.find((w) => w.code === 'BATCH_DUPLICATE');
  assert.deepEqual(warning.detail.lines, [1, 2]);
  assert.match(warning.message, /breaks traceability/);
});

/* -- Idempotence ---------------------------------------------------------- */

test('enriching twice changes nothing', () => {
  const once = run();
  const twice = enrichJob(once.job, { config });
  assert.deepEqual(twice.job, once.job);
  assert.deepEqual(twice.warnings, once.warnings);
});
