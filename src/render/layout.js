/**
 * Layout: turn a resolved template plus a context into placed elements.
 *
 * This is the single geometry authority. The ZPL emitter serialises what this
 * produces, the guard inspects what this produces, and the browser preview
 * canvas consumes the same output. Nothing downstream recomputes a position,
 * which is what keeps preview and print from drifting apart.
 *
 * Three passes:
 *   1. Measure every text and join slot. Needs no positions.
 *   2. Place every slot in declaration order. Flow and box references point
 *      backwards, so one forward pass suffices.
 *   3. Callers run the guard over the result.
 */

import { LayoutError } from '../errors.js';
import { dimensions } from '../template/schema.js';
import { textOf } from '../model/types.js';
import { resolveBind, resolveParts } from '../template/bind.js';
import { centreY, fitHeight, measure, truncateToWidth } from './metrics.js';
import { planCode128, planQr } from './symbology.js';

/**
 * @typedef {object} PlacedLine
 * @property {string} text
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {object} PlacedElement
 * @property {string} id
 * @property {'box'|'graphic'|'text'|'barcode'|'qr'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {object} LayoutResult
 * @property {number} dpi
 * @property {number} width Label width in dots.
 * @property {number} height Label height in dots.
 * @property {number} quietZone Quiet zone in dots.
 * @property {PlacedElement[]} elements In placement order. The preview draws in this order; the ZPL
 *   emitter defers a reversed caption's bar until after the caption.
 * @property {string[]} skipped Slot ids dropped because their value was absent.
 * @property {object} print Darkness, rate and media tracking.
 */

/**
 * @param {import('../template/schema.js').LabelTemplate} template Already resolved to a dpi.
 * @param {Record<string, unknown>} context
 * @returns {LayoutResult}
 */
