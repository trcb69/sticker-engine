/**
 * Batch code validation.
 *
 * This module warns. It never rewrites.
 *
 * A code typed as `JUR26O725` — letter O where a zero belongs — encodes into a
 * perfectly valid Code 128 symbol that scans as a batch nobody entered. That
 * is worse than the typo, because the typo is visible and the silent
 * correction is not. So the operator is told exactly which character looks
 * wrong and what it would become, and the operator decides.
 *
 * The unambiguous-alphabet rule elsewhere in the system applies only to short
 * codes, which are values the system generates for itself. It never touches a
 * batch code, which is a value from the physical world.
 */

/**
 * No format is enforced by default.
 *
 * The batch code appears on none of the source documents — it is pasted or
 * typed from whatever the material carries — so this system has no basis for
 * deciding what a valid one looks like. Set `STICKER_BATCH_PATTERN` if your
 * codes really do follow one shape; then, and only then, a mismatch is worth
 * flagging and a confusable character worth pointing at.
 *
 * @type {RegExp|null}
 */
export const DEFAULT_BATCH_PATTERN = null;

/**
 * Characters an operator confuses at the end of a shift, mapped to what they
 * probably meant. Bidirectional: a letter typed for a digit and a digit typed
 * for a letter are both real.
 * @type {Readonly<Record<string, string>>}
 */
export const CONFUSABLE = Object.freeze({
  O: '0', I: '1', S: '5', B: '8', Z: '2',
  0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z',
});

/**
 * @typedef {object} BatchWarning
 * @property {string} code
 * @property {string} message
 * @property {number} [position] 1-based character index.
 * @property {string} [suggestion} A code that would match. Never applied.
 */

/**
 * @typedef {object} BatchValidation
 * @property {string} value        Exactly what was given. Always.
 * @property {boolean} valid
 * @property {BatchWarning[]} warnings
 */

/**
 * @param {string} raw
 * @param {{ pattern?: RegExp }} [options]
 * @returns {BatchValidation}
 */
export function validateBatchCode(raw, options = {}) {
  const pattern = options.pattern === undefined ? DEFAULT_BATCH_PATTERN : options.pattern;
  const value = typeof raw === 'string' ? raw : '';
  /** @type {BatchWarning[]} */
  const warnings = [];

  if (value.trim() === '') {
    return {
      value,
      valid: false,
      warnings: [{ code: 'BATCH_EMPTY', message: 'No batch code has been entered.' }],
    };
  }

  if (value !== value.trim()) {
    warnings.push({
      code: 'BATCH_WHITESPACE',
      message: 'The batch code has a leading or trailing space, which will be encoded as typed.',
    });
  }

  // Without a configured pattern there is nothing to check against, so any
  // non-empty code is accepted and printed as typed.
  if (!pattern || pattern.test(value)) {
    return { value, valid: true, warnings };
  }

  const fix = findConfusableFix(value, pattern);
  if (fix) {
    warnings.push({
      code: 'BATCH_CONFUSABLE_CHARACTER',
      message:
        `Character ${fix.position} is "${fix.from}". Changing it to "${fix.to}" would give ` +
        `${fix.suggestion}, which matches the expected format. The code will be printed ` +
        'exactly as entered unless you change it.',
      position: fix.position,
      suggestion: fix.suggestion,
    });
  } else {
    warnings.push({
      code: 'BATCH_PATTERN_MISMATCH',
      message:
        `"${value}" does not match the expected batch format (${describe(pattern)}). ` +
        'It will be printed exactly as entered.',
    });
  }

  return { value, valid: false, warnings };
}

/**
 * Find a single confusable substitution that would make the code valid.
 *
 * One substitution only. Two would mean guessing rather than spotting, and a
 * suggestion that is probably wrong is worse than none.
 *
 * @param {string} value
 * @param {RegExp} pattern
 * @returns {{ position: number, from: string, to: string, suggestion: string }|null}
 */
function findConfusableFix(value, pattern) {
  for (let i = 0; i < value.length; i += 1) {
    const from = value[i].toUpperCase();
    const to = CONFUSABLE[from];
    if (!to) continue;
    const candidate = `${value.slice(0, i)}${to}${value.slice(i + 1)}`;
    if (pattern.test(candidate)) {
      return { position: i + 1, from: value[i], to, suggestion: candidate };
    }
  }
  return null;
}

/**
 * Describe the default pattern in words. Anything custom is shown as-is,
 * since only the operator's own organisation knows what it means.
 * @param {RegExp} pattern
 * @returns {string}
 */
function describe(pattern) {
  return pattern.source === '^[A-Z]{3}\\d{6}$'
    ? 'three capital letters followed by six digits, such as JUR260725'
    : pattern.source;
}

/**
 * Find batch codes used more than once in a job.
 *
 * A duplicate is not automatically wrong — a single batch legitimately fills
 * several containers — but two different items sharing a batch code breaks
 * traceability, so it is always surfaced.
 *
 * @param {{ index: number, batchCode: string|null, itemName: string }[]} entries
 * @returns {{ code: string, message: string, batchCode: string, lines: number[] }[]}
 */
export function findDuplicateBatchCodes(entries) {
  /** @type {Map<string, { lines: number[], items: Set<string> }>} */
  const seen = new Map();
  for (const entry of entries) {
    if (!entry.batchCode) continue;
    const key = entry.batchCode.trim().toUpperCase();
    if (!seen.has(key)) seen.set(key, { lines: [], items: new Set() });
    const record = seen.get(key);
    record.lines.push(entry.index);
    record.items.add(entry.itemName);
  }

  const duplicates = [];
  for (const [batchCode, record] of seen) {
    if (record.lines.length < 2) continue;
    const items = [...record.items];
    duplicates.push({
      code: 'BATCH_DUPLICATE',
      batchCode,
      lines: record.lines,
      message: items.length > 1
        ? `Batch ${batchCode} is used on lines ${record.lines.join(', ')} for different items ` +
          `(${items.join(', ')}). That breaks traceability — check before printing.`
        : `Batch ${batchCode} is used on lines ${record.lines.join(', ')}. ` +
          'That is fine if one batch fills several containers.',
    });
  }
  return duplicates;
}
