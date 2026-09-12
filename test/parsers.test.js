import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePicklist } from '../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../src/ingest/parseSampleNote.js';
import { isPresent, textOf } from '../src/model/types.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
const picklist = parsePicklist(read('picklist-PL-76120'), { dateOrder: 'MDY' });
const sampleNote = parseSampleNote(read('sample-note-RSMINV26091087'), { dateOrder: 'MDY' });

/* -- Picklist ------------------------------------------------------------- */

test('every Picklist header field is extracted', () => {
  assert.equal(textOf(picklist.picklistNo), 'PL-76120');
  assert.equal(textOf(picklist.status), 'Completed');
  assert.equal(textOf(picklist.customerName), 'Jay Jay Mills Lanka (PVT) Ltd');
  assert.equal(textOf(picklist.createdBy), 'Farhan Fowsor');
  assert.equal(textOf(picklist.location), 'Kelaniya');
  assert.equal(textOf(picklist.assignee), 'Farhan Fowzer');
  assert.equal(textOf(picklist.warehouse), 'SH Ranaviru Warehouse (Warehouse)');
  assert.equal(picklist.totalQty.value, 1.5);
  assert.equal(picklist.warnings.length, 0);
});

test('a wrapped customer name is rejoined, and the next label is not swallowed', () => {
  assert.equal(textOf(picklist.customerName), 'Jay Jay Mills Lanka (PVT) Ltd');
  assert.ok(!textOf(picklist.customerName).includes('Created by'));
});

test('side-by-side summary columns do not bleed into each other', () => {
  // Warehouse, Assignee and TOTAL sit on the same lines. A character-window
  // read picks up the neighbours as soon as one value runs long.
  assert.ok(!textOf(picklist.warehouse).includes('Farhan'));
  assert.ok(!textOf(picklist.assignee).includes('QTY'));
  assert.ok(!textOf(picklist.assignee).includes('1.50'));
});

test('every field carries provenance extracted', () => {
  for (const key of ['picklistNo', 'date', 'status', 'customerName', 'createdBy', 'location']) {
    assert.equal(picklist[key].provenance, 'extracted', key);
  }
});

test('all six Picklist rows are read', () => {
  assert.equal(picklist.lines.length, 6);
  assert.deepEqual(picklist.lines.map((l) => l.index), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    picklist.lines.map((l) => textOf(l.description)),
    ['FW-777-Hybrid White', 'FC-777 Hybrid Clear', '8700T Clear Paste',
      '8700W White Paste', 'REACTANT E-10', 'PES 2072 100-200'],
  );
});

test('a wrapped order number rejoins without a space', () => {
  // Rendered as RSMSO2609 then 0040 on the following line. Joining with a
  // space would give the wrong order number; treating 0040 as row forty would
  // corrupt the whole table.
  assert.ok(picklist.lines.every((l) => textOf(l.orderNo) === 'RSMSO26090040'));
});

test('quantities and units are parsed, including the wrapped unit', () => {
  const [first,, , , reactant] = picklist.lines;
  assert.equal(first.qtyToPick.value, 0.3);
  assert.equal(first.qtyPicked.value, 0.3);
  assert.equal(first.qtyRemaining.value, 0);
  assert.equal(textOf(first.uom), 'kg');
  assert.equal(reactant.qtyPicked.value, 0.1);
});

test('the picked quantities agree with the printed total', () => {
  const summed = picklist.lines.reduce((t, l) => t + l.qtyPicked.value, 0);
  assert.ok(Math.abs(summed - picklist.totalQty.value) < 0.005);
});

/* -- Sample Note ---------------------------------------------------------- */

test('every Sample Note header field is extracted', () => {
  assert.equal(textOf(sampleNote.docNo), 'RSMINV26091087');
  assert.equal(textOf(sampleNote.date), '2026-09-04');
  assert.equal(textOf(sampleNote.shipTo), 'A-6 Seethawaka Export Processing Zone');
  assert.equal(sampleNote.warnings.length, 0);
});

