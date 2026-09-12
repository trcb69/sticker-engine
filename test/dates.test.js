import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentDate, toMonthYear, daysInMonth } from '../src/ingest/dates.js';
import { DateFormatError } from '../src/errors.js';

test('the same string reads differently under each order, as it must', () => {
  assert.equal(parseDocumentDate('09/04/2026', 'MDY').iso, '2026-09-04');
  assert.equal(parseDocumentDate('09/04/2026', 'DMY').iso, '2026-04-09');
  assert.equal(parseDocumentDate('2026/09/04', 'YMD').iso, '2026-09-04');
});

test('an impossible month is rejected, never quietly swapped', () => {
  assert.throws(
    () => parseDocumentDate('13/04/2026', 'MDY'),
    (error) => error instanceof DateFormatError && /month 13/.test(error.message),
  );
  // The same string is perfectly valid the other way round. Reading it that
  // way anyway is exactly the silent corruption this rejection prevents.
  assert.equal(parseDocumentDate('13/04/2026', 'DMY').iso, '2026-04-13');
});

test('an impossible day is rejected too', () => {
  assert.throws(() => parseDocumentDate('02/30/2026', 'MDY'), DateFormatError);
  assert.throws(() => parseDocumentDate('02/29/2026', 'MDY'), DateFormatError, 'not a leap year');
  assert.equal(parseDocumentDate('02/29/2028', 'MDY').iso, '2028-02-29');
});

test('separators vary between systems', () => {
  for (const raw of ['09/04/2026', '09-04-2026', '09.04.2026']) {
    assert.equal(parseDocumentDate(raw, 'MDY').iso, '2026-09-04');
  }
});

test('two-digit years are pinned to the 2000s rather than pivoted', () => {
  assert.equal(parseDocumentDate('09/04/26', 'MDY').iso, '2026-09-04');
});

test('unparseable input is an error, not a null date', () => {
  assert.throws(() => parseDocumentDate('', 'MDY'), DateFormatError);
  assert.throws(() => parseDocumentDate('Sept 4', 'MDY'), DateFormatError);
  assert.throws(() => parseDocumentDate(null, 'MDY'), DateFormatError);
});

test('month lengths are real, not assumed', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 9), 30);
});

test('toMonthYear renders the MM/YYYY the label prints', () => {
  assert.equal(toMonthYear('2026-05-04'), '05/2026');
});
