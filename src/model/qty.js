/**
 * Quantity formatting.
 *
 * The unit comes from the document, not from this system. A Picklist line
 * saying `0.30 kg` prints `0.30KG`; one saying `310 ml` prints `310ML`. There
 * is no conversion anywhere, which removes a whole class of way to be wrong:
 * no densities, no fill volumes, no litre arithmetic, nothing to maintain.
 *
 * The numeral is preserved exactly as the document wrote it. `1.000` stays
 * `1.000` rather than becoming `1`, because "as written" is the rule and the
 * trailing zeros are the document's own statement of precision.
 */

/** Units seen on these documents, mapped to how they print. */
const UNIT_DISPLAY = Object.freeze({
  kg: 'KG', kgs: 'KG', g: 'G', gram: 'G', grams: 'G',
  ml: 'ML', mls: 'ML', l: 'L', ltr: 'L', litre: 'L', liter: 'L', lt: 'L',
  pcs: 'PCS', pc: 'PCS', ea: 'EA', unit: 'EA', units: 'EA',
});

/** @typedef {'mass'|'volume'|'count'|'unknown'} UnitKind */

/** @type {Readonly<Record<string, UnitKind>>} */
const UNIT_KIND = Object.freeze({
  KG: 'mass', G: 'mass', ML: 'volume', L: 'volume', PCS: 'count', EA: 'count',
});

/**
 * How a unit should print. An unrecognised unit is passed through uppercased
 * rather than rejected — a new unit on a document should reach the label, not
 * stop the job.
 * @param {string|null|undefined} uom
 * @returns {string}
 */
export function displayUnit(uom) {
  if (!uom) return '';
  const key = String(uom).trim().toLowerCase();
  return UNIT_DISPLAY[key] ?? String(uom).trim().toUpperCase();
}

/**
 * @param {string|null|undefined} uom
 * @returns {UnitKind}
 */
export function unitKind(uom) {
  return UNIT_KIND[displayUnit(uom)] ?? 'unknown';
}

/**
 * Format a quantity for the label's QTY bar.
 *
 *   ("0.30", "kg")  -> "0.30KG"
 *   ("0.04", "KG")  -> "0.04KG"
 *   ("310",  "ml")  -> "310ML"
 *   ("1.000","kg")  -> "1.000KG"
 *   ("2",    null)  -> "2"
 *
 * @param {string|number} amount The numeral exactly as the document wrote it.
 * @param {string|null} [uom]
 * @returns {string}
 */
export function formatQuantity(amount, uom = null) {
  const numeral = String(amount ?? '').trim();
  if (numeral === '') throw new TypeError('A quantity needs an amount.');
  const unit = displayUnit(uom);
  return unit ? `${numeral}${unit}` : numeral;
}

/**
 * Parse the numeric value of a quantity, for arithmetic such as reconciling a
 * Picklist against its own printed total. The label never uses this — it
 * prints the numeral as written.
 * @param {string|number} amount
 * @returns {number|null}
 */
export function amountValue(amount) {
  const parsed = Number(String(amount ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
