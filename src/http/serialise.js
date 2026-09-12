/**
 * Wire representation of a job.
 *
 * The provenance summary is computed here rather than left to the client. It is
 * the thing the operator's screen is built around — "9 of 11 extracted, 2 need
 * input" — and every client that renders a job needs the same answer, so it
 * should not be recomputed three different ways.
 */

import { isPresent, summariseProvenance } from '../model/types.js';
import { formatQuantity } from '../model/qty.js';

const JOB_FIELDS = ['customer', 'docNo', 'manufacturer', 'qrUrl', 'qrShortCode'];
const LINE_FIELDS = ['displayName', 'qtyAmount', 'qtyUom', 'mnfDate', 'expDate', 'batchCode'];

/**
 * @param {import('../store/jobStore.js').StoredJob} record
 * @returns {object}
 */
export function serialiseJob(record) {
  const { job } = record;
  return {
    id: job.id,
    createdAt: job.createdAt,
    source: job.source,
    customer: job.customer,
    docNo: job.docNo,
    manufacturer: job.manufacturer,
    qrUrl: job.qrUrl,
    qrShortCode: job.qrShortCode,
    // The payload and its symbol plan are exposed so a client can show the
    // operator that the code will scan before anything reaches a printer.
    qrPayload: job.qrPayload ?? null,
    qrPlan: job.qrPlan ?? null,
    lines: job.lines.map(serialiseLine),
    buckets: record.buckets,
    warnings: record.warnings,
    enrichWarnings: record.enrichWarnings,
    provenance: provenanceSummary(job),
    readiness: {
      total: job.lines.length,
      ready: job.lines.filter((line) => line.status === 'ready').length,
    },
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

/**
 * @param {import('../model/types.js').LabelLine} line
 */
export function serialiseLine(line) {
  return {
    index: line.index,
    displayName: line.displayName,
    qtyAmount: line.qtyAmount,
    qtyUom: line.qtyUom,
    // Precomputed so preview, print and UI all show the same string, rather
    // than each assembling it and drifting.
    qtyText: isPresent(line.qtyAmount)
      ? formatQuantity(line.qtyAmount.value, isPresent(line.qtyUom) ? line.qtyUom.value : null)
      : null,
    mnfDate: line.mnfDate,
    expDate: line.expDate,
    batchCode: line.batchCode,
    copies: line.copies,
    status: line.status,
    provenance: summariseProvenance(pick(line, LINE_FIELDS)),
  };
}

/**
 * @param {import('../model/types.js').LabelJob} job
 */
export function provenanceSummary(job) {
  const jobLevel = summariseProvenance(pick(job, JOB_FIELDS));
  const counts = { ...jobLevel.counts };
  let total = jobLevel.total;
  for (const line of job.lines) {
    const lineLevel = summariseProvenance(pick(line, LINE_FIELDS));
    total += lineLevel.total;
    for (const key of Object.keys(counts)) counts[key] += lineLevel.counts[key];
  }
  return { total, counts, jobMissing: jobLevel.missingKeys };
}

/**
 * Build the render context a template binds against.
 * @param {import('../model/types.js').LabelJob} job
 * @param {import('../model/types.js').LabelLine} line
 * @param {{ manufacturerPrefix?: string }} [options]
 */
export function renderContext(job, line, options = {}) {
  return {
    customer: job.customer,
    docNo: job.docNo,
    manufacturer: job.manufacturer,
    displayName: line.displayName,
    qtyText: isPresent(line.qtyAmount)
      ? {
        value: formatQuantity(line.qtyAmount.value, isPresent(line.qtyUom) ? line.qtyUom.value : null),
        provenance: line.qtyAmount.provenance,
      }
      : { value: null, provenance: 'missing' },
    mnfDate: line.mnfDate,
    expDate: line.expDate,
    batchCode: line.batchCode,
    qrPayload: job.qrPayload ?? { value: null, provenance: 'missing' },
    // Carried so the printed symbol uses the same correction level the
    // operator was shown when the link was shortened.
    qrEcc: job.qrPlan?.ecc
      ? { value: job.qrPlan.ecc, provenance: 'derived' }
      : { value: null, provenance: 'missing' },
  };
}

/**
 * @param {object} source
 * @param {string[]} keys
 */
function pick(source, keys) {
  const out = {};
  for (const key of keys) out[key] = source[key];
  return out;
}
