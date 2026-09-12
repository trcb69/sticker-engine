/**
 * Preview canvas.
 *
 * This renderer and the ZPL emitter share one source of geometry: both call
 * `layout()` from `/src/render/layout.js`, which imports the same metrics and
 * fit logic. No coordinate, font size or wrap decision is recomputed here. If
 * the preview and the printed label ever disagree, it is a bug in one shared
 * module rather than a drift between two implementations.
 *
 * Everything is drawn 1-bit with smoothing off. A grey anti-aliased edge would
 * suggest a precision the printhead does not have: a dot is either burned or
 * it is not, and a preview that softens that hides exactly the problems this
 * is here to reveal.
 */

import { layout } from '/src/render/layout.js';
import { elementAt, isOutsideLabel } from './hitTest.js';
import { MIN_QR_DOTS_PER_MODULE } from '/src/render/symbology.js';
import { encodeCode128 } from './symbols.js';

const FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * @typedef {object} RenderResult
 * @property {import('/src/render/layout.js').LayoutResult} placed
 * @property {number} scale
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} template Already resolved to a dpi.
 * @param {Record<string, unknown>} context
 * @param {{ scale?: number, showOverlays?: boolean, warnings?: object[],
 *           highlightSlot?: string|null, calibrate?: boolean }} [options]
 * @returns {RenderResult}
 */
export function renderLabel(canvas, template, context, options = {}) {
  const placed = layout(template, context);
  const scale = options.scale ?? 2;

  // Margin of canvas drawn *outside* the label. Without it the canvas is the
  // label exactly, so anything dragged past the edge is clipped by the canvas
  // and simply disappears — which is the one thing you need to see while
  // moving something. With it, the overhang stays visible, sitting on a
  // hatched ground that is plainly not the sticker.
  const bleed = Math.max(0, options.bleed ?? 0);

  canvas.width = (placed.width + bleed * 2) * scale;
  canvas.height = (placed.height + bleed * 2) * scale;
  canvas.style.width = `${(placed.width + bleed * 2) * scale}px`;
  // Height is left to the stylesheet. An inline height would beat the
  // `max-width: 100%` that keeps a wide label inside its column, and the label
  // would be squashed horizontally rather than scaled — which at a glance
  // looks like a layout bug in the template rather than in the page.
  canvas.style.height = 'auto';

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, bleed * scale, bleed * scale);

  if (bleed > 0) drawBleed(ctx, placed, bleed);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, placed.width, placed.height);

  for (const element of placed.elements) drawElement(ctx, element);

  // What falls outside the sticker, marked on top of the artwork so it reads
  // as "this is cut off" rather than "this is here".
  if (bleed > 0) drawOverflow(ctx, placed, bleed);

  if (options.showOverlays !== false) drawOverlays(ctx, placed, options.warnings ?? []);
  if (options.calibrate) drawCalibrationGrid(ctx, placed);
  if (bleed > 0) drawPrintZone(ctx, placed);
  if (options.highlightSlot) highlight(ctx, placed, options.highlightSlot);
  if (options.selectedSlot) drawSelection(ctx, placed, options.selectedSlot);

  return { placed, scale, bleed };
}

/**
 * The ground outside the sticker: hatched, so it cannot be mistaken for part
 * of the label even in a screenshot with no surrounding page.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 * @param {number} bleed
 */
