/**
 * Sales Order parser.
 *
 * A Sales Order records what was ordered. Quantities on the label come from
 * the Picklist, which records what was actually picked, so this document is
 * read for its customer, its order number and a cross-check: an ordered line
 * that never reached the Picklist is worth telling the operator about.
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
  /^\s*Operational\s+Manager/i,
  /^\s*SALES\s+ORDER\s+FOR/i,
  /^\s*Authorized\s+Signature/i,
  /^\s*Page\s+\d+\s+of\s+\d+/i,
  /^\s*Total\b/i,
];

/**
 * @param {string} layoutText
 * @param {{ dateOrder?: import('../config.js').DateOrder }} [options]
 * @returns {import('../model/types.js').SalesOrder}
 */
export function parseSalesOrder(layoutText, options = {}) {
  const dateOrder = options.dateOrder ?? DEFAULT_DATE_ORDER;
  const lines = toLines(layoutText);
  /** @type {string[]} */
  const warnings = [];

  const billTo = readBlock(lines, /\bBill\s+To\b/i, 'Bill To');
  const orderNo = readOrderNo(lines);

  return {
    orderNo,
    date: readDate(lines, dateOrder, warnings),
    billTo,
    // The customer is the first line of the Bill To address. That is a
    // derivation, and is tagged as one.
    customerName: billTo.value
      ? field(String(billTo.value).split(',')[0].trim(), 'derived', 'First line of Bill To')
      : missing('Customer name not found'),
    // "Sales" alone, not "Sales Order#" and not the footer line, is the
    // column caption whose value stacks beneath it.
    salesPerson: readStacked(lines, /\bSales\b(?!\s+ORDER|\s+Order)/, 'Sales person'),
    createdBy: readBlock(lines, /\bCreated\s+by\b/i, 'Created by'),
    placeOfSupply: readInlineOrBelow(lines, /Place\s+of\s+Supply/i, 'Place of Supply'),
    lines: readRows(lines, warnings),
    warnings,
  };
}

/**
 * The order number appears twice: once in the page header and once beside the
 * "Sales Order#" caption. The caption is the reliable one, but the header is a
 * usable fallback when the caption wraps out of reach.
 * @param {string[]} lines
 */
function readOrderNo(lines) {
  const captioned = columnBelow(lines, /Sales\s+Order#/i, { maxLines: 2 });
  const fromCaption = captioned?.values.find((value) => /^RSMSO\w+$/i.test(value));
  if (fromCaption) return field(fromCaption, 'extracted');

  const inline = valueAfter(lines, /Sales\s+Order\s*#\s*:?/i);
  if (inline && /^RSMSO/i.test(inline.value)) return field(collapse(inline.value), 'extracted');

  for (const line of lines) {
    const found = /\b(RSMSO\w+)\b/i.exec(line);
    if (found) return field(found[1], 'extracted', 'Read from the page header');
  }
  return missing('Sales Order# not found');
}

/**
 * @param {string[]} lines
 * @param {import('../config.js').DateOrder} order
 * @param {string[]} warnings
 */
function readDate(lines, order, warnings) {
  // The order date is stacked under its caption and wraps mid-value
  // ("09/03" then "/2026"), so the fragments are rejoined before parsing.
  const stacked = columnBelow(lines, /Order\s*$|Order\s+Date/i, { maxLines: 4 });
  const joined = collapse((stacked?.values ?? []).join('')).replace(/\s+/g, '');
  const raw = /\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}/.exec(joined)?.[0]
    ?? firstDateAnywhere(lines);
  if (!raw) return missing('Order Date not found');
  try {
    return field(parseDocumentDate(raw, order).iso, 'extracted');
  } catch (error) {
    if (!(error instanceof DateFormatError)) throw error;
    warnings.push(`Order Date: ${error.message}`);
    return missing(error.message);
  }
}

/** @param {string[]} lines */
function firstDateAnywhere(lines) {
  for (const line of lines) {
    const found = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b/.exec(line);
    if (found) return found[0];
  }
  return null;
}

/**
 * @param {string[]} lines
 * @param {RegExp} caption
 * @param {string} label
 */
function readBlock(lines, caption, label) {
  const found = columnBelow(lines, caption, { maxLines: 8 });
  if (!found || found.values.length === 0) return missing(`${label} not found`);
  return field(collapse(found.values.join(', ')), 'extracted');
}

/**
 * A value stacked under a caption that itself wraps across lines.
 * @param {string[]} lines
 * @param {RegExp} caption
 * @param {string} label
 */
function readStacked(lines, caption, label) {
  const found = columnBelow(lines, caption, { maxLines: 5 });
  if (!found) return missing(`${label} not found`);
  // Drop caption fragments that wrapped into the column below.
  const values = found.values.filter((value) => !/^(person|Date|Type|Unit)$/i.test(value));
  const value = collapse(values.join(' '));
  return value ? field(value, 'extracted') : missing(`${label} not found`);
}

/**
 * A value that may sit beside its label or beneath it, depending on how the
 * right-hand column wrapped.
 * @param {string[]} lines
 * @param {RegExp} label
 * @param {string} name
 */
function readInlineOrBelow(lines, label, name) {
  for (let i = 0; i < lines.length; i += 1) {
    const found = label.exec(lines[i]);
    if (!found) continue;
    const after = found.index + found[0].length;
    const beside = splitSpans(lines[i]).find((span) => span.start >= after);
    const column = beside ? beside.start : found.index;
    const values = columnAround(lines, i, column, { before: 1, after: 5 })
      .filter((value) => !label.test(value));
    const value = collapse(values.join(' '));
    return value ? field(value, 'extracted') : missing(`${name} not found`);
  }
  return missing(`${name} not found`);
}

/**
 * @param {string[]} lines
 * @param {string[]} warnings
 * @returns {import('../model/types.js').SalesOrderLine[]}
 */
function readRows(lines, warnings) {
  const table = findTable(lines, ['#', 'ITEM & DESCRIPTION', 'QTY']);
  if (!table) {
    warnings.push('The item table could not be located on this Sales Order.');
    return [];
  }

  const rows = collectRows(lines, table.bodyStart, { terminators: TERMINATORS });
  /** @type {import('../model/types.js').SalesOrderLine[]} */
  const parsed = [];

  for (const row of rows) {
    if (row.cells.length < 2) {
      warnings.push(`Sales Order row ${row.ordinal} could not be read: ${row.raw}`);
      continue;
    }
    const quantity = parseQuantity(row.cells[row.cells.length - 1]);
    if (!quantity) {
      warnings.push(`Sales Order row ${row.ordinal} has an unreadable quantity: ${row.raw}`);
      continue;
    }
    parsed.push({
      index: row.ordinal,
      description: field(row.cells[0], 'extracted'),
      qtyAmount: field(quantity.amount, 'extracted'),
      uom: quantity.uom ? field(quantity.uom, 'extracted') : missing('Unit not stated'),
    });
  }

  return parsed;
}
