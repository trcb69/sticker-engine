/**
 * Packaging slip -> domain object.
 *
 * The packaging slip is the document the packer actually holds, and between
 * the header and its item table it carries everything a label prints: the
 * customer, the sales order number, and each item with its quantity and unit.
 * The sales order adds an address, a salesperson and a business unit, none of
 * which reach the sticker.
 *
 * Three things about this document shape the parser.
 *
 * **Everything wraps.** The columns are narrow enough that values break across
 * lines mid-value — the customer as `Fusion Apparel Pvt` / `Ltd`, the order
 * number as `RSMSO2609` / `0096`. The first rejoins with a space because those
 * are words; the second must rejoin with none, because it is one number that
 * happened to run out of column. Getting that backwards yields an order number
 * that matches nothing.
 *
 * **The batch, manufacture and expiry columns are printed but empty.** They are
 * read anyway. Today they are always blank and the operator types those three
 * fields; if the ERP ever starts filling them, they arrive as `extracted` and
 * the operator's job shrinks with no further change here. Reading a column that
 * is usually empty costs nothing; not reading one that starts being filled
 * costs a person typing what was already on the page in front of them.
 *
 * **`Total Qty` is a free arithmetic check.** The same check the picklist path
 * makes: sum the lines, compare against the printed total, and catch the row
 * the parser could not read — the failure that is otherwise invisible, because
 * a dropped row is simply a drum that never gets a label.
 */

import { field, missing } from '../model/types.js';
import { DEFAULT_DATE_ORDER } from '../config.js';
import { parseDocumentDate } from './dates.js';
import {
  collapse, collectRows, columnBelow, findTable, parseQuantity, splitSpans, toLines, valueAfter,
} from './anchors.js';

/** Where the item table stops. */
const TERMINATORS = [/^\s*Total\b/i, /^\s*Page\s+\d+/i];

/**
 * A sales order number, in either of the two prefixes seen: RSMSO for customer
 * orders, INTSO for internal lab orders.
 */
const ORDER_NO = /\b((?:RSMSO|INTSO)\d+)\b/i;

/**
 * How far a continuation fragment may sit from its parent's column and still
 * be considered part of it. Poppler places a wrapped fragment at the same
 * column, but a point of rounding either way is not worth failing over.
 */
const COLUMN_TOLERANCE = 2;

/**
 * @param {string} layoutText
 * @param {{ dateOrder?: import('../config.js').DateOrder }} [options]
 * @returns {import('../model/types.js').PackagingSlip}
 */
