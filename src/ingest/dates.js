/**
 * Date parsing for extracted documents.
 *
 * The order is supplied by the caller, never guessed. When the configured
 * order produces an impossible date the parse is rejected outright: silently
 * swapping the parts to make it work would mean a document in an unexpected
 * format is read without anyone noticing, which is exactly the failure this
 * module exists to prevent.
 */

import { DateFormatError } from '../errors.js';

const NUMERIC = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

/**
 * @param {string} raw
 * @param {import('../config.js').DateOrder} order
 * @returns {{ iso: string, year: number, month: number, day: number }}
 */
export function parseDocumentDate(raw, order) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new DateFormatError('The document date is blank.');
  }
  const text = raw.trim();
  const match = NUMERIC.exec(text);
  if (!match) {
    throw new DateFormatError(`Could not read "${text}" as a date.`);
  }

  const [, a, b, c] = match.map(Number);
  let year;
  let month;
  let day;

  if (order === 'MDY') { month = a; day = b; year = c; }
  else if (order === 'DMY') { day = a; month = b; year = c; }
  else { year = a; month = b; day = c; }

  year = expandYear(year);

  if (month < 1 || month > 12) {
    throw new DateFormatError(
      `"${text}" is not a valid date when read ${order}: it gives month ${month}. ` +
      'Check STICKER_DATE_ORDER rather than assuming the parts are reversed.',
      { detail: `raw=${text} order=${order} month=${month} day=${day}` },
    );
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new DateFormatError(
      `"${text}" is not a valid date when read ${order}: it gives day ${day} of month ${month}.`,
      { detail: `raw=${text} order=${order}` },
    );
  }

  const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return { iso, year, month, day };
}

/**
 * Two-digit years are pinned to the 2000s. A label system dealing in
 * manufacture and expiry dates has no use for the 1900s, and guessing a
 * century from a pivot year would be another silent assumption.
 * @param {number} year
 * @returns {number}
 */
function expandYear(year) {
  return year < 100 ? 2000 + year : year;
}

/** @param {number} n */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * @param {number} year
 * @param {number} month
 * @returns {number}
 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Format an ISO date as the MM/YYYY the label prints.
 * @param {string} iso
 * @returns {string}
 */
export function toMonthYear(iso) {
  const [year, month] = iso.split('-');
  return `${month}/${year}`;
}

/**
 * Add whole months to an `MM/YYYY` string.
 *
 * Done in month arithmetic rather than with a Date, because a Date rolls
 * 31 January plus one month over into March. The label prints only a month and
 * a year, so days never enter into it.
 *
 * @param {string} monthYear e.g. "05/2026"
 * @param {number} months
 * @returns {string} e.g. "05/2028"
 */
export function addMonths(monthYear, months) {
  const match = /^(\d{1,2})\/(\d{4})$/.exec(String(monthYear).trim());
  if (!match) {
    throw new DateFormatError(`"${monthYear}" is not an MM/YYYY value.`);
  }
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new DateFormatError(`"${monthYear}" has month ${month}.`);
  }
  if (!Number.isInteger(months)) {
    throw new DateFormatError(`Shelf life must be a whole number of months, received ${months}.`);
  }
  const total = year * 12 + (month - 1) + months;
  return `${pad((total % 12) + 1)}/${Math.floor(total / 12)}`;
}

/**
 * Is a string a well-formed MM/YYYY?
 * @param {string} value
 * @returns {boolean}
 */
export function isMonthYear(value) {
  const match = /^(\d{2})\/(\d{4})$/.exec(String(value ?? '').trim());
  return Boolean(match) && Number(match[1]) >= 1 && Number(match[1]) <= 12;
}
