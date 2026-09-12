/**
 * Input normalising and formatting shared by the grid.
 */

/**
 * Normalise whatever an operator typed into a manufacture or expiry date.
 *
 * `052026`, `05/26`, `5/2026` and `05-2026` all mean the same month, and a
 * warehouse keyboard is not the place to insist on one of them. Anything that
 * cannot be read is returned unchanged: the server prints it as typed and
 * warns, which is better than a silent reinterpretation of a date that ends up
 * on a drum.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseMonthYear(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return '';

  const cleaned = text.replace(/[^\d]/g, '');
  let month;
  let year;

  if (/^\d{1,2}[/\-. ]\d{2}(\d{2})?$/.test(text)) {
    const [m, y] = text.split(/[/\-. ]/);
    month = m;
    year = y;
  } else if (cleaned.length === 6) {
    month = cleaned.slice(0, 2);
    year = cleaned.slice(2);
  } else if (cleaned.length === 4) {
    month = cleaned.slice(0, 2);
    year = cleaned.slice(2);
  } else {
    return text;
  }

  const monthNumber = Number(month);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return text;

  const fullYear = year.length === 2 ? `20${year}` : year;
  if (!/^\d{4}$/.test(fullYear)) return text;

  return `${String(monthNumber).padStart(2, '0')}/${fullYear}`;
}

/**
 * @param {object|null} plan
 * @returns {{ level: 'good'|'tight'|'bad', label: string }}
 */
export function qrVerdict(plan) {
  if (!plan || !plan.magnification) {
    return { level: 'bad', label: 'Too long to encode on this label' };
  }
  if (plan.magnification >= 4) {
    return { level: 'good', label: `${plan.magnification} dots per module — comfortable` };
  }
  if (plan.magnification === 3) {
    return { level: 'tight', label: '3 dots per module — the minimum for a reliable scan' };
  }
  return { level: 'bad', label: `${plan.magnification} dots per module — will scan unreliably` };
}

/** @param {object} field */
export function valueOf(field) {
  return field && field.value !== null && field.value !== undefined ? String(field.value) : '';
}

/** @param {object} field */
export function provenanceOf(field) {
  return field?.provenance ?? 'missing';
}

/**
 * @param {number} count
 * @returns {string}
 */
export function labelCount(count) {
  return `${count} label${count === 1 ? '' : 's'}`;
}
