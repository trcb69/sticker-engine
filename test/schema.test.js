import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTemplate, resolve, dimensions, DESIGN_DPI } from '../src/template/schema.js';
import { TemplateValidationError } from '../src/errors.js';

const raw = JSON.parse(readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'));

test('the shipped template validates', () => {
  assert.equal(validateTemplate(raw).id, 'label-4x1-v1');
});

test('label dimensions follow the resolution', () => {
  assert.deepEqual(dimensions(resolve(raw, 203)), { width: 812, height: 203, quietZone: 12 });
  assert.deepEqual(dimensions(resolve(raw, 300)), { width: 1200, height: 300, quietZone: 18 });
  assert.deepEqual(dimensions(resolve(raw, 600)), { width: 2400, height: 600, quietZone: 35 });
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
  // the bar must be emitted first so ^FR has something to reverse against.
  const qtyBg = raw.slots.find((s) => s.id === 'qtyBg');
  const qtyIndex = raw.slots.findIndex((s) => s.id === 'qty');
  const bgIndex = raw.slots.findIndex((s) => s.id === 'qtyBg');
  assert.equal(qtyBg.sizeTo.slot, 'qty');
  assert.ok(bgIndex < qtyIndex, 'the bar is declared before its caption');
  assert.doesNotThrow(() => validateTemplate(raw));
});

test('an unknown sizeTo target is still rejected', () => {
  const bad = JSON.parse(JSON.stringify(raw));
  bad.slots.find((s) => s.id === 'qtyBg').sizeTo.slot = 'ghost';
  assert.throws(() => validateTemplate(bad), /sizes to unknown slot/);
});

test('the design density is what the template is authored at', () => {
  assert.equal(raw.designDpi, DESIGN_DPI);
});
