/**
 * Calibration inspector, behind `?calibrate=1`.
 *
 * The geometry in the template was measured from a rendering, not from a
 * printed label. This turns tuning it into a ten minute job: pick a slot, nudge
 * it, watch the coordinates, copy the corrected JSON out. Without it, adjusting
 * a template means editing numbers blind and reprinting.
 *
 * Dragging is for getting roughly there; the arrow keys are for the last few
 * dots, which is where this work actually happens. A mouse cannot reliably
 * place something one dot to the left, and at 203 dpi one dot is 0.125 mm —
 * the difference between a barcode with quiet zone and one without.
 *
 *   ←→↑↓             move 1 dot
 *   Shift + ←→↑↓     move 10 dots
 *   Alt + ←→↑↓       resize by 1 dot
 *   Shift + Alt      resize by 10 dots
 *   Escape           deselect
 *
 * Not every slot carries a width and height of its own — a QR sizes itself
 * from its budget, and text from its own metrics — so resize is offered only
 * where the template actually has something to change.
 */

import { el, replace } from '../dom.js';
import { elementAt } from '../hitTest.js';
import { resolveMoveTarget, resizableAxes } from '../slotGeometry.js';

/**
 * @param {HTMLElement} root
 * @param {HTMLCanvasElement} canvas
 * @param {{ placed: object, template: object, scale: number, bleed?: number,
 *           selected?: string|null,
 *           onMove: (slotId: string, dx: number, dy: number) => void,
 *           onResize?: (slotId: string, dw: number, dh: number) => void,
 *           onSelect?: (slotId: string|null) => void }} options
 */
