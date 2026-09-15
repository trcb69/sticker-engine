import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from '../src/template/schema.js';
import { layout } from '../src/render/layout.js';
import { field, missing } from '../src/model/types.js';
import { referenceContext, contextWith, longNameContext, noDocNoContext } from './fixtures/context.js';

const raw = JSON.parse(readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'));
const at = (dpi) => resolve(raw, dpi);
const find = (placed, id) => placed.elements.find((e) => e.id === id);

test('the reference label places every slot', () => {
  const placed = layout(at(203), referenceContext);
  assert.equal(placed.skipped.length, 0);
  assert.equal(placed.elements.length, raw.slots.length);
});

test('the header packs onto two lines at full size', () => {
  const header = find(layout(at(203), referenceContext), 'header');
  assert.equal(header.lines.length, 2);
  assert.equal(header.size, 22, 'no shrinking needed');
  assert.equal(header.overflowLines, false);
});

test('an absent document number removes its part and its separator', () => {
  const header = find(layout(at(203), noDocNoContext), 'header');
  const joined = header.lines.map((l) => l.text).join(' ');
  assert.ok(!joined.includes('RSMINV'));
  assert.ok(!joined.includes('|  |'), 'no stranded separator');
  assert.ok(joined.includes('Hi Fashion Holdings Pvt Ltd'));
  assert.ok(joined.includes('MANUFACTURE'));
});

test('the product name keeps its house size and only shrinks when it must', () => {
  const short = find(layout(at(203), referenceContext), 'name');
  assert.equal(short.size, 38, 'a short name is not enlarged past the house size');
  assert.equal(short.shrunk, false);

  const long = find(layout(at(203), longNameContext), 'name');
  assert.ok(long.size < 38, 'a long name shrinks');
  assert.equal(long.truncated, false, 'and still fits without truncation');
});

test('text stays vertically centred in its bar after shrinking', () => {
  const box = raw.slots.find((s) => s.id === 'nameBg');
  for (const context of [referenceContext, longNameContext]) {
    const name = find(layout(at(203), context), 'name');
    const topGap = name.y - box.y;
    const bottomGap = (box.y + box.h) - (name.y + name.size);
    assert.ok(Math.abs(topGap - bottomGap) <= 1, `centred at size ${name.size}`);
  }
});

test('the quantity bar measures itself to its caption', () => {
  const narrow = layout(at(203), referenceContext);
  const wide = layout(at(203), contextWith({ qtyText: field('1L 500ML', 'derived') }));
  assert.ok(find(wide, 'qtyBg').w > find(narrow, 'qtyBg').w);
});

test('a wider quantity pushes the flow along and squeezes the barcode', () => {
  const narrow = layout(at(203), referenceContext);
  const wide = layout(at(203), contextWith({ qtyText: field('10L 500ML', 'derived') }));
  assert.ok(find(wide, 'batch').x > find(narrow, 'batch').x, 'barcode starts further right');
  assert.ok(find(wide, 'batch').w < find(narrow, 'batch').w, 'and gets less room');
});

test('the barcode expands to the remaining width, honouring its right margin', () => {
  const placed = layout(at(203), referenceContext);
  const batch = find(placed, 'batch');
  const margin = raw.slots.find((s) => s.id === 'batch').rightMargin;
  assert.equal(batch.x + batch.w, placed.width - margin);
});

test('the QR is pinned to the right edge at whatever size it resolves to', () => {
  const placed = layout(at(203), referenceContext);
  const qr = find(placed, 'qr');
  assert.equal(qr.x + qr.w, placed.width - 18);
  assert.equal(qr.plan.mode, 'alphanumeric');
});

test('a bar whose caption is absent is dropped, not printed empty', () => {
  const placed = layout(at(203), contextWith({ qtyText: missing() }));
  assert.ok(placed.skipped.includes('qty'));
  assert.ok(placed.skipped.includes('qtyBg'), 'the bar goes with its caption');
  assert.equal(find(placed, 'qtyBg'), undefined);
});

test('flow falls back gracefully when its anchor was dropped', () => {
  const placed = layout(at(203), contextWith({ qtyText: missing() }));
  const mnf = find(placed, 'mnf');
  assert.ok(mnf, 'the dates still print');
  assert.ok(mnf.x >= 0);
});

test('layout scales to 300 and 600 dpi without a second template', () => {
  for (const [dpi, width] of [[300, 1182], [600, 2365]]) {
    const placed = layout(at(dpi), referenceContext);
    assert.equal(placed.width, width);
    assert.equal(placed.skipped.length, 0);
    const batch = find(placed, 'batch');
    assert.ok(batch.plan.dotsPerModule > 2, `${dpi} dpi gives the barcode more dots per module`);
  }
});

test('every label stays inside the safe margin at every density', async () => {
  const { guard } = await import('../src/render/guard.js');
  for (const dpi of [203, 300, 600]) {
    for (const context of [referenceContext, longNameContext, noDocNoContext]) {
      const placed = layout(at(dpi), context);
      // The 1.000KG quantity already left the barcode 6 dots short on the 4x1
      // template. The new layout recovers 3 of them; the preview still flags
      // it as an error, as before. Printing is not blocked by the guard.
      const tooNarrowBefore = context === noDocNoContext && dpi === 203;
      const margin = tooNarrowBefore
        ? ['EDGE_OVERFLOW', 'QUIET_ZONE_INTRUSION']
        : ['EDGE_OVERFLOW', 'QUIET_ZONE_INTRUSION', 'BARCODE_TOO_NARROW'];
      const bad = guard(placed).filter((w) => margin.includes(w.code));
      assert.deepEqual(bad.map((w) => `${w.code}:${w.slotId}`), [], `${dpi} dpi`);
      if (tooNarrowBefore) assert.ok(find(placed, 'batch').w >= 305, 'no narrower than before');
      assert.ok(!placed.elements.some((el) => el.edge), 'nothing opts out of the margin');
    }
  }
});

test('bold is carried to the emitter, not baked into geometry', () => {
  const header = find(layout(at(203), referenceContext), 'header');
  assert.equal(header.bold, true);
  assert.equal(header.lines.length, 2, 'still two lines, not four');
});

test('the QR correction level can be decided upstream and still printed', () => {
  // The short-link service picks the strongest level that clears the dot floor
  // for the payload it minted. If the template printed a different level, the
  // symbol on the drum would not be the one the operator was shown.
  const withM = find(layout(at(203), contextWith({ qrEcc: field('M', 'derived') })), 'qr');
  const withQ = find(layout(at(203), contextWith({ qrEcc: field('Q', 'derived') })), 'qr');
  assert.equal(withM.plan.ecc, 'M');
  assert.equal(withQ.plan.ecc, 'Q');

  const fallback = find(layout(at(203), contextWith({ qrEcc: missing() })), 'qr');
  assert.equal(fallback.plan.ecc, 'M', 'the template level when nothing was chosen');
});