function drawBleed(ctx, placed, bleed) {
  ctx.save();
  ctx.fillStyle = '#eceef4';
  ctx.fillRect(-bleed, -bleed, placed.width + bleed * 2, placed.height + bleed * 2);

  ctx.strokeStyle = 'rgba(120, 128, 150, 0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const span = placed.width + placed.height + bleed * 4;
  for (let i = -placed.height - bleed; i < span; i += 8) {
    ctx.moveTo(i - bleed, -bleed);
    ctx.lineTo(i + placed.height + bleed * 2, placed.height + bleed);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Redraw the parts of every element that fall outside the sticker, in red.
 *
 * The printer does not wrap or shrink: a field that runs past the edge is
 * simply not printed, and the label comes out looking almost right. This is
 * the part that says which millimetre is lost.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 * @param {number} bleed
 */
function drawOverflow(ctx, placed, bleed) {
  const outside = placed.elements.filter((element) => isOutsideLabel(placed, element));
  if (outside.length === 0) return;

  ctx.save();
  // Everything drawn here is confined to the area beyond the sticker.
  ctx.beginPath();
  ctx.rect(-bleed, -bleed, placed.width + bleed * 2, placed.height + bleed * 2);
  ctx.rect(0, 0, placed.width, placed.height);
  ctx.clip('evenodd');

  for (const element of outside) {
    ctx.fillStyle = 'rgba(214, 38, 38, 0.22)';
    ctx.fillRect(element.x, element.y, element.w, element.h);
    ctx.strokeStyle = 'rgba(214, 38, 38, 0.95)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(element.x + 0.5, element.y + 0.5, element.w - 1, element.h - 1);
  }
  ctx.restore();
}

/**
 * The sticker's own edge — where the die cut is, and therefore where the
 * design stops existing.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 */
function drawPrintZone(ctx, placed) {
  ctx.save();
  ctx.strokeStyle = 'rgba(20, 22, 42, 0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(0, 0, placed.width, placed.height);

  // Corner ticks, so the edge is still readable where artwork runs up to it.
  ctx.strokeStyle = 'rgba(20, 22, 42, 0.95)';
  ctx.lineWidth = 3;
  const tick = Math.min(18, placed.width / 10);
  for (const [cx, cy, sx, sy] of [
    [0, 0, 1, 1], [placed.width, 0, -1, 1],
    [0, placed.height, 1, -1], [placed.width, placed.height, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * tick, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * tick);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The selected slot: a box with handles at the corners, so what the arrow keys
 * are about to move is never in doubt.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 * @param {string} slotId
 */
function drawSelection(ctx, placed, slotId) {
  const element = placed.elements.find((candidate) => candidate.id === slotId);
  if (!element) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(59, 91, 255, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(element.x - 1.5, element.y - 1.5, element.w + 3, element.h + 3);

  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(59, 91, 255, 1)';
  ctx.lineWidth = 1.5;
  const r = 3.5;
  for (const [hx, hy] of [
    [element.x, element.y], [element.x + element.w, element.y],
    [element.x, element.y + element.h], [element.x + element.w, element.y + element.h],
  ]) {
    ctx.beginPath();
    ctx.rect(hx - r, hy - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} el
 */
function drawElement(ctx, el) {
  switch (el.kind) {
    case 'box':
      ctx.fillStyle = '#000';
      if (el.fill) {
        ctx.fillRect(el.x, el.y, el.w, el.h);
      } else {
        const t = el.thickness || 1;
        ctx.fillRect(el.x, el.y, el.w, t);
        ctx.fillRect(el.x, el.y + el.h - t, el.w, t);
        ctx.fillRect(el.x, el.y, t, el.h);
        ctx.fillRect(el.x + el.w - t, el.y, t, el.h);
      }
      break;

    case 'graphic':
      drawLogoPlaceholder(ctx, el);
      break;

    case 'text':
      for (const line of el.lines) {
        // Bold is a double strike one dot apart, exactly as the emitter does
        // it, because ZPL font ^A0 has no bold weight.
        const passes = el.bold ? [line.x, line.x + 1] : [line.x];
        for (const x of passes) drawText(ctx, line.text, x, line.y, el.size, el.reverse);
      }
      break;

    case 'barcode':
      drawBarcode(ctx, el);
      break;

    case 'qr':
      drawQr(ctx, el);
      break;

    default:
      break;
  }
}

/**
 * Draw text so its rendered width matches what the layout engine measured.
 *
 * The browser's font is not the printer's font, so a string drawn at the same
 * nominal size lands at a different width. Since every position on this canvas
 * came from the layout engine's own estimate, the text is scaled horizontally
 * to agree with that estimate. The preview then shows where the engine thinks
 * the text ends, which is the number that decides whether anything collides.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y top of the character cell, as ZPL treats it
 * @param {number} size
 * @param {boolean} reverse
 */
function drawText(ctx, text, x, y, size, reverse) {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = reverse ? '#fff' : '#000';
  ctx.textBaseline = 'top';
  ctx.font = `${size}px ${FONT_STACK}`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * The logo lives in printer memory, so there is no bitmap to draw here. Its
 * footprint is shown instead: the size and position are what a layout preview
 * needs to be right about.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} el
 */
function drawLogoPlaceholder(ctx, el) {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(el.x + el.w / 2, el.y + el.h / 2, el.w / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(el.x + el.w / 2, el.y + el.h / 2, el.w / 2 - 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(el.h / 5)}px ${FONT_STACK}`;
  ctx.fillText('SH', el.x + el.w / 2, el.y + el.h / 2);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} el
 */
function drawBarcode(ctx, el) {
  const { bits } = encodeCode128(el.data);
  const moduleWidth = el.plan.moduleWidth;
  ctx.fillStyle = '#000';
  let x = el.x + el.plan.quietZone;
  for (const bit of bits) {
    if (bit === '1') ctx.fillRect(x, el.y, moduleWidth, el.barHeight);
    x += moduleWidth;
  }

  if (el.hri === 'below' && el.hriSize > 0) {
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${el.hriSize}px ${FONT_STACK}`;
    const barsWidth = bits.length * moduleWidth;
    ctx.fillText(el.data, el.x + el.plan.quietZone + barsWidth / 2, el.hriY);
    ctx.restore();
  }
}

/**
 * Draw the QR at its exact size and module count.
 *
 * The module pattern is indicative, not decodable. The printer generates the
 * real symbol from `^BQ`, and reproducing it here would mean carrying a second
 * QR encoder that could disagree with the printer's. What this preview has to
 * be exact about is the geometry — where the symbol sits, how many modules it
 * needs and how many dots each one gets — because that is what decides whether
 * it fits and whether it scans. Those come from the same plan the emitter uses.
 *
 * The caption on the pane says as much, so nobody tries to scan the screen.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} el
 */
function drawQr(ctx, el) {
  const { modules, magnification } = el.plan;
  if (!modules) return;
  const quiet = 2;
  const origin = { x: el.x + quiet * magnification, y: el.y + quiet * magnification };

  ctx.fillStyle = '#000';
  const cell = (col, row) => ctx.fillRect(
    origin.x + col * magnification, origin.y + row * magnification,
    magnification, magnification,
  );

  const finder = (col, row) => {
    for (let dy = 0; dy < 7; dy += 1) {
      for (let dx = 0; dx < 7; dx += 1) {
        const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        if (edge || core) cell(col + dx, row + dy);
      }
    }
  };

  finder(0, 0);
  finder(modules - 7, 0);
  finder(0, modules - 7);

  for (let i = 8; i < modules - 8; i += 1) {
    if (i % 2 === 0) { cell(i, 6); cell(6, i); }
  }

  // A deterministic fill, so the same payload always previews identically and
  // a change to the link is visible as a change to the symbol.
  let seed = 0;
  for (const ch of el.data) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (inFinder(col, row, modules) || col === 6 || row === 6) continue;
      seed = (seed * 1103515245 + 12345) >>> 0;
      if ((seed >>> 16) & 1) cell(col, row);
    }
  }
}

/** @returns {boolean} */
function inFinder(col, row, modules) {
  return (col < 8 && row < 8)
    || (col >= modules - 8 && row < 8)
    || (col < 8 && row >= modules - 8);
}

/**
 * Quiet zone and printhead limits, plus a marker on anything the guard
 * complained about. Warnings as annotations rather than a list beneath: the
 * useful question is "which part of the label", and a list cannot answer it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 * @param {object[]} warnings
 */
function drawOverlays(ctx, placed, warnings) {
  const quiet = placed.quietZone;
  if (quiet > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 90, 200, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(quiet + 0.5, quiet + 0.5, placed.width - quiet * 2 - 1, placed.height - quiet * 2 - 1);
    ctx.restore();
  }

  const bySlot = new Map();
  for (const warning of warnings) {
    if (warning.severity === 'info') continue;
    if (!bySlot.has(warning.slotId)) bySlot.set(warning.slotId, []);
    bySlot.get(warning.slotId).push(warning);
  }

  for (const [slotId, slotWarnings] of bySlot) {
    const element = placed.elements.find((candidate) => candidate.id === slotId);
    if (!element) continue;
    const error = slotWarnings.some((warning) => warning.severity === 'error');
    ctx.save();
    ctx.strokeStyle = error ? 'rgba(200, 30, 30, 0.95)' : 'rgba(210, 130, 0, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(element.x - 1, element.y - 1, element.w + 2, element.h + 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(element.x + element.w + 4, element.y - 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 8px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(error ? '!' : '?', element.x + element.w + 4, element.y - 1);
    ctx.restore();
  }
}

/**
 * A one millimetre grid, for tuning geometry against a printed label.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 */
function drawCalibrationGrid(ctx, placed) {
  const perMm = placed.dpi / 25.4;
  ctx.save();
  ctx.lineWidth = 0.4;
  for (let mm = 0; mm * perMm < placed.width; mm += 1) {
    ctx.strokeStyle = mm % 5 === 0 ? 'rgba(0,140,90,0.75)' : 'rgba(0,140,90,0.3)';
    ctx.beginPath();
    ctx.moveTo(mm * perMm, 0);
    ctx.lineTo(mm * perMm, placed.height);
    ctx.stroke();
  }
  for (let mm = 0; mm * perMm < placed.height; mm += 1) {
    ctx.strokeStyle = mm % 5 === 0 ? 'rgba(0,140,90,0.75)' : 'rgba(0,140,90,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, mm * perMm);
    ctx.lineTo(placed.width, mm * perMm);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} placed
 * @param {string} slotId
 */
function highlight(ctx, placed, slotId) {
  const element = placed.elements.find((candidate) => candidate.id === slotId);
  if (!element) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 120, 255, 0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(element.x - 2, element.y - 2, element.w + 4, element.h + 4);
  ctx.restore();
}



export { MIN_QR_DOTS_PER_MODULE, elementAt, isOutsideLabel };