export function attachCalibration(root, canvas, options) {
  const bleed = options.bleed ?? 0;
  let dragging = null;
  let selected = options.selected ?? null;

  const readout = el('div.calibrate__readout', { text: 'Click a slot to select it, then use the arrow keys.' });
  const offsets = el('div.calibrate__offsets');

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    // Measured from the displayed size rather than assumed from the render
    // scale: CSS shrinks the canvas to fit its column, so the two differ as
    // soon as the label is wider than the panel. Assuming them equal put every
    // click in the wrong place, and only where the page was narrow.
    const perDotX = rect.width / (canvas.width / options.scale);
    const perDotY = rect.height / (canvas.height / options.scale);
    // The canvas is drawn with a margin outside the label, so client
    // coordinates are offset by it before they mean anything in label space.
    return {
      x: Math.round((event.clientX - rect.left) / perDotX) - bleed,
      y: Math.round((event.clientY - rect.top) / perDotY) - bleed,
    };
  };

  const elementFor = (slotId) => options.placed.elements.find((c) => c.id === slotId) ?? null;

  const mm = (dots) => (dots / (options.placed.dpi / 25.4)).toFixed(2);

  const describe = (element) => {
    if (!element) return 'Nothing here. Click a slot to select it.';
    const clipped = element.x < 0 || element.y < 0
      || element.x + element.w > options.placed.width
      || element.y + element.h > options.placed.height;
    // Read from the template rather than guessed from the slot type: what can
    // be resized is whatever states a width or height, and what moves may be
    // a different slot entirely.
    const target = resolveMoveTarget(options.template, element.id);
    const axes = resizableAxes(options.template, element.id);
    const resizable = axes.width && axes.height ? ' · Alt+arrows to resize'
      : axes.width ? ' · Alt+←→ resizes its width'
        : axes.height ? ' · Alt+↑↓ resizes its height'
          : ' · sizes itself';
    return `${element.id} · x ${element.x} y ${element.y} · ${element.w}×${element.h} dots `
      + `· ${mm(element.x)} mm from the left, ${mm(element.y)} mm from the top`
      + (target?.via ? ` · anchored to ${target.id}, which is what moves` : '')
      + resizable
      + (clipped ? ' · OUTSIDE THE STICKER — this part will not print' : '');
  };

  const select = (slotId) => {
    selected = slotId;
    readout.textContent = describe(elementFor(slotId));
    readout.classList.toggle('is-clipped', isClipped(options.placed, slotId));
    options.onSelect?.(slotId);
  };

  canvas.addEventListener('pointerdown', (event) => {
    const at = point(event);
    const element = elementAt(options.placed, at.x, at.y);
    if (element) {
      dragging = { id: element.id, from: at, origin: { x: element.x, y: element.y } };
      canvas.setPointerCapture(event.pointerId);
    }
    select(element ? element.id : null);
    canvas.focus();
  });

  canvas.addEventListener('pointermove', (event) => {
    const at = point(event);
    if (!dragging) {
      const element = elementAt(options.placed, at.x, at.y);
      canvas.style.cursor = element ? 'grab' : 'crosshair';
      return;
    }
    const dx = at.x - dragging.from.x;
    const dy = at.y - dragging.from.y;
    readout.textContent = `${dragging.id} · x ${dragging.origin.x + dx} y ${dragging.origin.y + dy} `
      + `· moved ${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy} dots`;
    options.onMove(dragging.id, dx, dy);
  });

  const end = (event) => {
    if (!dragging) return;
    canvas.releasePointerCapture?.(event.pointerId);
    dragging = null;
    select(selected);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // The canvas has to be focusable for it to receive keys at all, and a visible
  // focus ring is worth having: it says which of the two panels the arrow keys
  // are going to act on.
  canvas.tabIndex = 0;

  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      select(null);
      event.preventDefault();
      return;
    }

    const step = STEPS[event.key];
    if (!step) return;
    if (!selected) {
      readout.textContent = 'Click a slot first, then the arrow keys will move it.';
      return;
    }
    // Arrow keys scroll the page otherwise, which loses the label mid-nudge.
    event.preventDefault();

    const amount = event.shiftKey ? 10 : 1;
    const [dx, dy] = [step[0] * amount, step[1] * amount];

    if (event.altKey) {
      const resized = options.onResize?.(selected, dx, dy);
      if (!resized) {
        const axis = dx !== 0 ? 'width' : 'height';
        readout.textContent = `${selected} takes its ${axis} from its content `
          + '— the template states no size to change on that axis.';
        return;
      }
      select(selected);
      if (resized.via) {
        readout.textContent += ` · resized ${resized.id}`;
      }
      return;
    }

    const moved = options.onMove(selected, dx, dy);
    if (!moved) {
      readout.textContent = `${selected} is not in the template, so it cannot be moved.`;
      return;
    }
    select(selected);
  });

  replace(root, [
    el('div.calibrate__title', { text: 'Calibration' }),
    el('p.hint', {
      text: 'Click a slot, then move it with the arrow keys — Shift for 10 dots at a time, '
        + 'Alt to resize. The dark rectangle is the sticker edge; anything on the hatched '
        + 'ground beyond it is cut off and will not print.',
    }),
    readout,
    offsets,
    el('button.btn.btn--ghost', {
      type: 'button',
      text: 'Copy corrected template',
      onclick: async () => {
        const json = JSON.stringify(options.template, null, 2);
        try {
          await navigator.clipboard.writeText(json);
          readout.textContent = 'Template copied to the clipboard.';
        } catch {
          // Clipboard access needs a secure context, which a plain LAN address
          // is not. Falling back to a selectable block keeps this usable there.
          const area = el('textarea.calibrate__json', { readonly: true }, [json]);
          replace(offsets, [area]);
          area.select();
        }
      },
    }),
  ]);
  root.hidden = false;

  if (selected) select(selected);
}

/** @type {Record<string, [number, number]>} */
const STEPS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * @param {object} placed
 * @param {string|null} slotId
 * @returns {boolean}
 */
function isClipped(placed, slotId) {
  const element = placed.elements.find((candidate) => candidate.id === slotId);
  if (!element) return false;
  return element.x < 0 || element.y < 0
    || element.x + element.w > placed.width
    || element.y + element.h > placed.height;
}
