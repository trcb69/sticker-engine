/**
 * Picklist parser.
 *
 * Anchor-based throughout: values are found by their printed label, table rows
 * by the header row. Nothing found is recorded as `missing` — this layer never
 * substitutes a default, because a default here would be indistinguishable
 * from an extracted value by the time it reached the label.
 */

import { field, missing } from '../model/types.js';
import { DEFAULT_DATE_ORDER } from '../config.js';
import { parseDocumentDate } from './dates.js';
import { collapse, collectRows, columnBelow, findTable, parseQuantity, toLines, valueAfter } from './anchors.js';
import { DateFormatError } from '../errors.js';

const TERMINATORS = [
  /^\s*Page\s+\d+\s+of\s+\d+/i,
  /^\s*Authorized\s+Signature/i,
  /^\s*Total\b/i,
];

/**
 * @param {string} layoutText
 * @param {{ dateOrder?: import('../config.js').DateOrder }} [options]
 * @returns {import('../model/types.js').Picklist}
 */
export function parsePicklist(layoutText, options = {}) {
  const dateOrder = options.dateOrder ?? DEFAULT_DATE_ORDER;
  const lines = toLines(layoutText);
  /** @type {string[]} */
  const warnings = [];

  const text = (label, opts) => {
    const found = valueAfter(lines, label, opts);
    return found ? field(found.value, 'extracted') : missing(`"${labelName(label)}" not found`);
  };

  const picklistNo = text(/Picklist\s*#/i);
  const customerName = text(/Customer\s*Name/i, {
    continuation: true,
    stopAt: /Created\s*by|Picklist\s*Location/i,
  });
  const createdBy = text(/Created\s*by/i);
  const location = text(/Picklist\s*Location/i);

  return {
    picklistNo,
    date: parseDate(lines, dateOrder, warnings),
    status: readStatus(lines),
    customerName,
    createdBy,
    location,
    warehouse: readWarehouse(lines),
    assignee: readAssignee(lines),
    totalQty: readTotalQty(lines),
    lines: readRows(lines, warnings),
    warnings,
  };
}

/**
 * The date sits under a "Picklist Date" caption in a banded summary block
 * rather than after a colon, so it is located by caption and then by shape.
 * @param {string[]} lines
 * @param {import('../config.js').DateOrder} order
 * @param {string[]} warnings
 */
function parseDate(lines, order, warnings) {
  const raw = findBelowCaption(lines, /Picklist\s*$|Picklist\s+Date/i, /\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}/)
    ?? firstMatch(lines, /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/);
  if (!raw) return missing('Picklist Date not found');
  try {
    return field(parseDocumentDate(raw, order).iso, 'extracted');
  } catch (error) {
    if (!(error instanceof DateFormatError)) throw error;
    warnings.push(`Picklist Date: ${error.message}`);
    return missing(error.message);
  }
}

/**
 * Read a caption's stacked value out of the summary band.
 * @param {string[]} lines
 * @param {string|RegExp} caption
 * @param {string} label
 * @param {{ maxLines?: number, skip?: RegExp }} [options]
 */
function bandValue(lines, caption, label, options = {}) {
  const found = columnBelow(lines, caption, { maxLines: options.maxLines ?? 6 });
  if (!found) return missing(`${label} not found`);
  const values = options.skip
    ? found.values.filter((value) => !options.skip.test(value))
    : found.values;
  const value = collapse(values.join(' '));
  return value ? field(value, 'extracted') : missing(`${label} not found`);
}

/** @param {string[]} lines */
function readStatus(lines) {
  return bandValue(lines, /\bStatus\b/, 'Status', { maxLines: 1 });
}

/** @param {string[]} lines */
function readWarehouse(lines) {
  return bandValue(lines, /\bWarehouse\b/, 'Warehouse');
}

/** @param {string[]} lines */
function readAssignee(lines) {
  return bandValue(lines, /\bAssignee\b/, 'Assignee');
}

/**
 * The total is captioned across two lines ("TOTAL" then "QTY"), so the column
 * beneath holds a caption fragment as well as the number.
 * @param {string[]} lines
 */
function readTotalQty(lines) {
  const found = columnBelow(lines, /\bTOTAL\b/i, { maxLines: 4 });
  if (!found) return missing('Total quantity not found');
  for (const value of found.values) {
    const quantity = parseQuantity(value);
    if (quantity && /\d/.test(value)) return field(quantity.value, 'extracted');
  }
  return missing('Total quantity not found');
}

/**
 * @param {string[]} lines
 * @param {string[]} warnings
 * @returns {import('../model/types.js').PicklistLine[]}
 */
function readRows(lines, warnings) {
  const table = findTable(lines, ['#', 'ITEM & DESCRIPTION', 'ORDER']);
  if (!table) {
    warnings.push('The item table could not be located on this Picklist.');
    return [];
  }

  const rows = collectRows(lines, table.bodyStart, { terminators: TERMINATORS });
  /** @type {import('../model/types.js').PicklistLine[]} */
  const parsed = [];

  for (const row of rows) {
    // A row must carry a description, an order number and three quantities.
    // Anything shorter is recorded and skipped: dropping it silently would
    // mean an item quietly never gets a label.
    if (row.cells.length < 5) {
      warnings.push(`Picklist row ${row.ordinal} could not be read: ${row.raw}`);
      continue;
    }
    const [description, orderNo, toPick, picked, remaining] = row.cells;
    const quantities = [toPick, picked, remaining].map(parseQuantity);
    if (quantities.some((q) => q === null)) {
      warnings.push(`Picklist row ${row.ordinal} has an unreadable quantity: ${row.raw}`);
      continue;
    }
    parsed.push({
      index: row.ordinal,
      description: field(description, 'extracted'),
      orderNo: field(orderNo, 'extracted'),
      // Both forms are kept. The numeral as written is what the label prints;
      // the number is only ever used to reconcile against the printed total.
      qtyToPickAmount: field(quantities[0].amount, 'extracted'),
      qtyPickedAmount: field(quantities[1].amount, 'extracted'),
      qtyToPick: field(quantities[0].value, 'extracted'),
      qtyPicked: field(quantities[1].value, 'extracted'),
      qtyRemaining: field(quantities[2].value, 'extracted'),
      uom: field(quantities[1].uom ?? quantities[0].uom, 'extracted'),
    });
  }

  return parsed;
}

/**
 * @param {string[]} lines
 * @param {RegExp} caption
 * @param {RegExp} shape
 * @returns {string|null}
 */
function findBelowCaption(lines, caption, shape) {
  const at = lines.findIndex((line) => caption.test(line));
  if (at === -1) return null;
  for (let i = at; i < Math.min(at + 6, lines.length); i += 1) {
    const found = shape.exec(lines[i]);
    if (found) return found[0];
  }
  return null;
}

/**
 * @param {string[]} lines
 * @param {RegExp} pattern
 * @returns {string|null}
 */
function firstMatch(lines, pattern) {
  for (const line of lines) {
    const found = pattern.exec(line);
    if (found) return found[1] ?? found[0];
  }
  return null;
}

/** @param {string|RegExp} label */
function labelName(label) {
  return label instanceof RegExp ? label.source.replace(/\\s\*|\\s\+/g, ' ') : label;
}
