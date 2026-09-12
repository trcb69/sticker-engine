/**
 * A fully wired app with every side effect stubbed.
 *
 * No process is spawned, no file is written, no socket is opened. Everything
 * the routes touch arrives through `deps`, which is what makes that possible.
 */

import { readFileSync } from 'node:fs';
import { createApp } from '../../src/http/app.js';
import { createJobStore } from '../../src/store/jobStore.js';
import { createMemoryFileStore } from '../../src/store/files.js';
import { createExtractor, createPopplerReader } from '../../src/ingest/extract.js';
import { parsePicklist } from '../../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../../src/ingest/parseSampleNote.js';
import { parseSalesOrder } from '../../src/ingest/parseSalesOrder.js';
import { joinToJob } from '../../src/ingest/join.js';
import { enrichJob } from '../../src/enrich/enrichJob.js';
import {
  createShortLinkService, createXgdProvider, createMemoryStore,
  createSelfHostedProvider, createManualProvider,
} from '../../src/enrich/shortlink.js';
import { resolve as resolveTemplate } from '../../src/template/schema.js';
import { emit } from '../../src/render/zpl.js';
import { guard } from '../../src/render/guard.js';
import { loadConfig } from '../../src/config.js';
import { createPrinterClient } from '../../src/net/printer.js';
import { createPrintQueue } from '../../src/net/printQueue.js';
import { createAuditLog } from '../../src/audit/auditLog.js';
import { createRunService } from '../../src/print/runService.js';
import { renderContext } from '../../src/http/serialise.js';

export const read = (name) =>
  readFileSync(new URL(`./${name}.txt`, import.meta.url), 'utf8');

const templateSource = JSON.parse(
  readFileSync(new URL('../../src/template/label-4x1.json', import.meta.url), 'utf8'),
);

/** A minimal but valid PDF header, so magic-byte sniffing passes. */
export const pdf = (marker) => Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from(marker, 'utf8'),
]);

export const png = () => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

/**
 * @param {{ env?: object, texts?: Record<string, string>, poppler?: Function,
 *           printers?: Function, xgd?: Function, ttlSeconds?: number,
 *           now?: () => number }} [options]
 */
export function buildApp(options = {}) {
  // Network transport unless a test asks otherwise. Production defaults to
  // `browser`, because every operator's Zebra is on USB — but the print tests
  // written before that existed are network tests, and they should keep
  // exercising the network path without every one of them having to say so.
  const config = loadConfig({
    env: { STICKER_PRINT_TRANSPORT: 'network', ...(options.env ?? {}) },
  });
  const logs = [];
  const logger = {
    info: (entry) => logs.push({ level: 'info', ...entry }),
    warn: (entry) => logs.push({ level: 'warn', ...entry }),
    error: (entry) => logs.push({ level: 'error', ...entry }),
  };

  const fileStore = createMemoryFileStore();

  // Whatever bytes were staged decide which fixture the "PDF" contains. The
  // marker is written into the buffer by the test.
  const texts = options.texts ?? {
    picklist: read('picklist-PL-76120'),
    sampleNote: read('sample-note-RSMINV26091087'),
    salesOrder: read('sales-order-RSMSO26090032'),
  };

  const extractor = createExtractor({
    readers: [createPopplerReader({
      run: async (command, args) => {
        if (command.endsWith('pdfinfo')) return { stdout: 'Pages:          1\n', stderr: '' };
        const buffer = fileStore.files.get(args[1]);
        const marker = buffer.subarray(9).toString('utf8');
        if (!(marker in texts)) throw new Error(`no fixture for ${marker}`);
        return { stdout: texts[marker], stderr: '' };
      },
    })],
  });

  let seed = 11;

  // Provider selection mirrors src/server.js, so a test that sets
  // STICKER_SHORT_BASE or clears the key exercises the provider the real
  // service would have chosen. A harness that always wires x.gd would let
  // health claim one thing while the service does another.
  const stubbedXgd = () => createXgdProvider({
    apiKey: config.xgdApiKey ?? '0af50e06255c7004f9ad71338f5ad56e',
    fetch: options.xgd ?? (async (url) => {
      const q = new URL(url).searchParams;
      return { json: async () => ({ status: 200, shorturl: `https://x.gd/${q.get('shortid')}` }) };
    }),
  });
  const provider = () => {
    if (options.provider) return options.provider;
    if (config.shortBase) return createSelfHostedProvider({ baseUrl: config.shortBase });
    if (options.noShortener) return createManualProvider();
    return stubbedXgd();
  };

  const shortLinks = createShortLinkService({
    provider: provider(),
    store: createMemoryStore(),
    random: () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; },
    now: () => '2026-09-06T00:00:00.000Z',
  });

  const jobStore = createJobStore({
    fileStore,
    ttlSeconds: options.ttlSeconds ?? config.jobTtlSeconds,
    now: options.now,
    logger,
    io: { mkdir: async () => {}, writeFile: async () => {}, readFile: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } },
  });


  const templateCache = new Map();
  const templateFor = (dpi) => {
    if (!templateCache.has(dpi)) templateCache.set(dpi, resolveTemplate(templateSource, dpi));
    return templateCache.get(dpi);
  };
  const template = templateFor;

  // A printer that records what it was sent, so route tests can assert on the
  // wire without a socket.
  const sent = [];
  const transport = options.transport ?? {
    async send(printer, payload) { sent.push({ printer: printer.name ?? printer.host, payload }); },
    async ask() { return options.askReply ?? ''; },
  };
  const printers = options.printers ?? { wh1: { host: '10.0.0.5', port: 9100, dpi: 203 } };
  const printerClient = createPrinterClient({
    transport, printers, logoZpl: options.logoZpl ?? '~DGR:LOGO.GRF,4,1,\nFFFF\n', logger,
  });
  const queue = createPrintQueue({ logger });

  const auditEntries = [];
  const auditLog = createAuditLog({
    path: '/audit.jsonl',
    now: () => '2026-09-06T00:00:00.000Z',
    io: {
      mkdir: async () => {},
      appendFile: async (_path, line) => auditEntries.push(JSON.parse(line)),
      readFile: async () => (auditEntries.length
        ? auditEntries.map((e) => JSON.stringify(e)).join('\n') + '\n'
        : (() => { const e = new Error('x'); e.code = 'ENOENT'; throw e; })()),
    },
  });

  let runCounter = 0;
  const runs = createRunService({
    printerClient, queue, auditLog, emit, renderContext, logger,
    template: (dpi) => templateFor(dpi),
    id: () => `t${++runCounter}`,
    now: () => '2026-09-06T00:00:00.000Z',
  });

  const app = createApp({
    config, logger, jobStore, fileStore, shortLinks, template, emit, guard, extractor,
    runs,
    parsers: { picklist: parsePicklist, sampleNote: parseSampleNote, salesOrder: parseSalesOrder },
    join: (documents) => joinToJob(documents),
    enrich: (job, deps) => enrichJob(job, deps),
    probes: {
      poppler: options.poppler ?? (async () => ({ ok: true, detail: 'pdftotext 22.02.0' })),
      printers: options.printers ?? (async () => ({ ok: true, detail: 'No printers configured yet', printers: {} })),
    },
  });

  return {
    app, config, jobStore, fileStore, shortLinks, logs,
    sent, auditEntries, runs, printerClient, queue, transport,
  };
}
