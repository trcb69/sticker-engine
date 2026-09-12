/**
 * Calibration inspector, behind `?calibrate=1`.
 *
 * The geometry in the template was measured from a rendering, not from a
 * printed label. This turns tuning it into a ten minute job: drag a slot, watch
 * the coordinates, copy the corrected JSON out. Without it, adjusting a
 * template means editing numbers blind and reprinting.
 */

import { el, replace } from '../dom.js';
import { elementAt } from '../render-canvas.js';

/**
 * @param {HTMLElement} root
 * @param {HTMLCanvasElement} canvas
 * @param {{ placed: object, template: object, scale: number,
 *           onMove: (slotId: string, dx: number, dy: number) => void }} options
 */
export function attachCalibration(root, canvas, options) {
  let dragging = null;
  let selected = null;

  const readout = el('div.calibrate__readout', { text: 'Click a slot to inspect it.' });
  const offsets = el('div.calibrate__offsets');

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - rect.left) / options.scale),
      y: Math.round((event.clientY - rect.top) / options.scale),
    };
  };

  const describe = (element) => {
    if (!element) return 'Nothing here.';
    return `${element.id} · x ${element.x} y ${element.y} · ${element.w}×${element.h} dots `
      + `· ${(element.x / (options.placed.dpi / 25.4)).toFixed(1)} mm from the left`;
  };

  canvas.addEventListener('pointerdown', (event) => {
    const at = point(event);
    const element = elementAt(options.placed, at.x, at.y);
    selected = element;
    if (element) {
      dragging = { id: element.id, from: at, origin: { x: element.x, y: element.y } };
      canvas.setPointerCapture(event.pointerId);
    }
    readout.textContent = describe(element);
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
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  replace(root, [
    el('div.calibrate__title', { text: 'Calibration' }),
    el('p.hint', {
      text: 'A one millimetre grid is overlaid. Drag a slot to reposition it, then copy the '
        + 'corrected template out and paste it into src/template/label-4x1.json.',
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
}
