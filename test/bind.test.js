import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBind, resolveParts, tokensIn } from '../src/template/bind.js';
import { TemplateBindError } from '../src/errors.js';
import { field, missing } from '../src/model/types.js';

const context = {
  customer: field('Hi Fashion Holdings Pvt Ltd', 'extracted'),
  docNo: field('RSMINV26091080', 'extracted'),
  manufacturer: field('Miscellaneous Supplier', 'manual'),
  absent: missing(),
};

test('tokensIn lists placeholders in order', () => {
  assert.deepEqual(tokensIn('QTY :- {qtyText} / {uom}'), ['qtyText', 'uom']);
});

test('an unknown token is a template bug and throws', () => {
  assert.throws(
    () => resolveBind('{nope}', context, { slotId: 'header' }),
    (err) => err instanceof TemplateBindError && err.detail.includes('slot=header'),
  );
});

test('a bind whose only token is absent reports itself absent', () => {
  const result = resolveBind('MNF :- {absent}', context);
  assert.equal(result.present, false);
  assert.equal(result.text, '');
});

test('literal text with no tokens is always present', () => {
  assert.deepEqual(resolveBind('QTY', context), { text: 'QTY', present: true });
});

test('resolveParts drops absent parts so no separator is stranded', () => {
  const parts = resolveParts(['{customer}', '{docNo}', 'MANUFACTURER - {manufacturer}'], context);
  assert.deepEqual(parts, [
    'Hi Fashion Holdings Pvt Ltd',
    'RSMINV26091080',
    'MANUFACTURER - Miscellaneous Supplier',
  ]);

  const withoutDoc = resolveParts(
    ['{customer}', '{docNo}', 'MANUFACTURER - {manufacturer}'],
    { ...context, docNo: missing() },
  );
  assert.deepEqual(withoutDoc, [
    'Hi Fashion Holdings Pvt Ltd',
    'MANUFACTURER - Miscellaneous Supplier',
  ]);
  assert.ok(
    !withoutDoc.join(' | ').includes('|  |'),
    'the separator for the dropped part is gone, not left doubled',
  );
});

test('every part absent yields an empty list, not an empty string', () => {
  assert.deepEqual(resolveParts(['{absent}'], context), []);
});

test('a literal prefix drops with its own token, leaving no orphan text', () => {
  // "MANUFACTURER - " on its own would be worse than nothing.
  assert.deepEqual(
    resolveParts(['{customer}', 'MANUFACTURER - {manufacturer}'],
      { ...context, manufacturer: missing() }),
    ['Hi Fashion Holdings Pvt Ltd'],
  );
});
