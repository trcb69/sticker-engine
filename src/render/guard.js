/**
 * Clipping and scannability guard.
 *
 * Zebra prints past the edge of a label without complaint and encodes an
 * unscannable barcode just as happily as a good one. Nothing in the printer
 * will tell you either has happened. This module is the only thing standing
 * between a layout problem and a pallet of bad labels, so it inspects the
 * placed geometry rather than the template, and reports every problem it finds
 * instead of stopping at the first.
 */

import { MIN_BARCODE_DOTS_PER_MODULE, MIN_QR_DOTS_PER_MODULE } from './symbology.js';

/**
 * A slot may set `edge: true` to opt out of the quiet-zone check. That is for
 * artwork placed at the label edge deliberately — the printed border being the
 * only current case. It is an explicit, reviewable decision in the template,
 * not a global relaxation of the margin.
 */

/** Character height below which printed text stops being reliably readable. */
export const MIN_LEGIBLE_TEXT_DOTS = 16;

/** @type {Readonly<Record<string, string>>} */
export const WARNING_CODES = Object.freeze({
  PRINTHEAD_OVERFLOW: 'Artwork extends past the printable width of the printhead.',
  EDGE_OVERFLOW: 'Artwork crosses the edge of the label.',
  QUIET_ZONE_INTRUSION: 'Artwork intrudes into the label quiet zone.',
  BARCODE_TOO_NARROW: 'Barcode modules are too narrow to scan reliably.',
  QR_TOO_DENSE: 'QR modules are too small to scan reliably.',
  QR_PAYLOAD_UNENCODABLE: 'QR payload is too long to encode at this label size.',
  TEXT_ILLEGIBLE: 'Text has shrunk below the legible size.',
  TEXT_TRUNCATED: 'Text was truncated to fit.',
  JOIN_OVERFLOW: 'Too many parts to fit the available lines.',
  SLOT_DROPPED: 'A slot was dropped because its value is absent.',
});

/**
 * @typedef {object} Warning
 * @property {string} code
 * @property {'error'|'warn'|'info'} severity
 * @property {string} slotId
 * @property {string} message Operator-facing.
 * @property {object} [detail] Numbers, for the calibration overlay.
 */

/**
 * @param {import('./layout.js').LayoutResult} placed
 * @param {{ printheadWidth?: number, minTextDots?: number }} [options]
 * @returns {Warning[]}
 */
export function guard(placed, options = {}) {
  /** @type {Warning[]} */
  const warnings = [];
  const printhead = options.printheadWidth ?? placed.width;
  const minText = options.minTextDots ?? MIN_LEGIBLE_TEXT_DOTS;
  const quiet = placed.quietZone;

  const add = (code, severity, slotId, message, detail) =>
    warnings.push({ code, severity, slotId, message, ...(detail ? { detail } : {}) });

  for (const el of placed.elements) {
    const right = el.x + el.w;
    const bottom = el.y + el.h;

    // Three distinct clipping sources, reported separately because the fix
    // differs: a narrower printhead, artwork off the label, and margin creep.
    if (right > printhead) {
      add('PRINTHEAD_OVERFLOW', 'error', el.id,
        `"${el.id}" extends ${right - printhead} dots past the printhead. It will be cut off.`,
        { right, printhead });
    }
    if (right > placed.width || bottom > placed.height || el.x < 0 || el.y < 0) {
      add('EDGE_OVERFLOW', 'error', el.id,
        `"${el.id}" crosses the edge of the label.`,
        { x: el.x, y: el.y, right, bottom, width: placed.width, height: placed.height });
    } else if (
      quiet > 0 && !el.edge &&
      (el.x < quiet || el.y < quiet || right > placed.width - quiet || bottom > placed.height - quiet)
    ) {
      add('QUIET_ZONE_INTRUSION', 'warn', el.id,
        `"${el.id}" sits inside the ${quiet} dot quiet zone and may clip on a misfed label.`,
        { x: el.x, y: el.y, right, bottom, quiet });
    }

    if (el.kind === 'barcode') {
      const dpm = el.plan.dotsPerModule;
      if (dpm < MIN_BARCODE_DOTS_PER_MODULE) {
        add('BARCODE_TOO_NARROW', 'error', el.id,
          `The barcode has only ${dpm.toFixed(2)} dots per module (${MIN_BARCODE_DOTS_PER_MODULE} needed). ` +
          'It will scan unreliably. Shorten the quantity or date text to give it more room.',
          { dotsPerModule: dpm, modules: el.plan.modules, available: el.w });
      }
    }

    if (el.kind === 'qr') {
      if (!el.plan.version) {
        add('QR_PAYLOAD_UNENCODABLE', 'error', el.id,
          'The QR link is too long to encode on a label this size. Shorten it first.',
          { length: el.data.length, mode: el.plan.mode });
      } else if (el.plan.magnification < MIN_QR_DOTS_PER_MODULE) {
        add('QR_TOO_DENSE', 'error', el.id,
          `The QR has only ${el.plan.magnification} dots per module (${MIN_QR_DOTS_PER_MODULE} needed). ` +
          'Shorten the link — encoding it in uppercase also helps.',
          {
            magnification: el.plan.magnification,
            modules: el.plan.totalModules,
            mode: el.plan.mode,
            budget: el.budget,
          });
      }
    }

    if (el.kind === 'text') {
      if (el.size < minText) {
        add('TEXT_ILLEGIBLE', 'warn', el.id,
          `"${el.id}" shrank to ${el.size} dots, below the ${minText} dot legible size.`,
          { size: el.size, declaredSize: el.declaredSize, floor: minText });
      }
      if (el.overflowLines) {
        add('JOIN_OVERFLOW', 'error', el.id,
          `"${el.id}" has more content than the available lines can hold. Some of it is not printed.`,
          { size: el.size });
      } else if (el.truncated) {
        add('TEXT_TRUNCATED', 'warn', el.id,
          `"${el.id}" was truncated to fit.`,
          { size: el.size, width: el.w });
      }
    }
  }

  for (const id of placed.skipped) {
    add('SLOT_DROPPED', 'info', id, `"${id}" is not printed because its value is absent.`);
  }

  return warnings;
}

/**
 * True when nothing found would produce a bad label.
 * @param {Warning[]} warnings
 * @returns {boolean}
 */
export function isPrintable(warnings) {
  return !warnings.some((w) => w.severity === 'error');
}