export function parsePackagingSlip(layoutText, options = {}) {
  const dateOrder = options.dateOrder ?? DEFAULT_DATE_ORDER;
  const lines = toLines(layoutText);
  /** @type {string[]} */
  const warnings = [];

  const text = (label, opts) => {
    const found = valueAfter(lines, label, opts);
    return found ? field(collapse(found.value), 'extracted') : null;
  };

  const packageNo = text(/Package\s*#/i)
    ?? missing('"Package#" not found on this packaging slip');

  const customerName = text(/Ship\s*to/i, {
    continuation: true,
    stopAt: /Package\s*Dispatch|Location|Batch|Item\s*&/i,
  }) ?? missing('"Ship to" not found on this packaging slip');

  const dispatchLocation = text(/^\s*Location\b/i) ?? missing('Dispatch location not found');

  return {
    packageNo,
    salesOrderNo: readOrderNo(lines, warnings),
    customerName,
    dispatchLocation,
    date: readDate(lines, dateOrder, warnings),
    totalQty: readTotalQty(lines),
    lines: readRows(lines, warnings),
    warnings,
  };
}

/**
 * The sales order number, rejoined if the column wrapped it.
 *
 * `RSMSO2609` on one line and `0096` two lines below is one number, not a
 * number and a quantity. The fragment is claimed only when it is digits and
 * only when it sits in the same column, because at that point it cannot be
 * anything else — every other value in that band is a date or a decimal.
 *
 * @param {string[]} lines
 * @param {string[]} warnings
 * @returns {import('../model/types.js').Field<string>}
 */
function readOrderNo(lines, warnings) {
  for (let i = 0; i < lines.length; i += 1) {
    const spans = splitSpans(lines[i]);
    const span = spans.find((candidate) => ORDER_NO.test(candidate.text));
    if (!span) continue;

    const matched = ORDER_NO.exec(span.text)[1];
    let complete = matched;

    for (let j = i + 1; j < lines.length; j += 1) {
      const below = splitSpans(lines[j]);
      if (below.length === 0) continue;
      const aligned = below.find((c) => Math.abs(c.start - span.start) <= COLUMN_TOLERANCE);
      // A blank column beneath means the value ended; carry on past it, since
      // the package date sits between the two halves in its own column.
      if (!aligned) continue;
      if (!/^\d+$/.test(aligned.text)) break;
      complete += aligned.text;
      break;
    }

    return complete === matched
      ? field(matched, 'extracted')
      : field(complete, 'extracted');
  }

  warnings.push('No sales order number was found on this packaging slip.');
  return missing('No RSMSO or INTSO number found');
}

/**
 * The date, preferring the shipment date and falling back to the order date.
 *
 * @param {string[]} lines
 * @param {import('../config.js').DateOrder} order
 * @param {string[]} warnings
 */
function readDate(lines, order, warnings) {
  // "Expected Shipment Date: 09/12/2026" reads straight off its own line, but
  // it is not on every slip. The others are column captions in the summary
  // band with their value a line or two below, so they are read by column.
  const raw = firstDate(valueAfter(lines, /Expected\s*Shipment\s*Date/i)?.value)
    ?? firstDate(columnBelow(lines, /Order\s*Date/i)?.values?.join(' '))
    ?? firstDate(columnBelow(lines, /Package\s*\n?\s*Date/i)?.values?.join(' '));

  if (!raw) return missing('No date found on this packaging slip');

  try {
    return field(parseDocumentDate(raw, order).iso, 'extracted');
  } catch (error) {
    // Never guessed at. A date read in the wrong order puts a wrong expiry on
    // a drum, and nobody finds out until someone acts on it.
    warnings.push(`The date "${raw}" could not be read in ${order} order.`);
    return missing(`"${raw}" is not a date in ${order} order`);
  }
}

/**
 * @param {string|undefined|null} text
 * @returns {string|null}
 */
function firstDate(text) {
  if (!text) return null;
  return (collapse(text).match(/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/) ?? [null])[0];
}

/**
 * The printed total, used only to reconcile against the summed lines.
 * @param {string[]} lines
 */
function readTotalQty(lines) {
  const found = valueAfter(lines, /Total\s*Qty/i);
  if (!found) return missing('No "Total Qty" printed on this packaging slip');

  // The caption sits in a header band and its value is a line or two below, in
  // the same column — so the caption's own line rarely holds it.
  const direct = parseQuantity(found.value);
  if (direct) return field(direct.value, 'extracted');

  for (let i = found.line + 1; i < Math.min(found.line + 4, lines.length); i += 1) {
    const numbers = splitSpans(lines[i]).filter((s) => /^\d+(\.\d+)?$/.test(s.text));
    if (numbers.length > 0) {
      const parsed = parseQuantity(numbers[numbers.length - 1].text);
      if (parsed) return field(parsed.value, 'extracted');
    }
  }
  return missing('No "Total Qty" value found');
}

/**
 * The item table.
 *
 * Columns are #, Item & Description, Batch Reference #, Manufactured Date,
 * Expiry Date, Qty — but the three middle ones are blank in every slip seen so
 * far, and poppler emits nothing at all for an empty cell. So a row arrives as
 * two cells, not six, and the quantity is found by shape from the right rather
 * than by counting from the left. Counting would put a batch code in the
 * quantity the first time one of those columns is filled.
 *
 * @param {string[]} lines
 * @param {string[]} warnings
 * @returns {import('../model/types.js').PackagingSlipLine[]}
 */
function readRows(lines, warnings) {
  const table = findTable(lines, ['#', 'ITEM & DESCRIPTION', 'QTY']);
  if (!table) {
    warnings.push('The item table could not be located on this packaging slip.');
    return [];
  }

  const rows = collectRows(lines, table.bodyStart, { terminators: TERMINATORS });
  /** @type {import('../model/types.js').PackagingSlipLine[]} */
  const parsed = [];

  for (const row of rows) {
    if (row.cells.length < 2) {
      warnings.push(`Packaging slip row ${row.ordinal} could not be read: ${row.raw}`);
      continue;
    }

    // The last cell that reads as a quantity is the quantity; the first is the
    // description. Anything between them is a batch code or a date.
    const quantityAt = lastIndexMatching(row.cells, (cell) => parseQuantity(cell) !== null);
    if (quantityAt <= 0) {
      warnings.push(`Packaging slip row ${row.ordinal} has an unreadable quantity: ${row.raw}`);
      continue;
    }

    const quantity = parseQuantity(row.cells[quantityAt]);
    const description = collapse(row.cells[0]);
    if (description === '') {
      warnings.push(`Packaging slip row ${row.ordinal} has no item description: ${row.raw}`);
      continue;
    }

    const middle = row.cells.slice(1, quantityAt).map(collapse).filter((c) => c !== '');

    parsed.push({
      index: row.ordinal,
      description: field(description, 'extracted'),
      // Present in the layout, empty in practice. Read rather than assumed, so
      // that the day the ERP fills them the operator stops typing them.
      batchCode: middle.length > 0
        ? field(middle[0], 'extracted')
        : missing('Not printed on the packaging slip'),
      mnfDate: middle.length > 1
        ? field(middle[1], 'extracted')
        : missing('Not printed on the packaging slip'),
      expDate: middle.length > 2
        ? field(middle[2], 'extracted')
        : missing('Not printed on the packaging slip'),
      // Both forms kept: the numeral as written is what the label prints, the
      // number only ever reconciles against the printed total.
      qtyAmount: field(quantity.amount, 'extracted'),
      qty: field(quantity.value, 'extracted'),
      uom: quantity.uom ? field(quantity.uom, 'extracted') : missing('No unit printed'),
    });
  }

  if (parsed.length === 0) warnings.push('No item rows were read from this packaging slip.');
  return parsed;
}

/**
 * @param {string[]} cells
 * @param {(cell: string) => boolean} predicate
 * @returns {number} -1 when nothing matches
 */
function lastIndexMatching(cells, predicate) {
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    if (predicate(cells[i])) return i;
  }
  return -1;
}
