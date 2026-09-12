import test from 'node:test';
import assert from 'node:assert/strict';
import { field, missing, isPresent, textOf, summariseProvenance, lineStatus } from '../src/model/types.js';

test('an empty value collapses to missing whatever provenance is claimed', () => {
  assert.equal(field('', 'extracted').provenance, 'missing');
  assert.equal(field(null, 'manual').provenance, 'missing');
  assert.equal(field(undefined, 'derived').provenance, 'missing');
});

test('field rejects an unknown provenance rather than storing it', () => {
  assert.throws(() => field('x', 'guessed'), TypeError);
});

test('presence and text extraction handle Fields and bare values alike', () => {
  assert.equal(isPresent(field('abc', 'manual')), true);
  assert.equal(isPresent(missing()), false);
  assert.equal(isPresent('abc'), true);
  assert.equal(isPresent(''), false);
  assert.equal(textOf(field(310, 'derived')), '310');
  assert.equal(textOf(missing()), '');
});

test('summariseProvenance drives the provenance bar', () => {
  const summary = summariseProvenance({
    customer: field('Acme', 'extracted'),
    docNo: missing(),
    category: field('MISC', 'manual'),
    copies: 3,
  });
  assert.equal(summary.total, 3, 'non-Field values are not counted');
  assert.equal(summary.counts.extracted, 1);
  assert.equal(summary.counts.missing, 1);
  assert.deepEqual(summary.missingKeys, ['docNo']);
});

test('a line is ready only when every required field is present', () => {
  const complete = {
    displayName: field('X', 'extracted'), qtyAmount: field('0.30', 'extracted'),
    mnfDate: field('05/2026', 'manual'), expDate: field('05/2028', 'derived'),
    batchCode: field('JUR260725', 'manual'),
  };
  assert.equal(lineStatus(complete), 'ready');
  assert.equal(lineStatus({ ...complete, batchCode: missing() }), 'incomplete');
});
