/**
 * Fitting the label preview to the screen without the browser resampling it.
 *
 * Pure arithmetic, kept apart from the canvas so it can be tested without a
 * browser: the failure it prevents — a 3-dot border painted 3 pixels thick on
 * one side and 4 on another — is invisible in a unit test of the drawing and
 * obvious only once the numbers are wrong.
 */

/** The most padToWholeCssPixels will add. fitScale leaves room for it. */
export const MAX_PAD = 16;

/**
 * How many device pixels to give each printer dot.
 *
 * A whole number whenever the space allows it, so every dot is a square of
 * identical pixels and a line one dot wide is always the same width on screen.
 * Only when the label cannot fit at one pixel per dot — a phone, or 600 dpi in
 * a narrow column — does it fall back to a fraction, and it says so.
 *
 * @param {number} dotsWide
 * @param {{ fitWidth?: number, pixelRatio?: number, maxCssPerDot?: number, scale?: number }} options
 * @returns {{ scale: number, pixelRatio: number, exact: boolean }}
 */
export function fitScale(dotsWide, options = {}) {
  const pixelRatio = options.pixelRatio > 0 ? options.pixelRatio : 1;
  const ceiling = (options.maxCssPerDot ?? options.scale ?? 2) * pixelRatio;
  const room = options.fitWidth > 0 ? (options.fitWidth * pixelRatio - MAX_PAD) / dotsWide : ceiling;
  const wanted = Math.min(room, ceiling);
  if (wanted >= 1) return { scale: Math.floor(wanted), pixelRatio, exact: true };
  return { scale: Math.max(wanted, 0.05), pixelRatio, exact: false };
}

/**
 * Add device pixels until the count divides into whole CSS pixels, if a few
 * will do it. A pixel ratio with no short period (4/3, say) is left alone.
 *
 * @param {number} pixels
 * @param {number} pixelRatio
 * @returns {number}
 */
export function padToWholeCssPixels(pixels, pixelRatio) {
  for (let pad = 0; pad <= MAX_PAD; pad += 1) {
    const css = (pixels + pad) / pixelRatio;
    if (Math.abs(css - Math.round(css)) < 1e-3) return pixels + pad;
  }
  return pixels;
}

/** @returns {number} */
export function cssPixels(pixels, pixelRatio) {
  const css = pixels / pixelRatio;
  return Math.abs(css - Math.round(css)) < 1e-3 ? Math.round(css) : css;
}
