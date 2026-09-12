import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePicklist } from '../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../src/ingest/parseSampleNote.js';
import { parseSalesOrder } from '../src/ingest/parseSalesOrder.js';
import { joinToJob, normaliseDescription } from '../src/ingest/join.js';
import { JoinError } from '../src/errors.js';
import { isPresent, textOf } from '../src/model/types.js';
import { formatQuantity } from '../src/model/qty.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
const opts = { dateOrder: 'MDY' };
const fixed = { id: 'job-test', now: '2026-09-06T00:00:00.000Z' };

const sampleNote = parseSampleNote(read('sample-note-RSMINV26091087'), opts);
const picklist = parsePicklist(read('picklist-PL-76120'), opts);
const partial = parsePicklist(read('picklist-partial-PL-76121'), opts);
const salesOrder = parseSalesOrder(read('sales-order-RSMSO26090032'), opts);

test('normalisation ignores case, punctuation and repeated spaces', () => {
  assert.equal(normaliseDescription('FW-777-Hybrid White'), 'fw 777 hybrid white');
  assert.equal(normaliseDescription('fw 777  hybrid   white'), 'fw 777 hybrid white');
  assert.equal(normaliseDescription('8700T Clear Paste'), '8700t clear paste');
});

test('the matching documents produce six matches and nothing else', () => {
  const { buckets, warnings } = joinToJob({ sampleNote, picklist }, fixed);
  assert.equal(buckets.matched.length, 6);
  assert.equal(buckets.orderedOnly.length, 0);
  assert.equal(buckets.picklistOnly.length, 0);
  assert.deepEqual(warnings, []);
});

test('the job records all three source document numbers', () => {
  const { job } = joinToJob({ sampleNote, picklist, salesOrder }, fixed);
  assert.deepEqual(job.source, {
    salesOrderNo: 'RSMSO26090032',
    sampleNoteNo: 'RSMINV26091087',
    picklistNo: 'PL-76120',
  });
  assert.equal(textOf(job.docNo), 'RSMINV26091087', 'the header prints the Sample Note number');
});

test('a label line carries the Picklist name and quantity untouched', () => {
  const { job } = joinToJob({ sampleNote, picklist }, fixed);
  assert.equal(job.lines.length, 6);
  const [first] = job.lines;
  assert.equal(textOf(first.displayName), 'FW-777-Hybrid White');
  assert.equal(textOf(first.qtyAmount), '0.30');
  assert.equal(textOf(first.qtyUom), 'kg');
  assert.equal(formatQuantity(textOf(first.qtyAmount), textOf(first.qtyUom)), '0.30KG');
  assert.equal(first.status, 'incomplete');
  assert.equal(first.copies, 1);
});

test('the three manual fields are left absent, each saying what it waits for', () => {
  const { job } = joinToJob({ sampleNote, picklist }, fixed);
  for (const key of ['mnfDate', 'expDate', 'batchCode']) {
    assert.equal(isPresent(job.lines[0][key]), false, key);
    assert.match(job.lines[0][key].note, /operator/i, key);
  }
  assert.equal(isPresent(job.manufacturer), false);
});

test('an item ordered but not picked gets no label, and the operator is told', () => {
  const { buckets, warnings, job } = joinToJob({ sampleNote, picklist: partial }, fixed);
  assert.equal(buckets.matched.length, 4);
  assert.deepEqual(buckets.orderedOnly.map((e) => e.description),
    ['FC-777 Hybrid Clear', 'PES 2072 100-200']);
  assert.ok(warnings.some((w) => /FC-777 Hybrid Clear/.test(w) && /not picked/.test(w)));
  assert.ok(!job.lines.some((l) => textOf(l.displayName) === 'FC-777 Hybrid Clear'));
});

test('an item picked but not ordered still gets a label', () => {
  const { buckets, job } = joinToJob({ sampleNote, picklist: partial }, fixed);
  assert.deepEqual(buckets.picklistOnly.map((e) => e.description), ['ZX-900 Bonding Agent']);
  assert.ok(job.lines.some((l) => textOf(l.displayName) === 'ZX-900 Bonding Agent'));
});

