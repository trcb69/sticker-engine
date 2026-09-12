/**
 * ZPL II emitter.
 *
 * Serialises placed geometry. It makes no layout decisions of its own — every
 * coordinate here came from `layout.js`, which is what keeps the printed label
 * and the browser preview identical.
 *
 * Barcodes and QR codes are emitted as native ZPL (`^BC`, `^BQ`), never as
 * bitmaps. A rasterised barcode at 203 dpi rounds narrow bars to inconsistent
 * dot widths and scans intermittently — the worst failure mode available,
 * because it passes a bench test and fails in the warehouse.
 */

import { layout as defaultLayout } from './layout.js';

/** Escape character used with `^FH`. */
const ESCAPE = '_';

/** Characters that must be hex-escaped inside `^FD`. */
const MUST_ESCAPE = new Set(['^', '~', '\\', ESCAPE]);

/**
 * Hex-escape field data for `^FH`.
 *
 * `^` and `~` start ZPL commands, so an item name containing either would
 * otherwise terminate the field and inject a command. The escape character
 * itself must also be escaped, or it would swallow the character after it.
 *
 * @param {string} data
 * @returns {string}
 */
export function escapeFieldData(data) {
  let out = '';
  for (const ch of data) {
    if (MUST_ESCAPE.has(ch)) {
      out += ESCAPE + ch.codePointAt(0).toString(16).toUpperCase().padStart(2, '0');
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * @param {string} data
 * @returns {string} a complete `^FH…^FD…^FS` field
 */
function fieldData(data) {
  return `^FH${ESCAPE}^FD${escapeFieldData(data)}^FS`;
}

/** @type {Readonly<Record<string, string>>} */
const MEDIA_TRACKING = Object.freeze({ gap: '^MNY', mark: '^MNM', continuous: '^MNN' });

/**
 * Emit ZPL for one label.
 *
 * @param {import('../template/schema.js').LabelTemplate} template Resolved to a dpi.
 * @param {Record<string, unknown>} context
 * @param {{ copies?: number, layout?: Function, logoObject?: string }} [options]
 * @returns {{ zpl: string, placed: import('./layout.js').LayoutResult }}
 */
export function emit(template, context, options = {}) {
  const build = options.layout ?? defaultLayout;
  const placed = build(template, context);
  const copies = Math.max(1, Math.trunc(options.copies ?? 1));
  const lines = [];

  lines.push('^XA');
  lines.push(`^PW${placed.width}`);
  lines.push(`^LL${placed.height}`);
  lines.push('^LH0,0');
  lines.push(MEDIA_TRACKING[placed.print.mediaTracking] ?? MEDIA_TRACKING.gap);
  lines.push(`^MD${placed.print.darkness}`);
  lines.push(`^PR${placed.print.rate}`);
  lines.push('^CI28');
  lines.push('');

  for (const el of placed.elements) {
    lines.push(...emitElement(el));
  }

  lines.push('');
  lines.push(`^PQ${copies}`);
  lines.push('^XZ');

  return { zpl: `${lines.join('\n')}\n`, placed };
}

/**
 * @param {import('./layout.js').PlacedElement} el
 * @returns {string[]}
 */
function emitElement(el) {
  switch (el.kind) {
    case 'box':
      // ^GB with a border equal to its height draws a solid block; a thinner
      // border draws an outline.
      return [`^FO${el.x},${el.y}^GB${el.w},${el.h},${el.fill ? el.h : el.thickness}^FS`];

    case 'graphic':
      return [`^FO${el.x},${el.y}^XG${el.source},1,1^FS`];

    case 'text': {
      const out = [];
      for (const line of el.lines) {
        // ^A0 has no bold weight. Emitting the field a second time one dot to
        // the right thickens every stroke, which at 203 dpi reads as bold.
        const passes = el.bold ? [line.x, line.x + 1] : [line.x];
        for (const x of passes) {
          const reverse = el.reverse ? '^FR' : '';
          out.push(`^FO${x},${line.y}${reverse}^A0N,${el.size},${el.size}${fieldData(line.text)}`);
        }
      }
      return out;
    }

    case 'barcode': {
      // ^BY narrow-module width, wide/narrow ratio, default height.
      // ^BC orientation, height, print-HRI, HRI-above, UCC-check.
      // The fourth parameter is N, which places the human-readable text below
      // the bars rather than above them.
      const hri = el.hri === 'below' ? 'Y' : 'N';
      return [
        `^BY${el.plan.moduleWidth},${el.ratio},${el.barHeight}`,
        `^FO${el.x},${el.y}^BCN,${el.barHeight},${hri},N,N${fieldData(el.data)}`,
      ];
    }

    case 'qr':
      // ^BQ orientation, model, magnification. The field data carries the
      // error-correction level and input mode as a two-character prefix.
      return [
        `^FO${el.x},${el.y}^BQN,${el.model},${el.plan.magnification}` +
        `${fieldData(`${el.plan.ecc}A,${el.data}`)}`,
      ];

    default:
      throw new TypeError(`Cannot emit unknown element kind "${el.kind}"`);
  }
}

/**
 * Emit the one-time commands that store the logo on the printer.
 * @param {string} objectName e.g. R:LOGO.GRF
 * @param {{ bytes: number, bytesPerRow: number, hex: string }} graphic
 * @returns {string}
 */
export function emitGraphicStore(objectName, graphic) {
  return `~DG${objectName},${graphic.bytes},${graphic.bytesPerRow},\n${graphic.hex}\n`;
}
