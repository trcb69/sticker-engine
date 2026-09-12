import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBatchCode, findDuplicateBatchCodes, DEFAULT_BATCH_PATTERN, CONFUSABLE } from '../src/enrich/batch.js';

test('a well-formed batch code passes with no warnings', () => {
  const result = validateBatchCode('JUR260725', { pattern: /^[A-Z]{3}\d{6}$/ });
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.value, 'JUR260725');
});

test('no format is enforced by default, because the code comes from outside', () => {
  // The batch code is on none of the source documents. It is pasted from
  // whatever the material carries, so this system has no basis for deciding
  // what a valid one looks like.
  assert.equal(DEFAULT_BATCH_PATTERN, null);
  for (const anything of ['JUR260725', 'lot 44/b (drum 3)', '2026-07-25/A', 'x']) {
    const result = validateBatchCode(anything);
    assert.equal(result.valid, true, anything);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.value, anything);
  }
});

test('an empty code is still refused, whatever the pattern', () => {
  assert.deepEqual(validateBatchCode('').warnings.map((w) => w.code), ['BATCH_EMPTY']);
});

test('the value is returned unchanged whatever is wrong with it', () => {
  // This is the whole point of the module. A silently corrected code produces
  // a barcode that scans as a batch nobody typed.
  for (const input of ['JUR26O725', 'jur260725', '  JUR260725  ', 'XX', '']) {
    assert.equal(validateBatchCode(input).value, input, JSON.stringify(input));
  }
});

const STRICT = { pattern: /^[A-Z]{3}\d{6}$/ };

test('a letter typed for a digit is pinpointed with a suggestion', () => {
  const result = validateBatchCode('JUR26O725', STRICT);
  assert.equal(result.valid, false);
  const [warning] = result.warnings;
  assert.equal(warning.code, 'BATCH_CONFUSABLE_CHARACTER');
  assert.equal(warning.position, 6);
  assert.equal(warning.suggestion, 'JUR260725');
  assert.match(warning.message, /printed exactly as entered/);
});

test('each confusable pair is caught in both directions', () => {
  assert.equal(validateBatchCode('JUR26I725', STRICT).warnings[0].suggestion, 'JUR261725');
  assert.equal(validateBatchCode('JUR26S725', STRICT).warnings[0].suggestion, 'JUR265725');
  // A digit typed where a letter belongs.
  assert.equal(validateBatchCode('JU5260725', STRICT).warnings[0].suggestion, 'JUS260725');
  assert.equal(CONFUSABLE.O, '0');
  assert.equal(CONFUSABLE['0'], 'O');
});

test('a code needing two corrections gets no guess, only a format warning', () => {
  // Suggesting a code that is probably wrong is worse than suggesting none.
  const result = validateBatchCode('JUR26O72S', STRICT);
  assert.equal(result.warnings[0].code, 'BATCH_PATTERN_MISMATCH');
  assert.equal(result.warnings[0].suggestion, undefined);
});

test('an unrecognisable code explains the expected format in words', () => {
  assert.match(validateBatchCode('hello', STRICT).warnings[0].message, /three capital letters/);
});

test('an empty code is its own warning', () => {
  assert.deepEqual(validateBatchCode('').warnings.map((w) => w.code), ['BATCH_EMPTY']);
  assert.deepEqual(validateBatchCode('   ').warnings.map((w) => w.code), ['BATCH_EMPTY']);
});

test('stray whitespace is flagged, because it is encoded too', () => {
  const result = validateBatchCode(' JUR260725');
  assert.ok(result.warnings.some((w) => w.code === 'BATCH_WHITESPACE'));
  assert.equal(result.value, ' JUR260725');
});

test('a custom pattern replaces the default entirely', () => {
  const pattern = /^LOT-\d{4}$/;
  assert.equal(validateBatchCode('LOT-1234', { pattern }).valid, true);
  assert.equal(validateBatchCode('JUR260725', { pattern }).valid, false);
  assert.match(validateBatchCode('X', { pattern }).warnings[0].message, /LOT/);
});

test('one batch across several containers is noted without alarm', () => {
  const [duplicate] = findDuplicateBatchCodes([
    { index: 1, batchCode: 'JUR260725', itemName: 'Win-Poly Blue 7007' },
    { index: 2, batchCode: 'JUR260725', itemName: 'Win-Poly Blue 7007' },
  ]);
  assert.match(duplicate.message, /fine if one batch fills several containers/);
});

test('one batch across different items is called out as a traceability problem', () => {
  const [duplicate] = findDuplicateBatchCodes([
    { index: 1, batchCode: 'JUR260725', itemName: 'Win-Poly Blue 7007' },
    { index: 3, batchCode: 'JUR260725', itemName: 'Clear Paste 8700T' },
  ]);
  assert.match(duplicate.message, /breaks traceability/);
  assert.deepEqual(duplicate.lines, [1, 3]);
});

test('duplicate detection is case-insensitive and ignores blanks', () => {
  const duplicates = findDuplicateBatchCodes([
    { index: 1, batchCode: 'jur260725', itemName: 'A' },
    { index: 2, batchCode: 'JUR260725', itemName: 'A' },
    { index: 3, batchCode: null, itemName: 'B' },
    { index: 4, batchCode: null, itemName: 'C' },
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].batchCode, 'JUR260725');
});

test('distinct codes raise nothing', () => {
  assert.deepEqual(findDuplicateBatchCodes([
    { index: 1, batchCode: 'JUR260725', itemName: 'A' },
    { index: 2, batchCode: 'JUR260726', itemName: 'B' },
  ]), []);
});
