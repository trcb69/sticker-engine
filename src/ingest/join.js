/**
 * Join the source documents into a LabelJob.
 *
 * The Sample Note and the Picklist are the working pair. Between them they
 * carry everything the label prints:
 *
 *   Sample Note  (RSMINV…) the document number in the label header
 *   Picklist     (PL-…)    the item name and the quantity, with its unit
 *
 * Labels are produced from what was picked, so the Picklist drives the job. A
 * Sample Note line that never reached the Picklist gets no label, and the
 * operator is told.
 *
 * A Sales Order (RSMSO…) is accepted but optional. It stands in for the Sample
 * Note when matching lines, and supplies the customer if neither of the others
 * did — enough that uploading one is never an error, without making it part of
 * the normal run.
 */

import { randomUUID } from 'node:crypto';
import { JoinError } from '../errors.js';
import { field, isPresent, lineStatus, missing, textOf } from '../model/types.js';
import { amountValue } from '../model/qty.js';

/**
 * Normalise a description for comparison.
 *
 * `FW-777-Hybrid White` and `FW 777 Hybrid  White` are the same item written
 * by two systems. Case, punctuation and repeated whitespace all vary between
 * documents and none of them carry meaning here.
 *
 * @param {string} description
 * @returns {string}
 */
export function normaliseDescription(description) {
  return String(description ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @typedef {object} JoinDocuments
 * @property {import('../model/types.js').SampleNote} [sampleNote]
 * @property {import('../model/types.js').Picklist} [picklist]
 * @property {import('../model/types.js').SalesOrder} [salesOrder]
 */

/**
 * @typedef {object} JoinBuckets
 * @property {{ picklistIndex: number, sourceIndex: number, description: string }[]} matched
 * @property {{ sourceIndex: number, description: string, source: string }[]} orderedOnly
 * @property {{ picklistIndex: number, description: string }[]} picklistOnly
 */

/**
 * @param {JoinDocuments} documents
 * @param {{ id?: string, now?: string }} [options]
 * @returns {{ job: import('../model/types.js').LabelJob, buckets: JoinBuckets, warnings: string[] }}
 */
export function joinToJob(documents, options = {}) {
  const { sampleNote = null, picklist = null, salesOrder = null } = documents ?? {};
  if (!sampleNote && !picklist && !salesOrder) {
    throw new JoinError('A job needs at least one document. Upload a Picklist to print labels.');
  }

  /** @type {string[]} */
  const warnings = [
    ...(salesOrder?.warnings ?? []),
    ...(sampleNote?.warnings ?? []),
    ...(picklist?.warnings ?? []),
  ];

  const buckets = matchLines(sampleNote, picklist, salesOrder);

  for (const entry of buckets.orderedOnly) {
    warnings.push(
      `"${entry.description}" is on the ${entry.source} but was not picked, so it gets no label.`,
    );
  }

  if (!picklist) {
    warnings.push(
      'No Picklist was uploaded, so there is nothing to label. ' +
      'Quantities and item names come from the Picklist.',
    );
  }
  if (!sampleNote) {
    warnings.push('No Sample Note was uploaded, so the label header will have no document number.');
  }

  warnings.push(...reconcileTotal(picklist));

  return {
    job: {
      id: options.id ?? randomUUID(),
      createdAt: options.now ?? new Date().toISOString(),
      source: {
        salesOrderNo: pick(salesOrder?.orderNo),
        sampleNoteNo: pick(sampleNote?.docNo),
        picklistNo: pick(picklist?.picklistNo),
      },
      customer: resolveCustomer(sampleNote, picklist, salesOrder),
      docNo: sampleNote?.docNo ?? missing('No Sample Note was uploaded'),
      // Pasted by the operator. It is on none of the documents, so nothing is
      // invented for it here.
      manufacturer: missing('Entered by the operator'),
      qrUrl: missing('Not yet supplied'),
      qrShortCode: missing('Not yet minted'),
      lines: picklist ? picklist.lines.map(toLabelLine) : [],
    },
    buckets,
    warnings,
  };
}

/** @param {import('../model/types.js').Field<string>|undefined} candidate */
function pick(candidate) {
  return candidate && isPresent(candidate) ? textOf(candidate) : null;
}

/**
 * @param {import('../model/types.js').SampleNote|null} sampleNote
 * @param {import('../model/types.js').Picklist|null} picklist
 * @param {import('../model/types.js').SalesOrder|null} salesOrder
 * @returns {JoinBuckets}
 */
function matchLines(sampleNote, picklist, salesOrder) {
  /** @type {JoinBuckets} */
  const buckets = { matched: [], orderedOnly: [], picklistOnly: [] };

  const ordered = sampleNote?.lines?.length
    ? { lines: sampleNote.lines, source: 'Sample Note' }
    : salesOrder?.lines?.length
      ? { lines: salesOrder.lines, source: 'Sales Order' }
      : { lines: [], source: 'Sample Note' };

  // A multimap, because the same item can legitimately appear twice on one
  // document. Each ordered line is consumed by at most one match.
  /** @type {Map<string, number[]>} */
  const pending = new Map();
  for (const line of ordered.lines) {
    const key = normaliseDescription(textOf(line.description));
    if (!pending.has(key)) pending.set(key, []);
    pending.get(key).push(line.index);
  }

  for (const line of picklist?.lines ?? []) {
    const description = textOf(line.description);
    const queue = pending.get(normaliseDescription(description));
    if (queue && queue.length > 0) {
      buckets.matched.push({
        picklistIndex: line.index,
        sourceIndex: queue.shift(),
        description,
      });
    } else {
      buckets.picklistOnly.push({ picklistIndex: line.index, description });
    }
  }

  for (const line of ordered.lines) {
    const queue = pending.get(normaliseDescription(textOf(line.description)));
    if (queue && queue.includes(line.index)) {
      buckets.orderedOnly.push({
        sourceIndex: line.index,
        description: textOf(line.description),
        source: ordered.source,
      });
    }
  }

  return buckets;
}

/**
 * The customer is printed directly on the Picklist. On the other two documents
 * it is the first line of the Bill To address, which is a derivation and is
 * marked as one.
 */
function resolveCustomer(sampleNote, picklist, salesOrder) {
  if (picklist && isPresent(picklist.customerName)) return picklist.customerName;
  if (salesOrder && isPresent(salesOrder.customerName)) return salesOrder.customerName;
  if (sampleNote && isPresent(sampleNote.billTo)) {
    const firstLine = textOf(sampleNote.billTo).split(',')[0].trim();
    if (firstLine) return field(firstLine, 'derived', 'Taken from the Bill To address');
  }
  return missing('Customer name not found on any document');
}

/**
 * A picked line becomes a label line.
 *
 * The description and the quantity are carried across untouched, numeral and
 * unit exactly as the Picklist wrote them. Nothing is converted and nothing is
 * looked up.
 *
 * @param {import('../model/types.js').PicklistLine} line
 * @returns {import('../model/types.js').LabelLine}
 */
function toLabelLine(line) {
  const labelLine = {
    index: line.index,
    displayName: line.description,
    qtyAmount: line.qtyPickedAmount,
    qtyUom: line.uom,
    mnfDate: missing('Entered by the operator'),
    expDate: missing('Entered by the operator'),
    batchCode: missing('Entered or pasted by the operator'),
    copies: 1,
    status: 'incomplete',
  };
  labelLine.status = lineStatus(labelLine);
  return labelLine;
}

/**
 * Check the picked quantities against the Picklist's own printed total.
 *
 * This is the one arithmetic check the documents make possible, and it catches
 * precisely the failure that is otherwise invisible: a row the parser could
 * not read, dropped with a warning nobody noticed.
 *
 * Only lines sharing the total's unit are summed. A Picklist mixing kilograms
 * and litres has no single meaningful total, so the check is skipped rather
 * than reported wrongly.
 *
 * @param {import('../model/types.js').Picklist|null} picklist
 * @returns {string[]}
 */
function reconcileTotal(picklist) {
  if (!picklist || !isPresent(picklist.totalQty)) return [];

  const units = new Set(
    picklist.lines.filter((line) => isPresent(line.uom)).map((line) => textOf(line.uom)),
  );
  if (units.size > 1) return [];

  const summed = picklist.lines.reduce(
    (total, line) => total + (isPresent(line.qtyPicked) ? Number(line.qtyPicked.value) : 0),
    0,
  );
  const stated = amountValue(picklist.totalQty.value);
  if (stated === null || Math.abs(summed - stated) < 0.005) return [];
  return [
    `The picked quantities add up to ${summed.toFixed(2)} but the Picklist states ` +
    `${stated.toFixed(2)}. A row was probably not read — check the item list before printing.`,
  ];
}