export function layout(template, context) {
  const { width, height, quietZone } = dimensions(template);

  /* ---- pass 1: measure ------------------------------------------------- */
  /** @type {Map<string, {size: number, width: number, lines: string[], shrunk: boolean, truncated: boolean, overflowLines: boolean}>} */
  const measured = new Map();

  for (const slot of template.slots) {
    if (slot.type === 'text') {
      const { text, present } = resolveBind(slot.bind, context, { slotId: slot.id });
      if (!present) continue;
      const maxWidth = textBudget(slot, template, width);
      const fitted = fitHeight(text, slot.size, slot.minSize ?? slot.size, maxWidth, { bold: slot.bold });
      const shown = fitted.overflow
        ? truncateToWidth(text, fitted.height, maxWidth, { bold: slot.bold })
        : text;
      measured.set(slot.id, {
        size: fitted.height,
        width: measure(shown, fitted.height, { bold: slot.bold }),
        lines: [shown],
        shrunk: fitted.shrunk,
        truncated: fitted.overflow,
        overflowLines: false,
      });
    } else if (slot.type === 'join') {
      const parts = resolveParts(slot.parts, context, { slotId: slot.id });
      if (parts.length === 0) continue;
      measured.set(slot.id, packJoin(slot, parts));
    }
  }

  /* ---- pass 2: place --------------------------------------------------- */
  /** @type {Map<string, PlacedElement>} */
  const placedById = new Map();
  /** @type {PlacedElement[]} */
  const elements = [];
  /** @type {string[]} */
  const skipped = [];

  const rightEdgeOf = (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    let edge = 0;
    let found = false;
    for (const id of list) {
      const placed = placedById.get(id);
      if (!placed) continue;
      found = true;
      edge = Math.max(edge, placed.x + placed.w);
    }
    if (!found) {
      // Every anchor was dropped. Fall back to the left content edge so the
      // label still prints something usable rather than failing outright.
      return null;
    }
    return edge;
  };

  const flowX = (slot) => {
    const edge = rightEdgeOf(slot.flow.after);
    if (edge === null) return slot.x ?? 0;
    return edge + (slot.flow.gap ?? 0);
  };

  for (const slot of template.slots) {
    switch (slot.type) {
      case 'box': {
        const box = placeBox(slot, measured, placedById, flowX);
        if (!box) { skipped.push(slot.id); break; }
        elements.push(box);
        placedById.set(slot.id, box);
        break;
      }
      case 'graphic': {
        const el = {
          id: slot.id, kind: 'graphic',
          x: slot.x, y: slot.y, w: slot.w, h: slot.h,
          source: slot.source,
          data: slot.data ?? null,
        };
        elements.push(el);
        placedById.set(slot.id, el);
        break;
      }
      case 'text':
      case 'join': {
        const m = measured.get(slot.id);
        if (!m) { skipped.push(slot.id); break; }
        const box = slot.box ? placedById.get(slot.box) : null;
        if (slot.box && !box) { skipped.push(slot.id); break; }
        const padX = slot.padX ?? 0;
        const x = box ? box.x + padX : (slot.flow ? flowX(slot) : slot.x);
        const lineGap = slot.lineGap ?? Math.round(m.size * 1.18);
        const blockHeight = m.size + (m.lines.length - 1) * lineGap;
        const top = slot.vAlign === 'center' && box
          ? centreY(box.y, box.h, blockHeight)
          : slot.y;
        const el = {
          id: slot.id,
          kind: 'text',
          x, y: top, w: m.width, h: blockHeight,
          size: m.size,
          bold: Boolean(slot.bold),
          reverse: Boolean(slot.reverse),
          box: slot.box ?? null,
          lines: m.lines.map((text, i) => ({ text, x, y: top + i * lineGap })),
          shrunk: m.shrunk,
          truncated: m.truncated,
          overflowLines: m.overflowLines,
          declaredSize: slot.size,
          minSize: slot.minSize ?? slot.size,
        };
        elements.push(el);
        placedById.set(slot.id, el);
        break;
      }
      case 'barcode': {
        const { text, present } = resolveBind(slot.bind, context, { slotId: slot.id });
        if (!present) { skipped.push(slot.id); break; }
        const x = slot.flow ? flowX(slot) : slot.x;
        const available = slot.expand === 'width'
          ? width - (slot.rightMargin ?? 0) - x
          : slot.w;
        if (available <= 0) {
          throw new LayoutError(
            'The barcode has no room left on the label. Shorten the date or quantity text.',
            { detail: `slot=${slot.id} x=${x} labelWidth=${width}` },
          );
        }
        const plan = planCode128(text, available);
        const el = {
          id: slot.id, kind: 'barcode',
          x, y: slot.y, w: available,
          h: slot.barHeight + (slot.hri === 'below' ? (slot.hriGap ?? 0) + (slot.hriSize ?? 0) : 0),
          data: text,
          symbology: slot.symbology ?? 'code128',
          barHeight: slot.barHeight,
          ratio: slot.ratio ?? 3,
          hri: slot.hri ?? 'none',
          hriSize: slot.hriSize ?? 0,
          hriY: slot.y + slot.barHeight + (slot.hriGap ?? 0),
          plan,
        };
        elements.push(el);
        placedById.set(slot.id, el);
        break;
      }
      case 'qr': {
        const { text, present } = resolveBind(slot.bind, context, { slotId: slot.id });
        if (!present) { skipped.push(slot.id); break; }
        // The error-correction level may be decided upstream: the short-link
        // service picks the strongest that still clears the dot floor for the
        // payload it minted, and tells the operator which. If the template
        // then printed a different level, the symbol on the drum would not be
        // the one the operator was shown.
        const chosen = slot.eccFrom ? textOf(context[slot.eccFrom]) : '';
        const plan = planQr(text, slot.budget, { ecc: chosen || slot.ecc || 'M' });
        const size = plan.fits || plan.size > 0 ? plan.size : slot.budget;
        const x = slot.anchor === 'right'
          ? width - (slot.rightMargin ?? 0) - size
          : slot.x;
        const el = {
          id: slot.id, kind: 'qr',
          x, y: slot.y, w: size, h: size,
          data: text,
          model: slot.model ?? 2,
          budget: slot.budget,
          plan,
        };
        elements.push(el);
        placedById.set(slot.id, el);
        break;
      }
      default:
        throw new LayoutError(`Unsupported slot type "${slot.type}".`, { detail: `slot=${slot.id}` });
    }
  }

  return {
    dpi: template.dpi,
    width, height, quietZone,
    elements, skipped,
    print: template.print ?? { darkness: 10, rate: 4, mediaTracking: 'gap' },
  };
}

