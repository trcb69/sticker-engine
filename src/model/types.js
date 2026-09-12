/**
 * Domain typedefs and the Field wrapper.
 *
 * Every mutable label value is wrapped in a Field so its origin travels with
 * it. The UI provenance bar (requirement D2) reads these directly, and slots
 * that resolve to a `missing` Field are dropped from the label rather than
 * rendered as a blank or a stray separator.
 */

/** @typedef {'extracted'|'derived'|'manual'|'missing'} Provenance */

/**
 * @template T
 * @typedef {object} Field
 * @property {T|null} value
 * @property {Provenance} provenance
 * @property {string} [note] Operator-facing explanation, e.g. why a match was fuzzy.
 */

/** @type {readonly Provenance[]} */
export const PROVENANCES = Object.freeze(['extracted', 'derived', 'manual', 'missing']);

/**
 * Build a populated Field. An empty value collapses to `missing` regardless of
 * the provenance asked for, so "extracted but blank" cannot exist.
 * @template T
 * @param {T|null|undefined} value
 * @param {Provenance} provenance
 * @param {string} [note]
 * @returns {Field<T>}
 */
export function field(value, provenance, note) {
  if (!PROVENANCES.includes(provenance)) {
    throw new TypeError(`Unknown provenance: ${provenance}`);
  }
  if (value === undefined || value === null || value === '') return missing(note);
  return note === undefined ? { value, provenance } : { value, provenance, note };
}

/**
 * Build an absent Field. Absent is a first-class state, not null.
 * @template T
 * @param {string} [note]
 * @returns {Field<T>}
 */
export function missing(note) {
  return note === undefined
    ? { value: null, provenance: 'missing' }
    : { value: null, provenance: 'missing', note };
}

/**
 * @param {unknown} candidate
 * @returns {boolean}
 */
export function isField(candidate) {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'provenance' in candidate &&
    'value' in candidate &&
    PROVENANCES.includes(candidate.provenance)
  );
}

/**
 * True when a value carries usable content. Accepts bare values so callers may
 * pass either a Field or a plain string.
 * @param {unknown} candidate
 * @returns {boolean}
 */
export function isPresent(candidate) {
  if (!isField(candidate)) {
    return candidate !== undefined && candidate !== null && candidate !== '';
  }
  return candidate.provenance !== 'missing' && candidate.value !== null && candidate.value !== '';
}

/**
 * Unwrap a Field (or bare value) to its rendered string form. Absent values
 * yield the empty string, which callers treat as "drop this slot".
 * @param {unknown} candidate
 * @returns {string}
 */
export function textOf(candidate) {
  if (!isPresent(candidate)) return '';
  return String(isField(candidate) ? candidate.value : candidate);
}

/**
 * Summarise provenance across a record of Fields, for the UI provenance bar.
 * @param {Record<string, unknown>} record
 * @returns {{ total: number, counts: Record<Provenance, number>, missingKeys: string[] }}
 */
export function summariseProvenance(record) {
  /** @type {Record<Provenance, number>} */
  const counts = { extracted: 0, derived: 0, manual: 0, missing: 0 };
  /** @type {string[]} */
  const missingKeys = [];
  let total = 0;
  for (const [key, value] of Object.entries(record)) {
    if (!isField(value)) continue;
    total += 1;
    counts[value.provenance] += 1;
    if (value.provenance === 'missing') missingKeys.push(key);
  }
  return { total, counts, missingKeys };
}

/* -------------------------------------------------------------------------- */
/* Source documents                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} SampleNoteLine
 * @property {number} index
 * @property {Field<string>} description
 * @property {Field<number>} qty
 * @property {Field<string>} uom
 */

