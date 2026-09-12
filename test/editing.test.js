import test from 'node:test';
import assert from 'node:assert/strict';

import { elementAt, isOutsideLabel } from '../public/js/hitTest.js';

/**
 * The two pieces of the editable preview that are pure enough to test without
 * a browser: which slot a click lands on, and whether a slot has been pushed
 * off the sticker. The drawing itself is exercised against real Chrome.
 */

/** The reference label's shape: a full-size border with everything inside it. */
const placed = () => ({
  width: 812,
  height: 203,
  dpi: 203,
  quietZone: 8,
  elements: [
    { id: 'border', x: 4, y: 4, w: 804, h: 195 },
    { id: 'logo', x: 14, y: 50, w: 140, h: 140 },
    { id: 'header', x: 166, y: 12, w: 492, h: 48 },
    { id: 'nameBg', x: 166, y: 64, w: 512, h: 54 },
    { id: 'name', x: 175, y: 72, w: 365, h: 38 },
  ],
});

test('a click lands on the smallest slot under it, not the frame over everything', () => {
  // The border covers the whole label, so "topmost wins" answers "border" for
  // every click — never what someone clicking the product name meant.
  assert.equal(elementAt(placed(), 300, 90).id, 'name');
  assert.equal(elementAt(placed(), 660, 90).id, 'nameBg', 'outside name, still inside its bar');
  assert.equal(elementAt(placed(), 60, 100).id, 'logo');
  assert.equal(elementAt(placed(), 400, 30).id, 'header');
});

test('empty label area still selects the border, so there is something to grab', () => {
  assert.equal(elementAt(placed(), 700, 180).id, 'border');
});

test('a point outside every slot selects nothing', () => {
  assert.equal(elementAt(placed(), 2, 2), null);
  assert.equal(elementAt(placed(), -40, 100), null, 'out in the bleed margin');
});

test('a slot dragged past the edge is detectable as clipped', () => {
  // What the red marking and the "will not print" warning both key off.
  const label = placed();
  const slot = (id) => label.elements.find((e) => e.id === id);

  assert.equal(isOutsideLabel(label, slot('name')), false);
  assert.equal(isOutsideLabel(label, { ...slot('name'), x: 600 }), true,
    '600 + 365 runs past the 812-dot edge');
  assert.equal(isOutsideLabel(label, { ...slot('logo'), y: -10 }), true,
    'off the top edge counts too');
  assert.equal(isOutsideLabel(label, { ...slot('border'), x: 4, y: 4 }), false,
    'flush against the edge is inside, not outside');
});
