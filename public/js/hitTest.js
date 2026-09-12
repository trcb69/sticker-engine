/**
 * Which slot is under a point.
 *
 * Its own module because it is pure geometry with nothing browser-specific in
 * it — render-canvas.js imports the shared layout module by an absolute URL
 * that only resolves when served, so anything living there cannot be tested
 * outside a browser. This can.
 */

/**
 * The smallest element containing the point, not the topmost.
 *
 * The label has a full-size border frame drawn over everything, so "topmost"
 * answers "the border" for every click on the label — which is never what
 * someone clicking on the product name meant. Ties break towards the topmost,
 * which is what is actually visible at that spot.
 *
 * @param {{ elements: Array<{id: string, x: number, y: number, w: number, h: number}> }} placed
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
export function elementAt(placed, x, y) {
  let best = null;
  let bestArea = Infinity;
  for (let i = placed.elements.length - 1; i >= 0; i -= 1) {
    const el = placed.elements[i];
    if (x < el.x || x > el.x + el.w || y < el.y || y > el.y + el.h) continue;
    const area = Math.max(1, el.w) * Math.max(1, el.h);
    if (area < bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Whether a slot has been pushed off the sticker, in whole or in part.
 *
 * The printer does not wrap or shrink: a field past the edge is simply not
 * printed, and the label comes out looking almost right.
 *
 * @param {{width: number, height: number}} placed
 * @param {{x: number, y: number, w: number, h: number}} element
 * @returns {boolean}
 */
export function isOutsideLabel(placed, element) {
  return element.x < 0 || element.y < 0
    || element.x + element.w > placed.width
    || element.y + element.h > placed.height;
}
