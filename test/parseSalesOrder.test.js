import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSalesOrder } from '../src/ingest/parseSalesOrder.js';
import { detectKind } from '../src/ingest/extract.js';
import { isPresent, textOf } from '../src/model/types.js';
import { formatQuantity } from '../src/model/qty.js';

const text = readFileSync(new URL('./fixtures/sales-order-RSMSO26090032.txt', import.meta.url), 'utf8');
const order = parseSalesOrder(text, { dateOrder: 'MDY' });

test('a Sales Order is recognised on its own markers', () => {
  assert.equal(detectKind(text).kind, 'salesOrder');
  assert.equal(detectKind(text).matched.length, 2);
});

test('the header fields are extracted', () => {
  assert.equal(textOf(order.orderNo), 'RSMSO26090032');
  assert.equal(textOf(order.date), '2026-09-03', 'MDY: 3 September');
  assert.equal(textOf(order.createdBy), 'Upali Ratnayake');
  assert.equal(textOf(order.salesPerson), 'Kamal Herath');
  assert.equal(order.warnings.length, 0);
});

test('a date wrapped mid-value is rejoined before parsing', () => {
  // The order date renders as "09/03" then "/2026" in adjacent lines.
  assert.equal(order.date.provenance, 'extracted');
  assert.equal(textOf(order.date), '2026-09-03');
});

test('the customer is the first line of Bill To, and is marked derived', () => {
  assert.match(textOf(order.billTo), /^Hi Fashion Holdings Pvt Ltd/);
  assert.match(textOf(order.billTo), /Sri Lanka$/);
  assert.equal(textOf(order.customerName), 'Hi Fashion Holdings Pvt Ltd');
  assert.equal(order.customerName.provenance, 'derived');
});

test('the Sales Order# caption is preferred over the page header', () => {
  assert.equal(order.orderNo.provenance, 'extracted');
  assert.equal(order.orderNo.note, undefined, 'not the header fallback');
});

test('both item rows are read with their units as written', () => {
  assert.equal(order.lines.length, 2);
  assert.equal(textOf(order.lines[0].description), '110 Anti-Foil Paste');
  assert.equal(textOf(order.lines[0].qtyAmount), '1.000', 'trailing zeros preserved');
  assert.equal(textOf(order.lines[1].description), 'PC200');
  assert.equal(textOf(order.lines[1].qtyAmount), '0.04');
});

test('units are read whatever case the document used', () => {
  // The document writes "kg" on one row and "KG" on the next.
  assert.equal(formatQuantity(textOf(order.lines[0].qtyAmount), textOf(order.lines[0].uom)), '1.000KG');
  assert.equal(formatQuantity(textOf(order.lines[1].qtyAmount), textOf(order.lines[1].uom)), '0.04KG');
});

test('the footer terminates the table', () => {
  assert.ok(order.lines.every((l) => !/Operational Manager|PICK N PACK/i.test(textOf(l.description))));
});

test('the same document reads a different date under DMY', () => {
  assert.equal(textOf(parseSalesOrder(text, { dateOrder: 'DMY' }).date), '2026-03-09');
});

test('a missing field is absent rather than defaulted', () => {
  const stripped = text.replace(/Upali Ratnayake/, '');
  const parsed = parseSalesOrder(stripped, { dateOrder: 'MDY' });
  assert.equal(isPresent(parsed.createdBy), false);
  assert.ok(parsed.createdBy.note);
});
