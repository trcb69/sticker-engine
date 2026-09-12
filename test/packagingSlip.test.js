import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsePackagingSlip } from '../src/ingest/parsePackagingSlip.js';
import { joinToJob } from '../src/ingest/join.js';
import { isPresent, textOf } from '../src/model/types.js';

/**
 * Both fixtures are real documents, captured from the PDFs the warehouse
 * actually produces rather than typed by hand. They differ in layout — 146468
 * carries an "Expected Shipment Date" caption and two items, 146499 carries
 * neither — which is the point: the column arrangement is not fixed, so
 * anything here that depended on a fixed one would pass on one and fail on the
 * other.
 */
const read = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
const parse = (name) => parsePackagingSlip(read(name), { dateOrder: 'MDY' });

const two = parse('packaging-slip-PKG-146468');
const one = parse('packaging-slip-PKG-146499');

/* -- Header --------------------------------------------------------------- */

test('the package and sales order numbers are both read', () => {
  assert.equal(textOf(two.packageNo), 'PKG-146468');
  assert.equal(textOf(two.salesOrderNo), 'RSMSO26090096');
  assert.equal(textOf(one.packageNo), 'PKG-146499');
  assert.equal(textOf(one.salesOrderNo), 'RSMSO26090099');
});

test('an order number split across two lines is rejoined without a space', () => {
  // The column prints RSMSO2609 and 0096 two lines apart, with the package
  // date in between. Read naively that is a truncated number that matches no
  // order; rejoined with a space it matches nothing either.
  assert.equal(textOf(two.salesOrderNo), 'RSMSO26090096');
  assert.ok(!textOf(two.salesOrderNo).includes(' '));
});

test('a customer name split across two lines is rejoined with one', () => {
  // "Fusion Apparel Pvt" / "Ltd" — words, so a space belongs between them.
  assert.equal(textOf(two.customerName), 'Fusion Apparel Pvt Ltd');
  assert.equal(textOf(one.customerName), 'Screen Line (Pvt) Ltd');
});

test('the dispatch location is read even though its own caption wraps', () => {
  // The caption is "Package Dispatch" on one line and "Location" on the next.
  assert.equal(textOf(two.dispatchLocation), 'Kelaniya');
  assert.equal(textOf(one.dispatchLocation), 'Kelaniya');
});

test('the date is found whether it is captioned or sits under a column head', () => {
  // 146468 prints "Expected Shipment Date: 09/12/2026" outright. 146499 has no
  // such caption, only an "Order Date" column with the value two lines below.
  assert.equal(textOf(two.date), '2026-09-12');
  assert.equal(textOf(one.date), '2026-09-12');
});

test('a date is never reinterpreted to make it work', () => {
  // 09/12/2026 under DMY is 9 December, not 12 September. Both are real dates,
  // so nothing errors — which is exactly why the order must come from
  // configuration and never from the document.
  const dmy = parsePackagingSlip(read('packaging-slip-PKG-146468'), { dateOrder: 'DMY' });
  assert.equal(textOf(dmy.date), '2026-12-09');
});

/* -- Lines ---------------------------------------------------------------- */

test('every item is read with its quantity and unit exactly as printed', () => {
  assert.equal(two.lines.length, 2);
  assert.equal(textOf(two.lines[0].description), '855 Sponge Puff Paste');
  assert.equal(textOf(two.lines[0].qtyAmount), '0.50');
  assert.equal(textOf(two.lines[0].uom), 'kg');
  assert.equal(textOf(two.lines[1].description), 'F766 Suede Puff Paste');

  assert.equal(one.lines.length, 1);
  assert.equal(textOf(one.lines[0].description), 'Photo Emulsion SBQ-S300');
  assert.equal(textOf(one.lines[0].qtyAmount), '0.50');
});

