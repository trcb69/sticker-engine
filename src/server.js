#!/usr/bin/env node
/**
 * Service entry point.
 *
 * Configuration is validated before anything is constructed, so a bad
 * deployment fails at boot with every problem listed rather than at the first
 * upload with one of them.
 */

import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { createPopplerProbe, createPrinterProbe } from './http/probes.js';
import { createJobStore } from './store/jobStore.js';
import { createDiskFileStore } from './store/files.js';
import { createExtractor, createPopplerReader } from './ingest/extract.js';
import { parsePicklist } from './ingest/parsePicklist.js';
import { parseSampleNote } from './ingest/parseSampleNote.js';
import { parseSalesOrder } from './ingest/parseSalesOrder.js';
import { joinToJob } from './ingest/join.js';
import { enrichJob } from './enrich/enrichJob.js';
import {
  createShortLinkService, createXgdProvider, createManualProvider, createJsonFileStore,
  createSelfHostedProvider,
} from './enrich/shortlink.js';
import { resolve as resolveTemplate } from './template/schema.js';
import { emit } from './render/zpl.js';
import { guard } from './render/guard.js';
import { renderContext } from './http/serialise.js';
import { createPrinterClient, createSocketTransport } from './net/printer.js';
import { createPrintQueue } from './net/printQueue.js';
import { createAuditLog } from './audit/auditLog.js';
import { createRunService } from './print/runService.js';

/** Structured JSON on stdout. PM2 captures it; nothing needs parsing. */
const logger = {
  info: (entry) => process.stdout.write(`${JSON.stringify({ level: 'info', ...entry })}\n`),
  warn: (entry) => process.stdout.write(`${JSON.stringify({ level: 'warn', ...entry })}\n`),
  error: (entry) => process.stderr.write(`${JSON.stringify({ level: 'error', ...entry })}\n`),
};

const config = loadConfig({ logger });

const templateSource = JSON.parse(
  await readFile(new URL('./template/label-4x1.json', import.meta.url), 'utf8'),
);
/** @type {Map<number, object>} */
const templateCache = new Map();
const template = (dpi) => {
  if (!templateCache.has(dpi)) templateCache.set(dpi, resolveTemplate(templateSource, dpi));
  return templateCache.get(dpi);
};

const fileStore = createDiskFileStore(config.tmpDir);
const jobStore = createJobStore({
  fileStore,
  ttlSeconds: config.jobTtlSeconds,
  archiveDir: config.archiveDir,
  logger,
});
jobStore.startSweeper();

// Self-hosted first. A printed drum label has to resolve years from now, and
// the only redirect we can promise that of is our own — no API key, no rate
// limit, no third party that can disappear. x.gd stays available for the
// stronger error correction a shorter domain would buy; with neither set,
// minting is refused and a hand-shortened link can still be adopted.
const shortLinkProvider = () => {
  if (config.shortBase) return createSelfHostedProvider({ baseUrl: config.shortBase });
  if (config.xgdApiKey) {
    return createXgdProvider({ apiKey: config.xgdApiKey, analytics: config.xgdAnalytics });
  }
  return createManualProvider();
};

const shortLinks = createShortLinkService({
  provider: shortLinkProvider(),
  store: createJsonFileStore(config.shortLinkStorePath),
  budgetDots: config.qrBudgetDots,
  maxModules: config.qrMaxModules,
});

// The logo is read once at boot. If it is missing the labels still print, they
// just have a blank square where the mark should be — so this warns loudly
// rather than failing, because a run without a logo beats no run at all.
let logoZpl = null;
try {
  logoZpl = await readFile(new URL('../assets/logo-store.zpl', import.meta.url), 'utf8');
} catch {
  logger.warn({
    event: 'logo.missing',
    detail: 'assets/logo-store.zpl was not found; labels will print without the logo. '
      + 'Regenerate it with: sticker logo assets/logo-solid-144.png --out assets/logo-store.zpl',
  });
}

const printerClient = createPrinterClient({
  transport: createSocketTransport(),
  printers: config.printers,
  logoZpl,
  logger,
});
const queue = createPrintQueue({ logger });
const auditLog = createAuditLog({ path: config.auditLogPath });
const runs = createRunService({
  printerClient, queue, auditLog, emit, template, renderContext, logger,
});

const app = createApp({
  config,
  logger,
  jobStore,
  fileStore,
  shortLinks,
  template,
  emit,
  guard,
  extractor: createExtractor({
    readers: [createPopplerReader({ binDir: config.popplerBinDir })],
  }),
  parsers: { picklist: parsePicklist, sampleNote: parseSampleNote, salesOrder: parseSalesOrder },
  join: (documents) => joinToJob(documents),
  enrich: (job, deps) => enrichJob(job, deps),
  runs,
  probes: {
    poppler: createPopplerProbe({ binDir: config.popplerBinDir }),
    printers: createPrinterProbe({ printers: config.printers }),
  },
});

const server = app.listen(config.port, config.host, () => {
  logger.info({ event: 'server.listening', host: config.host, port: config.port });
});

/**
 * PM2 sends SIGINT on restart. Finishing in-flight requests matters here:
 * a request cut off mid-upload leaves a staged file with no job to own it.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info({ event: 'server.stopping', signal });
    jobStore.stopSweeper();
    // Let any label already on its way to a printer finish. Cutting a job
    // mid-stream leaves a Zebra parsing half a label.
    queue.drain().catch(() => {});
    server.close(() => {
      logger.info({ event: 'server.stopped' });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
