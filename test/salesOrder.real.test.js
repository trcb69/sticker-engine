import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseSalesOrder } from '../src/ingest/parseSalesOrder.js';
import { joinToJob } from '../src/ingest/join.js';
import { isPresent, textOf } from '../src/model/types.js';

/**
 * The Sales Order parser was written against one captured document and failed
 * completely on the real ones: no customer, and zero line items from an order
 * carrying two. These fixtures are the actual PDFs the warehouse produces.
 *
 * `sales-order-RSMSO26090032` — the original capture, kept deliberately. Its
 * layout differs from the live documents, and both have to keep working.
 */
const read = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
const parse = (name) => parseSalesOrder(read(name), { dateOrder: 'MDY' });

const twoItem = parse('sales-order-RSMSO26090096');
const internal = parse('sales-order-INTSO260901954');
const original = parse('sales-order-RSMSO26090032');

/* -- What was broken ------------------------------------------------------ */

test('every item is read, not just the first', () => {
  // The rows are three blank lines apart, which was exactly the point at which
  // row collection gave up — so a two-item order parsed as one item and the
  // second product silently never got a label.
  assert.equal(twoItem.lines.length, 2);
  assert.equal(textOf(twoItem.lines[0].description), '855 Sponge Puff Paste');
  assert.equal(textOf(twoItem.lines[1].description), 'F766 Suede Puff Paste');
});

test('a row whose ordinal is one space from the description is still a row', () => {
  // Cells split on two or more spaces. These documents print "1 855 Sponge
  // Puff Paste", so the ordinal arrived glued to the description and no row
  // was ever recognised.
  assert.equal(twoItem.lines[0].index, 1);
  assert.equal(twoItem.lines[1].index, 2);
  assert.ok(!textOf(twoItem.lines[0].description).startsWith('1'));
});

test('the customer is read despite the blank line under Bill To', () => {
  // Column reading stopped at the first blank line, and these orders put one
  // between the caption and the address — so the customer, which is the first
  // line of that block, came back missing on every real order.
  assert.equal(textOf(twoItem.customerName), 'Fusion Apparel Pvt Ltd');
  assert.equal(textOf(internal.customerName), 'Standard Holdings Lab');
});

test('the address survives the order number sitting in the middle of it', () => {
  // RSMSO26090096 prints the order number between the customer and the street,
  // in its own column. Treating a line with nothing in this column as the end
  // of the block would drop everything after it.
  const address = textOf(twoItem.billTo);
  assert.match(address, /Fusion Apparel Pvt Ltd/);
  assert.match(address, /Govipola Road/);
  assert.match(address, /Sri Lanka/);
  assert.ok(!address.includes('RSMSO'), 'the number is not part of the address');
});

test('an INTSO number is recognised as an order number', () => {
  // Only RSMSO was matched, so internal lab orders parsed with no number —
  // and the number is what prints in the label header.
  assert.equal(textOf(internal.orderNo), 'INTSO260901954');
  assert.equal(textOf(twoItem.orderNo), 'RSMSO26090096');
});

test('the original captured layout still parses', () => {
  // The fix must not trade one layout for another.
  assert.equal(textOf(original.orderNo), 'RSMSO26090032');
  assert.ok(original.lines.length >= 2);
  assert.ok(isPresent(original.customerName));
});

/* -- The internal-order route --------------------------------------------- */

test('a sales order alone builds a job, which is the route for internal orders', () => {
  // Internal orders are never packed for dispatch, so no packaging slip is
  // ever issued for them. Without this path they had no way in at all.
  const { job, warnings } = joinToJob({ salesOrder: internal }, { id: 'j', now: '2026-09-13T00:00:00Z' });

  assert.equal(textOf(job.docNo), 'INTSO260901954');
  assert.equal(textOf(job.customer), 'Standard Holdings Lab');
  assert.equal(job.source.salesOrderNo, 'INTSO260901954');
  assert.equal(job.source.packageNo, null, 'there is no package for an internal order');
  assert.equal(job.lines.length, 1);
  assert.equal(textOf(job.lines[0].displayName), '6000T High Mesh Clear Paste');
  assert.deepEqual(warnings, []);
});

test('the ordered quantity prints with the order own precision', () => {
  // A sales order says 0.500 where a packaging slip says 0.50 for the same
  // product. Each document states its own precision and "as written" is the
  // rule, so both are correct and they differ on the label.
  const { job } = joinToJob({ salesOrder: twoItem });
  assert.equal(textOf(job.lines[0].qtyAmount), '0.500');
  assert.equal(textOf(job.lines[0].qtyUom), 'kg');
});

test('the operator still supplies the five fields no document carries', () => {
  const { job } = joinToJob({ salesOrder: internal });
  assert.equal(isPresent(job.manufacturer), false);
  assert.equal(isPresent(job.qrUrl), false);
  assert.equal(isPresent(job.lines[0].batchCode), false);
  assert.equal(isPresent(job.lines[0].mnfDate), false);
  assert.equal(isPresent(job.lines[0].expDate), false);
  assert.equal(job.lines[0].status, 'incomplete');
});

test('a packaging slip still wins when both are uploaded', () => {
  // The slip records what was actually packed; the order records what was
  // asked for. When both exist the packed truth is the one that prints.
  const slip = {
    packageNo: { value: 'PKG-146468', provenance: 'extracted' },
    salesOrderNo: { value: 'RSMSO26090096', provenance: 'extracted' },
    customerName: { value: 'Fusion Apparel Pvt Ltd', provenance: 'extracted' },
    dispatchLocation: { value: 'Kelaniya', provenance: 'extracted' },
    date: { value: '2026-09-12', provenance: 'extracted' },
    totalQty: { value: 0.5, provenance: 'extracted' },
    lines: [{
      index: 1,
      description: { value: '855 Sponge Puff Paste', provenance: 'extracted' },
      batchCode: { value: null, provenance: 'missing' },
      mnfDate: { value: null, provenance: 'missing' },
      expDate: { value: null, provenance: 'missing' },
      qtyAmount: { value: '0.50', provenance: 'extracted' },
      qty: { value: 0.5, provenance: 'extracted' },
      uom: { value: 'kg', provenance: 'extracted' },
    }],
    warnings: [],
  };
  const { job } = joinToJob({ packagingSlip: slip, salesOrder: twoItem });
  assert.equal(job.source.packageNo, 'PKG-146468');
  assert.equal(textOf(job.lines[0].qtyAmount), '0.50', 'packed, not ordered');
});
