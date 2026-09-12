/**
 * Sample Note parser.
 *
 * Same rules as the Picklist parser: anchors rather than offsets, and nothing
 * invented. Addresses need column-aware reading because the Bill To block and
 * the Sample Note Date share horizontal space — a naive "read until blank"
 * swallows the date into the customer's address.
 */

import { field, missing } from '../model/types.js';
import { DEFAULT_DATE_ORDER } from '../config.js';
import { DateFormatError } from '../errors.js';
import { parseDocumentDate } from './dates.js';
import {
  collapse, collectRows, columnAround, columnBelow, findTable, parseQuantity, splitSpans,
  toLines, valueAfter,
} from './anchors.js';

const TERMINATORS = [
  /^\s*Authorized\s+Signature/i,
  /^\s*Receiver\s+Signature/i,
  /^\s*Page\s+\d+\s+of\s+\d+/i,
  /^\s*Total\b/i,
];

/**
 * @param {string} layoutText
 * @param {{ dateOrder?: import('../config.js').DateOrder }} [options]
 * @returns {import('../model/types.js').SampleNote}
 */
export function parseSampleNote(layoutText, options = {}) {
  const dateOrder = options.dateOrder ?? DEFAULT_DATE_ORDER;
  const lines = toLines(layoutText);
  /** @type {string[]} */
  const warnings = [];

  const docNoFound = valueAfter(lines, /Sample\s*Note\s*No\.?/i);

  return {
    docNo: docNoFound
      ? field(collapse(docNoFound.value), 'extracted')
      : missing('Sample Note No not found'),
    date: readDate(lines, dateOrder, warnings),
    billTo: readAddressBlock(lines, /\bBill\s+To\b/i, 'Bill To'),
    shipTo: readAddressBlock(lines, /\bShip\s+To\b/i, 'Ship To'),
    placeOfSupply: readInlineBlock(lines, /Place\s+of\s+Supply\s*:/i, 'Place of Supply'),
    lines: readRows(lines, warnings),
    warnings,
  };
}

/**
 * @param {string[]} lines
 * @param {import('../config.js').DateOrder} order
 * @param {string[]} warnings
 */
function readDate(lines, order, warnings) {
  const found = valueAfter(lines, /Sample\s*Note\s*Date\s*:/i);
  if (!found) return missing('Sample Note Date not found');
  try {
    return field(parseDocumentDate(found.value, order).iso, 'extracted');
  } catch (error) {
    if (!(error instanceof DateFormatError)) throw error;
    warnings.push(`Sample Note Date: ${error.message}`);
    return missing(error.message);
  }
}

/**
 * A block sitting under its own caption, read within the caption's column so
 * an adjacent column cannot leak in.
 * @param {string[]} lines
 * @param {RegExp} caption
 * @param {string} label
 */
function readAddressBlock(lines, caption, label) {
  const found = columnBelow(lines, caption, { maxLines: 8 });
  if (!found || found.values.length === 0) return missing(`${label} not found`);
  return field(collapse(found.values.join(', ')), 'extracted');
}

/**
 * A value that follows an inline label but wraps into the lines above and
 * below it, which is how a right-hand column renders once it is long.
 * @param {string[]} lines
 * @param {RegExp} label
 * @param {string} name
 */
function readInlineBlock(lines, label, name) {
  for (let i = 0; i < lines.length; i += 1) {
    const found = label.exec(lines[i]);
    if (!found) continue;
    const after = found.index + found[0].length;
    const cell = splitSpans(lines[i]).find((span) => span.start >= after);
    if (!cell) return missing(`${name} not found`);
    const values = columnAround(lines, i, cell.start, { before: 1, after: 4 });
    const value = collapse(values.join(' '));
    return value ? field(value, 'extracted') : missing(`${name} not found`);
  }
  return missing(`${name} not found`);
}

/**
 * @param {string[]} lines
 * @param {string[]} warnings
 * @returns {import('../model/types.js').SampleNoteLine[]}
 */
function readRows(lines, warnings) {
  const table = findTable(lines, ['#', 'ITEM & DESCRIPTION', 'QTY']);
  if (!table) {
    warnings.push('The item table could not be located on this Sample Note.');
    return [];
  }

  const rows = collectRows(lines, table.bodyStart, { terminators: TERMINATORS });
  /** @type {import('../model/types.js').SampleNoteLine[]} */
  const parsed = [];

  for (const row of rows) {
    if (row.cells.length < 2) {
      warnings.push(`Sample Note row ${row.ordinal} could not be read: ${row.raw}`);
      continue;
    }
    const description = row.cells[0];
    const quantity = parseQuantity(row.cells[row.cells.length - 1]);
    if (!quantity) {
      warnings.push(`Sample Note row ${row.ordinal} has an unreadable quantity: ${row.raw}`);
      continue;
    }
    parsed.push({
      index: row.ordinal,
      description: field(description, 'extracted'),
      qty: field(quantity.value, 'extracted'),
      uom: quantity.uom ? field(quantity.uom, 'extracted') : missing('Unit not stated'),
    });
  }

  return parsed;
}
