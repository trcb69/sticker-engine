/**
 * Label template schema: validation and resolution to a target resolution.
 *
 * Geometry is authored once, in dots at 203 dpi. `resolve` scales it to any
 * other printhead density, which is why 300 and 600 dpi need no separate
 * template and no code changes.
 */

import { TemplateValidationError } from '../errors.js';

/** The density all templates are authored at. */
export const DESIGN_DPI = 203;

/** @type {readonly string[]} */
export const SLOT_TYPES = Object.freeze(['box', 'graphic', 'text', 'join', 'barcode', 'qr']);

/** Slot properties that are lengths in dots and must scale with resolution. */
const SCALABLE = Object.freeze([
  'x', 'y', 'w', 'h', 'size', 'minSize', 'thickness', 'padX', 'padY',
  'gap', 'barHeight', 'hriSize', 'hriGap', 'budget', 'rightMargin', 'lineGap',
]);

/**
 * @typedef {object} FlowSpec
 * @property {string|string[]} after Slot id(s); the element starts past the rightmost.
 * @property {number} [gap] Dots of clearance. Defaults to 10.
 */

/**
 * @typedef {object} Slot
 * @property {string} id
 * @property {'box'|'graphic'|'text'|'join'|'barcode'|'qr'} type
 * @property {number} [x] Omitted when `flow` supplies it.
 * @property {number} [y]
 * @property {number} [w]
 * @property {number} [h]
 * @property {FlowSpec} [flow]
 * @property {boolean} [fill]          box: solid rather than outline
 * @property {number} [thickness]      box: stroke width when not filled
 * @property {boolean} [edge]          sits at the label edge on purpose; exempt
 *                                     from the quiet-zone check
 * @property {{slot: string, padX: number}} [sizeTo] box: width follows a text slot
 * @property {string} [source]         graphic: printer object, e.g. R:LOGO.GRF
 * @property {string} [bind]           text/barcode/qr: token string
 * @property {string[]} [parts]        join: token strings
 * @property {string} [separator]      join
 * @property {number} [maxLines]       join: default 1
 * @property {number} [size]           text: preferred character height
 * @property {number} [minSize]        text: shrink floor
 * @property {boolean} [bold]          text: emit twice, offset 1 dot
 * @property {boolean} [reverse]       text: white on a filled box
 * @property {string} [box]            text: id of the box it sits inside
 * @property {'center'|'top'} [vAlign] text
 * @property {number} [padX]           text: inset from its box
 * @property {'code128'} [symbology]   barcode
 * @property {number} [barHeight]      barcode
 * @property {number} [ratio]          barcode: wide/narrow ratio for ^BY
 * @property {'below'|'none'} [hri]    barcode
 * @property {number} [hriSize]        barcode
 * @property {number} [hriGap]         barcode
 * @property {'width'} [expand]        barcode: consume remaining width
 * @property {number} [rightMargin]    barcode/qr: clearance from the right edge
 * @property {'L'|'M'|'Q'|'H'} [ecc]   qr: fallback level
 * @property {string} [eccFrom]        qr: context key holding the chosen level
 * @property {number} [model]          qr
 * @property {number} [budget]         qr: square dot allowance
 * @property {'right'} [anchor]        qr: pin to the right edge
 */

/**
 * @typedef {object} LabelTemplate
 * @property {string} id
 * @property {number} designDpi
 * @property {number} dpi Resolution this instance is resolved to.
 * @property {number} widthIn
 * @property {number} heightIn
 * @property {number} quietZoneMm
 * @property {{darkness: number, rate: number, mediaTracking: 'gap'|'mark'|'continuous'}} print
 * @property {Slot[]} slots
 */

const REQUIRED_BY_TYPE = Object.freeze({
  box: ['y', 'h'],
  graphic: ['x', 'y', 'w', 'h', 'source'],
  text: ['y', 'bind', 'size'],
  join: ['x', 'y', 'w', 'parts', 'size'],
  barcode: ['y', 'bind', 'barHeight'],
  qr: ['y', 'bind'],
});

/**
 * Validate a template. Throws on the first structural problem rather than
 * collecting them, because a malformed template is a build-time bug and the
 * first cause is the useful one.
 * @param {unknown} candidate
 * @returns {LabelTemplate}
 */
