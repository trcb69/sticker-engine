import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveMoveTarget, nudgeSlot, resizeSlot, resizableAxes } from '../public/js/slotGeometry.js';

/**
 * Only six of the eleven slots on the reference label carry coordinates of
 * their own. Nudging one of the other five wrote an `x` the layout never reads,
 * so the arrow keys did nothing and said nothing — which reads as a broken
 * feature rather than a derived slot. This is the logic that fixes it, and it
 * is tested against the real template rather than a sketch of one.
 */
const template = () => JSON.parse(
  readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'),
);

const slot = (t, id) => t.slots.find((s) => s.id === id);

/* -- Resolving what carries the position ---------------------------------- */

test('a slot with its own coordinates resolves to itself', () => {
  const t = template();
  const target = resolveMoveTarget(t, 'border');
  assert.equal(target.id, 'border');
  assert.equal(target.via, null);
  assert.equal(target.axis, 'xy');
});

test('a slot declared inside a box resolves to the box', () => {
  // `name` is `{"box": "nameBg"}` — the text has no x of its own, so nudging
  // the product name has to nudge its bar. That is what the operator means.
  const target = resolveMoveTarget(template(), 'name');
  assert.equal(target.id, 'nameBg');
  assert.equal(target.via, 'name');
});

test('a slot flowed after another resolves to that one', () => {
  // `mnf` is `{"flow": {"after": "qtyBg"}}`.
  const target = resolveMoveTarget(template(), 'mnf');
  assert.equal(target.id, 'qtyBg');
  assert.equal(target.via, 'mnf');
});

test('an edge-anchored slot moves by its margin, not an x', () => {
  // The QR is pinned right with a margin. Writing an x would do nothing.
  const target = resolveMoveTarget(template(), 'qr');
  assert.equal(target.id, 'qr');
  assert.equal(target.axis, 'rightMargin');
});

test('a slot that is not in the template resolves to nothing', () => {
  assert.equal(resolveMoveTarget(template(), 'nonesuch'), null);
  assert.equal(resolveMoveTarget({}, 'name'), null);
});

/* -- Nudging --------------------------------------------------------------- */

test('nudging a positioned slot changes its own coordinates', () => {
  const t = template();
  const before = { x: slot(t, 'logo').x, y: slot(t, 'logo').y };
  const moved = nudgeSlot(t, 'logo', 4, -2);

  assert.deepEqual(moved, { id: 'logo', via: null });
  assert.equal(slot(t, 'logo').x, before.x + 4);
  assert.equal(slot(t, 'logo').y, before.y - 2);
});

test('nudging a derived slot moves its anchor and reports which', () => {
  const t = template();
  const nameBefore = { x: slot(t, 'nameBg').x, y: slot(t, 'nameBg').y };
  const moved = nudgeSlot(t, 'name', 3, 5);

  assert.deepEqual(moved, { id: 'nameBg', via: 'name' });
  assert.equal(slot(t, 'nameBg').x, nameBefore.x + 3);
  assert.equal(slot(t, 'nameBg').y, nameBefore.y + 5);
  assert.equal(slot(t, 'name').x, undefined, 'the text still has no x of its own');
});

test('nudging the QR right decreases its right margin', () => {
  // Moving toward the right edge means less margin, so the sign inverts. Adding
  // to it would send the QR the wrong way.
  const t = template();
  const before = slot(t, 'qr').rightMargin;
  nudgeSlot(t, 'qr', 5, 0);
  assert.equal(slot(t, 'qr').rightMargin, before - 5);
});

test('the QR right margin never goes negative', () => {
  const t = template();
  nudgeSlot(t, 'qr', 9999, 0);
  assert.equal(slot(t, 'qr').rightMargin, 0);
});

test('nudging something absent changes nothing and says so', () => {
  const t = template();
  const snapshot = JSON.stringify(t);
  assert.equal(nudgeSlot(t, 'nonesuch', 5, 5), null);
  assert.equal(JSON.stringify(t), snapshot);
});

/* -- Resizing, per axis ---------------------------------------------------- */

test('a box stating both dimensions resizes on both axes', () => {
  const t = template();
  const before = { w: slot(t, 'nameBg').w, h: slot(t, 'nameBg').h };

  assert.deepEqual(resizeSlot(t, 'nameBg', 6, 0), { id: 'nameBg', via: null, axis: 'w' });
  assert.equal(slot(t, 'nameBg').w, before.w + 6);

  assert.deepEqual(resizeSlot(t, 'nameBg', 0, 4), { id: 'nameBg', via: null, axis: 'h' });
  assert.equal(slot(t, 'nameBg').h, before.h + 4);
});

test('widening a box that takes its width from its content is refused', () => {
  // `qtyBg` states a height and no width. It previously reported success and
  // changed nothing — the same silent no-op the arrow keys had.
  const t = template();
  assert.equal(slot(t, 'qtyBg').w, undefined);
  assert.equal(resizeSlot(t, 'qtyBg', 5, 0), null, 'refused rather than silently ignored');

  const resized = resizeSlot(t, 'qtyBg', 0, 5);
  assert.equal(resized.axis, 'h', 'but its height is stated, so that still works');
});

test('resizing a derived slot resizes its anchor', () => {
  const t = template();
  const before = slot(t, 'nameBg').w;
  const resized = resizeSlot(t, 'name', 7, 0);
  assert.deepEqual(resized, { id: 'nameBg', via: 'name', axis: 'w' });
  assert.equal(slot(t, 'nameBg').w, before + 7);
});

test('a slot cannot be shrunk below one dot', () => {
  const t = template();
  resizeSlot(t, 'nameBg', -9999, -9999);
  assert.equal(slot(t, 'nameBg').w, 1);
  assert.equal(slot(t, 'nameBg').h, 1);
});

test('the readout is told which axes the template actually states', () => {
  const t = template();
  assert.deepEqual(resizableAxes(t, 'nameBg'), { width: true, height: true });
  assert.deepEqual(resizableAxes(t, 'qtyBg'), { width: false, height: true });
  assert.deepEqual(resizableAxes(t, 'qty'), { width: false, height: true }, 'via its box');
  assert.deepEqual(resizableAxes(t, 'nonesuch'), { width: false, height: false });
  assert.deepEqual(resizableAxes(t, 'logo'), { width: false, height: false }, 'a bitmap cannot be stretched');
  assert.equal(resizeSlot(t, 'logo', 1, 0), null, 'and a resize key does nothing to it');
  assert.equal(t.slots.find((s) => s.id === 'logo').w, 144);
});
