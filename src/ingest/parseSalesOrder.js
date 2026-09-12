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

/**
 * Order number prefixes: RSMSO for customer orders, INTSO for internal lab
 * orders. Only RSMSO was matched, so an internal order parsed with no number
 * at all — and the number is the label's header.
 */
const ORDER_NO_EXACT = /^(?:RSMSO|INTSO)\w+$/i;
const ORDER_NO_PREFIX = /^(?:RSMSO|INTSO)/i;
const ORDER_NO_ANYWHERE = /\b((?:RSMSO|INTSO)\w+)\b/i;

/** Captions that mark the end of the Bill To block. */
const BLOCK_STOP = /Order\s*Date|Sales\s*person|Created\s*by|Place\s+of\s+Supply|Item\s*&|Expected/i;

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

  const billTo = readAddressBlock(lines, /\bBill\s+To\b/i, 'Bill To');
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
  const fromCaption = captioned?.values.find((value) => ORDER_NO_EXACT.test(value));
  if (fromCaption) return field(fromCaption, 'extracted');

  const inline = valueAfter(lines, /Sales\s+Order\s*#\s*:?/i);
  if (inline && ORDER_NO_PREFIX.test(inline.value)) return field(collapse(inline.value), 'extracted');

  for (const line of lines) {
    const found = ORDER_NO_ANYWHERE.exec(line);
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
 * The Bill To address block.
 *
 * `columnBelow` stops at the first blank line, and on the real documents there
 * IS one between the caption and the address — so it returned nothing and the
 * customer name came back missing on every order, since the customer is the
 * first line of this block.
 *
 * Two rules make it work. A blank line before any content is the gap under the
 * caption and is skipped; a blank line after content ends the block. And a
 * line carrying nothing in this column is skipped rather than treated as the
 * end — the order number sits between the customer and the street address, in
 * a column of its own, and breaking there would drop half the address.
 *
 * @param {string[]} lines
 * @param {RegExp} caption
 * @param {string} label
 */
function readAddressBlock(lines, caption, label) {
  for (let i = 0; i < lines.length; i += 1) {
    const found = caption.exec(lines[i]);
    if (!found) continue;
    const column = found.index;

    /** @type {string[]} */
    const values = [];
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j += 1) {
      if (lines[j].trim() === '') {
        if (values.length > 0) break;
        continue;
      }
      if (BLOCK_STOP.test(lines[j])) break;
      const cell = splitSpans(lines[j]).find((span) => Math.abs(span.start - column) <= 3);
      if (!cell) continue;
      values.push(cell.text.replace(/,\s*$/, ''));
    }

    if (values.length === 0) return missing(`${label} not found`);
    return field(collapse(values.join(', ')), 'extracted');
  }
  return missing(`${label} not found`);
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

  // Rows on these orders are separated by three blank lines, which is exactly
  // the default at which row collection gives up — so a two-item order read as
  // having one. The real end of the table is a terminator ("Operational
  // Manager"), not a run of blanks, so the blank allowance can be loosened
  // without risk of running past the table.
  const rows = collectRows(lines, table.bodyStart, {
    terminators: TERMINATORS,
    maxBlankRun: 6,
  });
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