/**
 * @typedef {object} SampleNote
 * @property {Field<string>} docNo          e.g. RSMINV26091087
 * @property {Field<string>} date           ISO yyyy-mm-dd, resolved via STICKER_DATE_ORDER
 * @property {Field<string>} billTo
 * @property {Field<string>} shipTo
 * @property {Field<string>} placeOfSupply
 * @property {SampleNoteLine[]} lines
 * @property {string[]} warnings            Rows that could not be parsed, verbatim.
 */

/**
 * @typedef {object} PicklistLine
 * @property {number} index
 * @property {Field<string>} description
 * @property {Field<string>} orderNo
 * @property {Field<string>} qtyToPickAmount Numeral as written.
 * @property {Field<string>} qtyPickedAmount Numeral as written; this is what prints.
 * @property {Field<number>} qtyToPick
 * @property {Field<number>} qtyPicked
 * @property {Field<number>} qtyRemaining
 * @property {Field<string>} uom
 */

/**
 * @typedef {object} Picklist
 * @property {Field<string>} picklistNo     e.g. PL-76120
 * @property {Field<string>} date
 * @property {Field<string>} status
 * @property {Field<string>} customerName
 * @property {Field<string>} createdBy
 * @property {Field<string>} location
 * @property {Field<string>} warehouse
 * @property {Field<string>} assignee
 * @property {Field<number>} totalQty
 * @property {PicklistLine[]} lines
 * @property {string[]} warnings
 */

/**
 * @typedef {object} SalesOrderLine
 * @property {number} index
 * @property {Field<string>} description
 * @property {Field<string>} qtyAmount      Numeral as written.
 * @property {Field<string>} uom
 */

/**
 * @typedef {object} SalesOrder
 * @property {Field<string>} orderNo        e.g. RSMSO26090032
 * @property {Field<string>} date
 * @property {Field<string>} billTo
 * @property {Field<string>} customerName   First line of Bill To.
 * @property {Field<string>} salesPerson
 * @property {Field<string>} createdBy
 * @property {Field<string>} placeOfSupply
 * @property {SalesOrderLine[]} lines
 * @property {string[]} warnings
 */

/* -------------------------------------------------------------------------- */
/* Label job                                                                   */
/* -------------------------------------------------------------------------- */

/** @typedef {'incomplete'|'ready'} LineStatus */

/**
 * @typedef {object} LabelLine
 * @property {number} index
 * @property {Field<string>} displayName    The Picklist description, printed verbatim.
 * @property {Field<string>} qtyAmount      The numeral exactly as the document wrote it.
 * @property {Field<string>} qtyUom         The unit as stated on the document.
 * @property {Field<string>} mnfDate        MM/YYYY as printed.
 * @property {Field<string>} expDate        MM/YYYY as printed.
 * @property {Field<string>} batchCode      Encoded verbatim. Never rewritten.
 * @property {number} copies
 * @property {LineStatus} status
 */

/**
 * @typedef {object} LabelJobSource
 * @property {string|null} sampleNoteNo
 * @property {string|null} picklistNo
 */

/**
 * @typedef {object} LabelJob
 * @property {string} id
 * @property {string} createdAt             ISO 8601.
 * @property {LabelJobSource} source
 * @property {Field<string>} customer
 * @property {Field<string>} docNo
 * @property {Field<string>} manufacturer   Pasted by the operator; printed after
 *   a fixed "MANUFACTURER - " prefix.
 * @property {Field<string>} qrUrl          The full pasted target URL.
 * @property {Field<string>} qrShortCode    Minted on Proceed; the QR encodes this.
 * @property {LabelLine[]} lines
 */

/**
 * Fields that must all be present before a line may be printed.
 * @type {readonly string[]}
 */
export const REQUIRED_LINE_FIELDS = Object.freeze([
  'displayName', 'qtyAmount', 'mnfDate', 'expDate', 'batchCode',
]);

/**
 * @param {LabelLine} line
 * @returns {LineStatus}
 */
export function lineStatus(line) {
  return REQUIRED_LINE_FIELDS.every((k) => isPresent(line[k])) ? 'ready' : 'incomplete';
}