/**
 * Horizontal room a text slot has to work with.
 * @param {object} slot
 * @param {object} template
 * @param {number} labelWidth
 * @returns {number}
 */
function textBudget(slot, template, labelWidth) {
  if (slot.w) return slot.w;
  if (slot.box) {
    const box = template.slots.find((s) => s.id === slot.box);
    if (box?.w) return box.w - 2 * (slot.padX ?? 0);
  }
  // A slot sized by its own caption is unconstrained: the bar grows to suit.
  return labelWidth;
}

/**
 * Pack join parts into at most `maxLines` lines, stepping the font down only
 * if they will not pack. Empty parts were already dropped upstream, so a
 * separator can never be left stranded.
 * @param {object} slot
 * @param {string[]} parts
 */
function packJoin(slot, parts) {
  const separator = slot.separator ?? ' | ';
  const maxLines = slot.maxLines ?? 1;
  const minSize = slot.minSize ?? slot.size;

  for (let size = slot.size; size >= minSize; size -= 1) {
    const lines = greedyPack(parts, separator, size, slot.w, Boolean(slot.bold));
    if (lines.length <= maxLines) {
      return {
        size,
        width: Math.max(...lines.map((l) => measure(l, size, { bold: slot.bold }))),
        lines,
        shrunk: size < slot.size,
        truncated: false,
        overflowLines: false,
      };
    }
  }

  // Will not pack even at the floor. Keep the first `maxLines` lines and let
  // the guard raise it, rather than silently dropping the category.
  const lines = greedyPack(parts, separator, minSize, slot.w, Boolean(slot.bold));
  return {
    size: minSize,
    width: Math.max(...lines.slice(0, maxLines).map((l) => measure(l, minSize, { bold: slot.bold }))),
    lines: lines.slice(0, maxLines),
    shrunk: minSize < slot.size,
    truncated: true,
    overflowLines: true,
  };
}

/**
 * @param {string[]} parts
 * @param {string} separator
 * @param {number} size
 * @param {number} maxWidth
 * @param {boolean} bold
 * @returns {string[]}
 */
function greedyPack(parts, separator, size, maxWidth, bold) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  let current = [];
  for (const part of parts) {
    const candidate = [...current, part].join(separator);
    if (current.length > 0 && measure(candidate, size, { bold }) > maxWidth) {
      lines.push(current.join(separator));
      current = [part];
    } else {
      current.push(part);
    }
  }
  if (current.length > 0) lines.push(current.join(separator));
  return lines;
}

/**
 * @param {object} slot
 * @param {Map<string, any>} measured
 * @param {Map<string, PlacedElement>} placedById
 * @param {(slot: object) => number} flowX
 * @returns {PlacedElement|null}
 */
function placeBox(slot, measured, placedById, flowX) {
  let w = slot.w;
  if (slot.sizeTo) {
    const m = measured.get(slot.sizeTo.slot);
    // A bar that sizes to absent text has nothing to wrap. Drop it rather
    // than printing an empty black rectangle.
    if (!m) return null;
    w = m.width + 2 * slot.sizeTo.padX;
  }
  if (!w) return null;
  const x = slot.flow ? flowX(slot) : slot.x;
  return {
    id: slot.id, kind: 'box',
    x, y: slot.y, w, h: slot.h,
    fill: Boolean(slot.fill),
    thickness: slot.thickness ?? 0,
    edge: Boolean(slot.edge),
  };
}