test('a Sales Order stands in for the Sample Note when matching lines', () => {
  const { buckets } = joinToJob({ salesOrder, picklist }, fixed);
  assert.equal(buckets.matched.length, 0, 'different job, no shared items');
  assert.equal(buckets.picklistOnly.length, 6);
  assert.deepEqual(buckets.orderedOnly.map((e) => e.source), ['Sales Order', 'Sales Order']);
});

test('a Picklist alone produces a job with the document number missing', () => {
  const { job, warnings } = joinToJob({ picklist }, fixed);
  assert.equal(job.lines.length, 6);
  assert.equal(isPresent(job.docNo), false);
  assert.equal(job.source.sampleNoteNo, null);
  assert.equal(textOf(job.customer), 'Jay Jay Mills Lanka (PVT) Ltd');
  assert.ok(warnings.some((w) => /no document number/i.test(w)));
});

test('a Sample Note alone yields no labels and says why', () => {
  const { job, warnings } = joinToJob({ sampleNote }, fixed);
  assert.deepEqual(job.lines, []);
  assert.equal(textOf(job.docNo), 'RSMINV26091087');
  assert.ok(warnings.some((w) => /nothing to label/i.test(w)));
});

test('the customer comes from the Picklist first, then a Bill To address', () => {
  assert.equal(textOf(joinToJob({ sampleNote, picklist }, fixed).job.customer),
    'Jay Jay Mills Lanka (PVT) Ltd');

  const fromSalesOrder = joinToJob({ salesOrder }, fixed).job.customer;
  assert.equal(textOf(fromSalesOrder), 'Hi Fashion Holdings Pvt Ltd');
  assert.equal(fromSalesOrder.provenance, 'derived', 'the first line of an address is a derivation');

  const fromSampleNote = joinToJob({ sampleNote }, fixed).job.customer;
  assert.equal(textOf(fromSampleNote), 'Jay Jay Mills Lanka (PVT) Ltd');
  assert.equal(fromSampleNote.provenance, 'derived');
});

test('no documents at all is an error', () => {
  assert.throws(() => joinToJob({}, fixed), JoinError);
  assert.throws(() => joinToJob(null, fixed), JoinError);
});

test('parser warnings are carried through to the job', () => {
  const malformed = parsePicklist(read('picklist-malformed-PL-76122'), opts);
  const { warnings } = joinToJob({ sampleNote, picklist: malformed }, fixed);
  assert.ok(warnings.some((w) => /row 2/.test(w)), 'the dropped row is still visible');
});

test('picked quantities are reconciled against the printed total', () => {
  // The check that catches a row the parser could not read: what remains sums
  // short of the total the document itself states.
  const malformed = parsePicklist(read('picklist-malformed-PL-76122'), opts);
  const { warnings } = joinToJob({ picklist: malformed }, fixed);
  const mismatch = warnings.find((w) => /add up to/.test(w));
  assert.match(mismatch, /add up to 0\.60/);
  assert.match(mismatch, /states 0\.90/);
});

test('a clean Picklist raises no reconciliation warning', () => {
  assert.ok(!joinToJob({ picklist }, fixed).warnings.some((w) => /add up to/.test(w)));
});

test('a Picklist mixing units is not reconciled, because there is no single total', () => {
  const mixed = {
    ...picklist,
    lines: [
      { ...picklist.lines[0], uom: { value: 'kg', provenance: 'extracted' } },
      { ...picklist.lines[1], uom: { value: 'ml', provenance: 'extracted' } },
    ],
  };
  assert.ok(!joinToJob({ picklist: mixed }, fixed).warnings.some((w) => /add up to/.test(w)));
});

test('a repeated item is matched once per occurrence, not reused', () => {
  const twice = {
    ...picklist,
    lines: [picklist.lines[0], { ...picklist.lines[0], index: 7 }],
    totalQty: { value: 0.6, provenance: 'extracted' },
  };
  const { buckets } = joinToJob({ sampleNote, picklist: twice }, fixed);
  assert.equal(buckets.matched.length, 1, 'the Sample Note only lists it once');
  assert.equal(buckets.picklistOnly.length, 1, 'the second pick has nothing left to match');
});