test('the quantity keeps its own precision rather than being normalised', () => {
  // The slip says 0.50 where the sales order says 0.500. "As written" is the
  // rule: the document's own statement of precision is what prints.
  assert.equal(textOf(two.lines[0].qtyAmount), '0.50');
  assert.notEqual(textOf(two.lines[0].qtyAmount), '0.5');
});

test('the empty batch and date columns are missing, not blank strings', () => {
  // They are printed on every slip and filled on none. A blank string would
  // read as "the operator entered nothing"; missing says what it waits for.
  for (const line of two.lines) {
    assert.equal(isPresent(line.batchCode), false);
    assert.equal(isPresent(line.mnfDate), false);
    assert.equal(isPresent(line.expDate), false);
    assert.match(line.batchCode.note ?? '', /packaging slip/i);
  }
});

test('a filled batch column is read rather than ignored', () => {
  // Not seen in the wild yet. When the ERP starts filling these columns the
  // operator should stop typing them, with no further change here.
  const filled = read('packaging-slip-PKG-146499')
    .replace('Photo Emulsion SBQ-S300                                      0.50',
      'Photo Emulsion SBQ-S300     B24-0091   05/2026   05/2028          0.50');
  const slip = parsePackagingSlip(filled, { dateOrder: 'MDY' });

  assert.equal(textOf(slip.lines[0].batchCode), 'B24-0091');
  assert.equal(textOf(slip.lines[0].mnfDate), '05/2026');
  assert.equal(textOf(slip.lines[0].expDate), '05/2028');
  assert.equal(textOf(slip.lines[0].qtyAmount), '0.50', 'the quantity is still the quantity');
});

/* -- Totals --------------------------------------------------------------- */

test('the printed total is read and reconciles against the lines', () => {
  assert.equal(two.totalQty.value, 1);
  assert.equal(one.totalQty.value, 0.5);

  const { warnings } = joinToJob({ packagingSlip: two });
  assert.deepEqual(warnings, [], '0.50 + 0.50 = 1.00, so nothing to report');
});

test('a line the parser could not read shows up as a total that does not add up', () => {
  // The one arithmetic check this document makes possible, and it catches the
  // failure that is otherwise invisible: a drum that never gets a label.
  const dropped = { ...two, lines: two.lines.slice(0, 1) };
  const { warnings } = joinToJob({ packagingSlip: dropped });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /add up to 0\.5.*total of 1/);
});

/* -- The job -------------------------------------------------------------- */

test('a packaging slip alone builds a complete job', () => {
  const { job } = joinToJob({ packagingSlip: two }, { id: 'job-1', now: '2026-09-12T00:00:00Z' });

  assert.equal(textOf(job.customer), 'Fusion Apparel Pvt Ltd');
  assert.equal(textOf(job.docNo), 'RSMSO26090096', 'the label header prints the order number');
  assert.equal(job.source.packageNo, 'PKG-146468', 'traceable back to the dispatch');
  assert.equal(job.lines.length, 2);
  assert.equal(textOf(job.lines[0].displayName), '855 Sponge Puff Paste');
  assert.equal(textOf(job.lines[0].qtyAmount), '0.50');
});

test('the five fields no document carries still wait for the operator', () => {
  const { job } = joinToJob({ packagingSlip: two });

  assert.equal(isPresent(job.manufacturer), false);
  assert.equal(isPresent(job.qrUrl), false);
  for (const line of job.lines) {
    assert.equal(isPresent(line.batchCode), false);
    assert.equal(isPresent(line.mnfDate), false);
    assert.equal(isPresent(line.expDate), false);
    assert.equal(line.status, 'incomplete', 'nothing prints until they are filled in');
  }
});

test('a slip with no readable items says so rather than producing an empty job', () => {
  const empty = { ...one, lines: [], totalQty: one.totalQty };
  const { job, warnings } = joinToJob({ packagingSlip: empty });
  assert.equal(job.lines.length, 0);
  assert.ok(warnings.some((w) => /nothing to label/i.test(w)));
});
