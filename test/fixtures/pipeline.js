/**
 * The whole pipeline as one function: fixture documents in, ZPL out.
 *
 * Shared by the end-to-end test and the golden generator so both exercise the
 * identical path. If they differed, the golden would be checking something the
 * test does not run.
 */

import { readFileSync } from 'node:fs';
import { parsePicklist } from '../../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../../src/ingest/parseSampleNote.js';
import { joinToJob } from '../../src/ingest/join.js';
import { enrichJob } from '../../src/enrich/enrichJob.js';
import { loadConfig } from '../../src/config.js';
import { resolve as resolveTemplate } from '../../src/template/schema.js';
import { emit } from '../../src/render/zpl.js';
import { guard } from '../../src/render/guard.js';
import { renderContext } from '../../src/http/serialise.js';
import { field } from '../../src/model/types.js';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

/** What an operator supplies. Fixed values so the output is reproducible. */
const MANUAL = {
  manufacturer: 'Miscellaneous Supplier',
  qrPayload: 'HTTPS://X.GD/HFH7K2',
  qrEcc: 'Q',
  lines: {
    1: { mnfDate: '05/2026', expDate: '05/2028', batchCode: 'JUR260721', copies: 1 },
    2: { mnfDate: '05/2026', expDate: '05/2028', batchCode: 'JUR260722', copies: 3 },
    5: { mnfDate: '11/2026', expDate: '11/2027', batchCode: 'REA260901', copies: 2 },
  },
};

/**
 * @param {{ dpi?: number }} [options]
 */
export function buildPipelineJob(options = {}) {
  const config = loadConfig({ env: {} });

  const joined = joinToJob({
    sampleNote: parseSampleNote(read('sample-note-RSMINV26091087.txt'), { dateOrder: config.dateOrder }),
    picklist: parsePicklist(read('picklist-PL-76120.txt'), { dateOrder: config.dateOrder }),
  }, { id: 'job-golden', now: '2026-09-06T00:00:00.000Z' });

  joined.job.manufacturer = field(MANUAL.manufacturer, 'manual');
  joined.job.qrPayload = field(MANUAL.qrPayload, 'derived');
  joined.job.qrPlan = { ecc: MANUAL.qrEcc, modules: 29, magnification: 3 };

  for (const line of joined.job.lines) {
    const manual = MANUAL.lines[line.index];
    if (!manual) continue;
    line.mnfDate = field(manual.mnfDate, 'manual');
    line.expDate = field(manual.expDate, 'manual');
    line.batchCode = field(manual.batchCode, 'manual');
    line.copies = manual.copies;
  }

  const enriched = enrichJob(joined.job, { config });
  return { ...enriched, joinWarnings: joined.warnings, buckets: joined.buckets };
}

/**
 * @param {{ dpi?: number }} [options]
 * @returns {Promise<string>}
 */
export async function buildPipelineZpl(options = {}) {
  const dpi = options.dpi ?? 203;
  const { job } = buildPipelineJob();
  const raw = JSON.parse(readFileSync(new URL('../../src/template/label-4x1.json', import.meta.url), 'utf8'));
  const template = resolveTemplate(raw, dpi);

  return job.lines
    .filter((line) => line.status === 'ready')
    .map((line) => emit(template, renderContext(job, line), { copies: line.copies }).zpl)
    .join('');
}

/** Guard warnings for every ready line, for the end-to-end assertions. */
export function pipelineWarnings(dpi = 203) {
  const { job } = buildPipelineJob();
  const raw = JSON.parse(readFileSync(new URL('../../src/template/label-4x1.json', import.meta.url), 'utf8'));
  const template = resolveTemplate(raw, dpi);
  return job.lines
    .filter((line) => line.status === 'ready')
    .map((line) => ({
      index: line.index,
      warnings: guard(emit(template, renderContext(job, line), { copies: line.copies }).placed),
    }));
}
