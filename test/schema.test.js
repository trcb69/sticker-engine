import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTemplate, resolve, dimensions, DESIGN_DPI } from '../src/template/schema.js';
import { TemplateValidationError } from '../src/errors.js';
import { emit } from '../src/render/zpl.js';
import { referenceContext } from './fixtures/context.js';

const raw = JSON.parse(readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'));

test('the shipped template validates', () => {
  assert.equal(validateTemplate(raw).id, 'label-100x25-v2');
});

test('label dimensions follow the resolution', () => {
  // 100 x 25 mm stock. 600 dpi width is 2364.53 before rounding, the closest
  // call of the three, so it is pinned here.
  assert.deepEqual(dimensions(resolve(raw, 203)), { width: 800, height: 200, quietZone: 12 });
  assert.deepEqual(dimensions(resolve(raw, 300)), { width: 1182, height: 296, quietZone: 18 });
  assert.deepEqual(dimensions(resolve(raw, 600)), { width: 2365, height: 591, quietZone: 35 });
});

test('every length scales together, so 300 and 600 dpi need no second template', () => {
  const at203 = resolve(raw, 203);
  const at600 = resolve(raw, 600);
  for (const slot of at203.slots) {
    const scaled = at600.slots.find((s) => s.id === slot.id);
    for (const key of ['x', 'y', 'w', 'h', 'size']) {
      if (typeof slot[key] !== 'number') continue;
      const expected = Math.round(slot[key] * (600 / 203));
      assert.equal(scaled[key], expected, `${slot.id}.${key}`);
    }
  }
});

test('resolve does not mutate the input template', () => {
  const before = JSON.stringify(raw);
  resolve(raw, 600);
  assert.equal(JSON.stringify(raw), before);
});

test('resolve rejects a nonsense resolution', () => {
  assert.throws(() => resolve(raw, 0), TemplateValidationError);
  assert.throws(() => resolve(raw, -300), TemplateValidationError);
});

test('validation catches structural mistakes', () => {
  const clone = () => JSON.parse(JSON.stringify(raw));

  const dupe = clone();
  dupe.slots.push({ ...dupe.slots[0] });
  assert.throws(() => validateTemplate(dupe), /duplicate slot id/);

  const unknownType = clone();
  unknownType.slots[0].type = 'hologram';
  assert.throws(() => validateTemplate(unknownType), /unknown type/);

  const missingProp = clone();
  delete missingProp.slots.find((s) => s.id === 'name').size;
  assert.throws(() => validateTemplate(missingProp), /missing "size"/);

  const unpositioned = clone();
  const name = unpositioned.slots.find((s) => s.id === 'name');
  delete name.box;
  assert.throws(() => validateTemplate(unpositioned), /needs an x, a flow, a box/);

  const badFloor = clone();
  badFloor.slots.find((s) => s.id === 'name').minSize = 99;
  assert.throws(() => validateTemplate(badFloor), /minSize greater than size/);
});

test('placement references must point backwards, measurement references need not', () => {
  const forwardFlow = JSON.parse(JSON.stringify(raw));
  forwardFlow.slots.find((s) => s.id === 'mnf').flow = { after: 'batch', gap: 10 };
  assert.throws(() => validateTemplate(forwardFlow), /declared after it/);

  // qtyBg sizes to qty, which is declared later. That is deliberate and legal:
  // the bar is placed first because the caption is positioned from it.
  const qtyBg = raw.slots.find((s) => s.id === 'qtyBg');
  const qtyIndex = raw.slots.findIndex((s) => s.id === 'qty');
  const bgIndex = raw.slots.findIndex((s) => s.id === 'qtyBg');
  assert.equal(qtyBg.sizeTo.slot, 'qty');
  assert.ok(bgIndex < qtyIndex, 'the bar is declared before its caption');
  assert.doesNotThrow(() => validateTemplate(raw));
});

test('reversed text must sit in its own filled box', () => {
  const clone = () => JSON.parse(JSON.stringify(raw));
  const slot = (t, id) => t.slots.find((s) => s.id === id);

  const noBox = clone();
  delete slot(noBox, 'qty').box;
  slot(noBox, 'qty').x = 175;
  assert.throws(() => validateTemplate(noBox), /slot "qty" is reversed but has no box/);

  const outline = clone();
  slot(outline, 'nameBg').fill = false;
  assert.throws(() => validateTemplate(outline), /slot "name" is reversed but its box "nameBg" is not a filled box/);

  const notABox = clone();
  slot(notABox, 'name').box = 'logo';
  assert.throws(() => validateTemplate(notABox), /slot "name" is reversed but its box "logo" is not a filled box/);

  const shared = clone();
  slot(shared, 'qty').box = 'nameBg';
  assert.throws(() => validateTemplate(shared), /box "nameBg" is the backdrop of more than one reversed slot/);

  assert.doesNotThrow(() => validateTemplate(raw));
});

test('a graphic carries either a printer object or its own bitmap, never both', () => {
  const clone = () => JSON.parse(JSON.stringify(raw));
  const logo = (t) => t.slots.find((s) => s.id === 'logo');

  const both = clone();
  logo(both).source = 'R:LOGO.GRF';
  assert.throws(() => validateTemplate(both), /slot "logo" \(graphic\) needs either "source" or "data", not both/);

  const neither = clone();
  delete logo(neither).data;
  assert.throws(() => validateTemplate(neither), /slot "logo" \(graphic\) needs either "source" or "data"$/);

  const short = clone();
  logo(short).data.hex = logo(short).data.hex.slice(2);
  assert.throws(() => validateTemplate(short), /slot "logo" graphic data does not match its w×h/);

  const wideRows = clone();
  logo(wideRows).data.bytesPerRow = 19;
  assert.throws(() => validateTemplate(wideRows), /slot "logo" graphic data does not match its w×h/);

  const lower = clone();
  logo(lower).data.hex = logo(lower).data.hex.toLowerCase();
  assert.throws(() => validateTemplate(lower), /slot "logo" graphic data does not match its w×h/);

  const stored = clone();
  delete logo(stored).data;
  logo(stored).source = 'R:LOGO.GRF';
  assert.doesNotThrow(() => validateTemplate(stored), 'a printer object on its own is still fine');
  assert.ok(emit(resolve(stored, 203), referenceContext).zpl.includes('^FO14,28^XGR:LOGO.GRF,1,1^FS'),
    'and it is recalled from printer memory');

  const sheared = clone();
  // 24 bytes per row over 108 rows is also 5184 hex characters: only the row
  // width rule stops a bitmap that would print sheared.
  logo(sheared).data.bytesPerRow = 24;
  logo(sheared).h = 108;
  assert.throws(() => validateTemplate(sheared), /slot "logo" graphic data does not match its w×h/);

  const nulled = clone();
  logo(nulled).data = null;
  assert.throws(() => validateTemplate(nulled), /slot "logo" graphic data does not match its w×h/);
});

test('an unknown sizeTo target is still rejected', () => {
  const bad = JSON.parse(JSON.stringify(raw));
  bad.slots.find((s) => s.id === 'qtyBg').sizeTo.slot = 'ghost';
  assert.throws(() => validateTemplate(bad), /sizes to unknown slot/);
});

test('the design density is what the template is authored at', () => {
  assert.equal(raw.designDpi, DESIGN_DPI);
});
