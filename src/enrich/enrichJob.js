/**
 * Enrichment.
 *
 * Almost everything on the label now comes straight off a document: the item
 * name and quantity are printed verbatim from the Picklist, and the unit is
 * whatever that document stated. There is no item master, no lookup table and
 * no unit conversion, so this module has only three jobs left — default the
 * manufacturer, check the operator's manual entries, and work out whether a
 * line is ready to print.
 *
 * The rule that survives from before still holds: an operator's edit wins.
 * Once a field is `manual`, nothing here touches it. Enrichment re-runs on
 * every keystroke that changes a date, and it must not overwrite what was just
 * typed.
 */

import { field, isPresent, lineStatus, textOf } from '../model/types.js';
import { isMonthYear } from '../ingest/dates.js';
import { findDuplicateBatchCodes, validateBatchCode } from './batch.js';

/**
 * @typedef {object} EnrichWarning
 * @property {string} code
 * @property {'error'|'warn'|'info'} severity
 * @property {number} [line] 1-based line index.
 * @property {string} message
 * @property {object} [detail]
 */

/**
 * @param {import('../model/types.js').LabelJob} job
 * @param {{ config: import('../config.js').Config }} deps
 * @returns {{ job: import('../model/types.js').LabelJob, warnings: EnrichWarning[] }}
 */
export function enrichJob(job, deps) {
  const { config } = deps;
  /** @type {EnrichWarning[]} */
  const warnings = [];

  const lines = job.lines.map((line) => enrichLine(line, config, warnings));

  for (const duplicate of findDuplicateBatchCodes(lines.map((line) => ({
    index: line.index,
    batchCode: isPresent(line.batchCode) ? textOf(line.batchCode) : null,
    itemName: textOf(line.displayName),
  })))) {
    warnings.push({
      code: duplicate.code,
      severity: 'warn',
      message: duplicate.message,
      detail: { batchCode: duplicate.batchCode, lines: duplicate.lines },
    });
  }

  const manufacturer = isPresent(job.manufacturer)
    ? job.manufacturer
    : (config.defaultManufacturer
      ? field(config.defaultManufacturer, 'derived', 'Default manufacturer')
      : job.manufacturer);

  if (!isPresent(manufacturer)) {
    warnings.push({
      code: 'MANUFACTURER_MISSING',
      severity: 'warn',
      message: 'No manufacturer has been entered. It appears on no document, so it must be pasted in.',
    });
  }

  return { job: { ...job, manufacturer, lines }, warnings };
}

/**
 * @param {import('../model/types.js').LabelLine} line
 * @param {import('../config.js').Config} config
 * @param {EnrichWarning[]} warnings
 * @returns {import('../model/types.js').LabelLine}
 */
function enrichLine(line, config, warnings) {
  const next = { ...line };

  if (!isPresent(next.qtyUom) && isPresent(next.qtyAmount)) {
    warnings.push({
      code: 'QTY_UNIT_MISSING',
      severity: 'warn',
      line: line.index,
      message:
        `Line ${line.index} has a quantity of ${textOf(next.qtyAmount)} but no unit on the ` +
        'Picklist. It will print without one.',
    });
  }

  for (const key of ['mnfDate', 'expDate']) {
    if (isPresent(next[key]) && !isMonthYear(textOf(next[key]))) {
      warnings.push({
        code: key === 'mnfDate' ? 'MNF_DATE_FORMAT' : 'EXP_DATE_FORMAT',
        severity: 'warn',
        line: line.index,
        message:
          `Line ${line.index}: "${textOf(next[key])}" is not in MM/YYYY form. ` +
          'It will print exactly as entered.',
      });
    }
  }

  if (isPresent(next.mnfDate) && isPresent(next.expDate)
    && isMonthYear(textOf(next.mnfDate)) && isMonthYear(textOf(next.expDate))
    && monthIndex(textOf(next.expDate)) < monthIndex(textOf(next.mnfDate))) {
    warnings.push({
      code: 'EXPIRY_BEFORE_MANUFACTURE',
      severity: 'error',
      line: line.index,
      message:
        `Line ${line.index} expires ${textOf(next.expDate)}, before it was made ` +
        `(${textOf(next.mnfDate)}). One of the two dates is wrong.`,
    });
  }

  if (isPresent(next.batchCode)) {
    const validation = validateBatchCode(textOf(next.batchCode), { pattern: config.batchPattern });
    for (const warning of validation.warnings) {
      warnings.push({
        code: warning.code,
        severity: 'warn',
        line: line.index,
        message: warning.message,
        detail: warning.suggestion ? { suggestion: warning.suggestion } : undefined,
      });
    }
  }

  next.status = lineStatus(next);
  return next;
}

/**
 * @param {string} monthYear
 * @returns {number} months since year zero, for ordering only
 */
function monthIndex(monthYear) {
  const [month, year] = monthYear.split('/').map(Number);
  return year * 12 + month;
}