test('the Bill To block does not swallow the date printed beside it', () => {
  const billTo = textOf(sampleNote.billTo);
  assert.match(billTo, /^Jay Jay Mills Lanka \(PVT\) Ltd/);
  assert.match(billTo, /Sri Lanka$/);
  assert.ok(!billTo.includes('Sample Note Date'));
  assert.ok(!billTo.includes('09/04/2026'));
});

test('a value that wraps upward into the line above is still read whole', () => {
  // Place of Supply begins on the line above its own label once the right
  // column runs long.
  assert.equal(
    textOf(sampleNote.placeOfSupply),
    'A6 Seethawaka Export Processing Zone Avissawella Sri Lanka',
  );
});

test('all six Sample Note rows are read with units', () => {
  assert.equal(sampleNote.lines.length, 6);
  assert.equal(textOf(sampleNote.lines[1].description), 'FC-777 Hybrid Clear');
  assert.equal(sampleNote.lines[0].qty.value, 0.3);
  assert.equal(textOf(sampleNote.lines[5].uom), 'kg');
});

test('the signature block terminates the table', () => {
  assert.ok(sampleNote.lines.every((l) => !/Signature/i.test(textOf(l.description))));
});

/* -- Date order ----------------------------------------------------------- */

test('the same Picklist reads a different date under DMY', () => {
  assert.equal(textOf(parsePicklist(read('picklist-PL-76120'), { dateOrder: 'MDY' }).date), '2026-09-04');
  assert.equal(textOf(parsePicklist(read('picklist-PL-76120'), { dateOrder: 'DMY' }).date), '2026-04-09');
});

test('the same Sample Note reads a different date under DMY', () => {
  assert.equal(textOf(parseSampleNote(read('sample-note-RSMINV26091087'), { dateOrder: 'DMY' }).date), '2026-04-09');
});

/* -- Nothing invented ----------------------------------------------------- */

test('a field that is not on the document is missing, never defaulted', () => {
  const stripped = read('picklist-PL-76120').replace(/Picklist#\s*PL-76120/, '');
  const parsed = parsePicklist(stripped, { dateOrder: 'MDY' });
  assert.equal(isPresent(parsed.picklistNo), false);
  assert.equal(parsed.picklistNo.provenance, 'missing');
  assert.ok(parsed.picklistNo.note, 'and it says which label was looked for');
});

/* -- Malformed input ------------------------------------------------------ */

test('a short row is warned about and skipped, not thrown', () => {
  const parsed = parsePicklist(read('picklist-malformed-PL-76122'), { dateOrder: 'MDY' });
  assert.equal(parsed.lines.length, 2, 'the readable rows still come through');
  assert.deepEqual(parsed.lines.map((l) => l.index), [1, 3]);
  const rowWarning = parsed.warnings.find((w) => /row 2/.test(w));
  assert.ok(rowWarning, 'the operator is told which row was lost');
  assert.match(rowWarning, /8700T Clear Paste/, 'and what it said');
});

test('an impossible date becomes a warning and a missing field', () => {
  const parsed = parsePicklist(read('picklist-malformed-PL-76122'), { dateOrder: 'MDY' });
  assert.equal(isPresent(parsed.date), false);
  assert.ok(parsed.warnings.some((w) => /month 13/.test(w)));
  // Read the other way the same document is fine, which is the point of
  // refusing to guess.
  const asDmy = parsePicklist(read('picklist-malformed-PL-76122'), { dateOrder: 'DMY' });
  assert.equal(textOf(asDmy.date), '2026-04-13');
});

test('a missing table is a warning and no rows, not a crash', () => {
  const parsed = parsePicklist('Picklist# PL-99999\nnothing else here\n', { dateOrder: 'MDY' });
  assert.deepEqual(parsed.lines, []);
  assert.ok(parsed.warnings.some((w) => /item table/i.test(w)));
});