export function validateTemplate(candidate) {
  const fail = (message, detail) => {
    throw new TemplateValidationError(`Label template is invalid: ${message}`, { detail });
  };
  if (typeof candidate !== 'object' || candidate === null) fail('not an object');
  const t = /** @type {LabelTemplate} */ (candidate);

  for (const key of ['id', 'widthIn', 'heightIn', 'slots']) {
    if (!(key in t)) fail(`missing "${key}"`);
  }
  if (!Number.isFinite(t.widthIn) || t.widthIn <= 0) fail('widthIn must be positive');
  if (!Number.isFinite(t.heightIn) || t.heightIn <= 0) fail('heightIn must be positive');
  if (!Array.isArray(t.slots) || t.slots.length === 0) fail('slots must be a non-empty array');

  const seen = new Set();
  t.slots.forEach((slot, position) => {
    if (!slot || typeof slot !== 'object') fail(`slot ${position} is not an object`);
    if (typeof slot.id !== 'string' || slot.id === '') fail(`slot ${position} has no id`);
    if (seen.has(slot.id)) fail(`duplicate slot id "${slot.id}"`);
    seen.add(slot.id);
    if (!SLOT_TYPES.includes(slot.type)) {
      fail(`slot "${slot.id}" has unknown type "${slot.type}"`,
        `known types: ${SLOT_TYPES.join(', ')}`);
    }
    for (const key of REQUIRED_BY_TYPE[slot.type]) {
      if (slot[key] === undefined) fail(`slot "${slot.id}" (${slot.type}) is missing "${key}"`);
    }
    if (slot.x === undefined && !slot.flow && !slot.box && slot.anchor !== 'right') {
      fail(`slot "${slot.id}" needs an x, a flow, a box, or anchor:"right"`,
        'a slot must derive its horizontal position from exactly one source');
    }
    if (slot.type === 'text' && slot.minSize !== undefined && slot.minSize > slot.size) {
      fail(`slot "${slot.id}" has minSize greater than size`);
    }
    if (slot.type === 'join' && (!Array.isArray(slot.parts) || slot.parts.length === 0)) {
      fail(`slot "${slot.id}" needs a non-empty parts array`);
    }
  });

  // Two kinds of reference, with two different rules.
  //
  // Placement references (`flow`, `box`) must point backwards, so slots can be
  // positioned in one forward pass without building a dependency graph.
  //
  // Measurement references (`sizeTo`) may point forwards. A filled bar whose
  // width follows its own caption is inherently circular in declaration order:
  // the bar must be *placed* first because the caption is positioned from it,
  // but its width comes from text declared afterwards. The layout resolves
  // this by measuring every text slot before placing anything, so a forward
  // `sizeTo` is legal — it only ever needs a width, never a position.
  const placed = new Set();
  for (const slot of t.slots) {
    for (const ref of placementRefs(slot)) {
      if (!seen.has(ref)) fail(`slot "${slot.id}" references unknown slot "${ref}"`);
      if (!placed.has(ref)) {
        fail(`slot "${slot.id}" is positioned from "${ref}", which is declared after it`,
          'flow and box references must point to an earlier slot');
      }
    }
    if (slot.sizeTo && !seen.has(slot.sizeTo.slot)) {
      fail(`slot "${slot.id}" sizes to unknown slot "${slot.sizeTo.slot}"`);
    }
    placed.add(slot.id);
  }

  // A reversed caption is struck black and its bar is emitted after it with
  // ^FR, which inverts the caption to white. That needs a filled bar, and one
  // caption per bar: a second ^FR over the same bar would invert the first back.
  const backdrops = new Set();
  for (const slot of t.slots) {
    if (!slot.reverse) continue;
    if (!slot.box) fail(`slot "${slot.id}" is reversed but has no box`);
    const box = t.slots.find((candidate) => candidate.id === slot.box);
    if (box?.type !== 'box' || !box.fill) {
      fail(`slot "${slot.id}" is reversed but its box "${slot.box}" is not a filled box`);
    }
    if (backdrops.has(slot.box)) {
      fail(`box "${slot.box}" is the backdrop of more than one reversed slot`);
    }
    backdrops.add(slot.box);
  }
  return t;
}

/**
 * Slots this one derives its *position* from.
 * @param {Slot} slot
 * @returns {string[]}
 */
function placementRefs(slot) {
  const refs = [];
  if (slot.flow) {
    refs.push(...(Array.isArray(slot.flow.after) ? slot.flow.after : [slot.flow.after]));
  }
  if (slot.box) refs.push(slot.box);
  return refs;
}

/**
 * Scale a template from its design density to a target printhead density.
 *
 * Every length scales by the same factor and rounds to a whole dot, so a
 * template authored at 203 dpi prints identically at 300 or 600. `sizeTo` and
 * `flow` are measurement-driven and resolve later, in the layout pass.
 *
 * @param {LabelTemplate} template
 * @param {number} dpi
 * @returns {LabelTemplate} a new template; the input is not mutated
 */
export function resolve(template, dpi) {
  const valid = validateTemplate(template);
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new TemplateValidationError(`Print resolution must be positive, received ${String(dpi)}`);
  }
  const design = valid.designDpi ?? DESIGN_DPI;
  const factor = dpi / design;
  const scale = (value) => Math.round(value * factor);

  return {
    ...valid,
    designDpi: design,
    dpi,
    slots: valid.slots.map((slot) => {
      const next = { ...slot };
      for (const key of SCALABLE) {
        if (typeof next[key] === 'number') next[key] = scale(next[key]);
      }
      if (next.flow && typeof next.flow.gap === 'number') {
        next.flow = { ...next.flow, gap: scale(next.flow.gap) };
      }
      if (next.sizeTo && typeof next.sizeTo.padX === 'number') {
        next.sizeTo = { ...next.sizeTo, padX: scale(next.sizeTo.padX) };
      }
      return next;
    }),
  };
}

/**
 * Label dimensions in dots at a given resolution.
 * @param {LabelTemplate} template
 * @param {number} [dpi]
 * @returns {{ width: number, height: number, quietZone: number }}
 */
export function dimensions(template, dpi = template.dpi ?? DESIGN_DPI) {
  return {
    width: Math.round(template.widthIn * dpi),
    height: Math.round(template.heightIn * dpi),
    quietZone: Math.round(((template.quietZoneMm ?? 0) / 25.4) * dpi),
  };
}
