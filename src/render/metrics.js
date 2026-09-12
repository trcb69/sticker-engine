/**
 * Text metrics for Zebra scalable font `^A0`.
 *
 * APPROXIMATION — READ BEFORE TRUSTING THESE NUMBERS.
 *
 * Zebra does not publish glyph advance tables for font 0, and the printer
 * itself is the only authority on what a string measures. This module models
 * font 0 as a Helvetica-metric proportional face: per-character advances
 * expressed in units of 1/1000 em, scaled by `EM_PER_DOT_HEIGHT` to convert
 * the ZPL character height parameter into an em size.
 *
 * The constants below were calibrated against rendered samples at 203 dpi and
 * land within a few percent on mixed-case strings. That is not good enough to
 * place text flush against an edge, which is why every caller applies
 * `SAFETY_MARGIN` and why `guard.js` re-checks the result. Treat a measurement
 * as "will fit comfortably", never as "will fit exactly".
 *
 * Calibrating against your own printer: print a known string, measure it, and
 * adjust `EM_PER_DOT_HEIGHT`. It is the only constant that should need to move.
 */

/**
 * Em size as a fraction of the ZPL character height parameter.
 *
 * Calibrated so that measurements agree with the 203 dpi layout samples the
 * template geometry was validated against. Deliberately biased high: an
 * over-estimate makes text shrink a little more than it strictly needs to,
 * which is harmless, whereas an under-estimate lets text run off the label,
 * which is not. When calibrating against a real printer, only move this
 * downward if printed samples are clearly smaller than the preview.
 */
export const EM_PER_DOT_HEIGHT = 0.96;

/** Multiplier applied when a field is double-struck to fake bold. */
export const BOLD_WIDTH_FACTOR = 1.04;

/** Fraction of the available width a string must fit inside to count as fitting. */
export const SAFETY_MARGIN = 0.94;

/** Advance width used for any character absent from the table. */
const DEFAULT_ADVANCE = 556;

/**
 * Advance widths in 1/1000 em, Helvetica metrics.
 * @type {Readonly<Record<string, number>>}
 */
const ADVANCE = Object.freeze({
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
});

/**
 * Estimated rendered width of a string in printer dots.
 * @param {string} text
 * @param {number} height ZPL character height in dots.
 * @param {{ bold?: boolean }} [options]
 * @returns {number} Width in dots, rounded up.
 */
export function measure(text, height, options = {}) {
  if (typeof text !== 'string') throw new TypeError('measure expects a string');
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`Character height must be positive, received ${String(height)}`);
  }
  let thousandths = 0;
  for (const ch of text) thousandths += ADVANCE[ch] ?? DEFAULT_ADVANCE;
  const width = (thousandths / 1000) * height * EM_PER_DOT_HEIGHT;
  return Math.ceil(width * (options.bold ? BOLD_WIDTH_FACTOR : 1));
}

/**
 * Does a string fit within a width, with the safety margin applied?
 * @param {string} text
 * @param {number} height
 * @param {number} maxWidth
 * @param {{ bold?: boolean }} [options]
 * @returns {boolean}
 */
export function fitsWithin(text, height, maxWidth, options = {}) {
  return measure(text, height, options) <= maxWidth * SAFETY_MARGIN;
}

/**
 * Largest character height at or below `preferred` that fits `maxWidth`.
 *
 * Height is never raised above `preferred`: the template's declared size is a
 * house style, not a target to maximise. When even `minHeight` overflows, the
 * caller receives `overflow: true` and is expected to truncate.
 *
 * @param {string} text
 * @param {number} preferred
 * @param {number} minHeight
 * @param {number} maxWidth
 * @param {{ bold?: boolean }} [options]
 * @returns {{ height: number, width: number, shrunk: boolean, overflow: boolean }}
 */
export function fitHeight(text, preferred, minHeight, maxWidth, options = {}) {
  if (minHeight > preferred) {
    throw new RangeError(`minHeight ${minHeight} exceeds preferred height ${preferred}`);
  }
  for (let height = preferred; height >= minHeight; height -= 1) {
    if (fitsWithin(text, height, maxWidth, options)) {
      return {
        height,
        width: measure(text, height, options),
        shrunk: height < preferred,
        overflow: false,
      };
    }
  }
  return {
    height: minHeight,
    width: measure(text, minHeight, options),
    shrunk: minHeight < preferred,
    overflow: true,
  };
}

/**
 * Truncate a string with a trailing ellipsis so it fits `maxWidth`.
 * @param {string} text
 * @param {number} height
 * @param {number} maxWidth
 * @param {{ bold?: boolean }} [options]
 * @returns {string}
 */
export function truncateToWidth(text, height, maxWidth, options = {}) {
  if (fitsWithin(text, height, maxWidth, options)) return text;
  const chars = [...text];
  for (let end = chars.length - 1; end > 0; end -= 1) {
    const candidate = `${chars.slice(0, end).join('').trimEnd()}...`;
    if (fitsWithin(candidate, height, maxWidth, options)) return candidate;
  }
  return '...';
}

/**
 * Vertically centre a character cell of `height` inside a box.
 * Recomputed by callers whenever the font shrinks.
 * @param {number} boxTop
 * @param {number} boxHeight
 * @param {number} height
 * @returns {number} Baseline-independent top y for `^FO`.
 */
export function centreY(boxTop, boxHeight, height) {
  return boxTop + Math.max(0, Math.round((boxHeight - height) / 2));
}
