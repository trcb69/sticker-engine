import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from '../src/template/schema.js';
import { layout } from '../src/render/layout.js';
import { guard, isPrintable, WARNING_CODES, MIN_LEGIBLE_TEXT_DOTS } from '../src/render/guard.js';
import { field, missing } from '../src/model/types.js';
import { referenceContext, contextWith } from './fixtures/context.js';

const raw = JSON.parse(readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'));
const check = (context, template = raw, dpi = 203, options) =>
  guard(layout(resolve(template, dpi), context), options);
const codes = (warnings) => warnings.map((w) => w.code);

test('the reference label is clean and printable', () => {
  const warnings = check(referenceContext);
  assert.deepEqual(warnings, [], 'no warnings on the reference layout');
  assert.equal(isPrintable(warnings), true);
});

test('every warning code has a description', () => {
  for (const code of Object.keys(WARNING_CODES)) {
    assert.equal(typeof WARNING_CODES[code], 'string');
  }
});

test('a narrower printhead is reported separately from a label overflow', () => {
  const warnings = check(referenceContext, raw, 203, { printheadWidth: 600 });
  assert.ok(codes(warnings).includes('PRINTHEAD_OVERFLOW'));
  assert.ok(!codes(warnings).includes('EDGE_OVERFLOW'), 'the artwork is still on the label');
  assert.equal(isPrintable(warnings), false);
});

test('artwork past the label edge is an error', () => {
  const wide = JSON.parse(JSON.stringify(raw));
  wide.slots.find((s) => s.id === 'nameBg').w = 900;
  const warnings = check(referenceContext, wide);
  assert.ok(codes(warnings).includes('EDGE_OVERFLOW'));
  assert.equal(isPrintable(warnings), false);
});

test('quiet-zone intrusion is a warning, and the border opts out explicitly', () => {
  const creeping = JSON.parse(JSON.stringify(raw));
  creeping.slots.find((s) => s.id === 'header').y = 2;
  const warnings = check(referenceContext, creeping);
  const intrusions = warnings.filter((w) => w.code === 'QUIET_ZONE_INTRUSION');
  assert.equal(intrusions.length, 1);
  assert.equal(intrusions[0].slotId, 'header');
  assert.equal(intrusions[0].severity, 'warn');
  assert.ok(!intrusions.some((w) => w.slotId === 'border'), 'the border sits at the edge by design');
});

test('a barcode squeezed below two dots per module is an error', () => {
  const warnings = check(contextWith({
    qtyText: field('10L 500ML', 'derived'),
    mnfDate: field('09/2026 (LOT A)', 'manual'),
    expDate: field('09/2028 (LOT A)', 'derived'),
    batchCode: field('JUR260725XYZ', 'manual'),
  }));
  const barcode = warnings.find((w) => w.code === 'BARCODE_TOO_NARROW');
  assert.ok(barcode, 'caught before printing');
  assert.equal(barcode.severity, 'error');
  assert.ok(barcode.detail.dotsPerModule < 2);
  assert.equal(isPrintable(warnings), false);
});

test('a raw ClickUp URL trips the QR density floor', () => {
  const warnings = check(contextWith({
    qrPayload: field('https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC', 'manual'),
  }));
  const qr = warnings.find((w) => w.code === 'QR_TOO_DENSE');
  assert.ok(qr);
  assert.equal(qr.severity, 'error');
  assert.ok(qr.detail.magnification < 3);
  assert.equal(qr.detail.mode, 'byte', 'lowercase forced the denser encoding');
});

test('a QR payload too long to encode at all is its own error', () => {
  const warnings = check(contextWith({ qrPayload: field('A'.repeat(2000), 'manual') }));
  assert.ok(codes(warnings).includes('QR_PAYLOAD_UNENCODABLE'));
});

test('text shrunk below the legible floor is flagged', () => {
  const tiny = JSON.parse(JSON.stringify(raw));
  const name = tiny.slots.find((s) => s.id === 'name');
  name.minSize = 8;
  const warnings = check(
    contextWith({ displayName: field('A'.repeat(90), 'extracted') }),
    tiny,
  );
  const illegible = warnings.find((w) => w.code === 'TEXT_ILLEGIBLE');
  assert.ok(illegible);
  assert.ok(illegible.detail.size < MIN_LEGIBLE_TEXT_DOTS);
});

test('truncated text is flagged separately from illegible text', () => {
  const warnings = check(contextWith({ displayName: field('B'.repeat(120), 'extracted') }));
  assert.ok(codes(warnings).includes('TEXT_TRUNCATED'));
});

test('a header that will not pack into its lines is an error, not a silent trim', () => {
  const warnings = check(contextWith({
    manufacturer: field('MISCELLANEOUS SUPPLIER, SECONDARY PACKAGING AND DISPATCH DIVISION', 'manual'),
    customer: field('Hi Fashion Holdings Private Limited (Seethawaka Export Processing Zone)', 'extracted'),
  }));
  const overflow = warnings.find((w) => w.code === 'JOIN_OVERFLOW');
  assert.ok(overflow, 'the operator is told some of it is not printed');
  assert.equal(overflow.severity, 'error');
});

test('a dropped slot is reported as information, not a failure', () => {
  const warnings = check(contextWith({ qtyText: missing() }));
  const dropped = warnings.filter((w) => w.code === 'SLOT_DROPPED');
  assert.ok(dropped.length >= 2, 'the caption and its bar');
  assert.ok(dropped.every((w) => w.severity === 'info'));
  assert.equal(isPrintable(warnings), true, 'an absent value does not block printing');
});

test('a denser printhead helps the barcode only in proportion to the density', () => {
  // Raising dpi does not rescue a barcode as much as it looks like it should.
  // The module count is fixed by the data, but every text element before the
  // barcode scales too, so the barcode's share of the label is unchanged and
  // dots-per-module rises strictly in proportion to dpi. A layout at 1.1 dots
  // per module therefore needs roughly double the density, not half again.
  const tight = contextWith({
    qtyText: field('10L 500ML', 'derived'),
    mnfDate: field('09/2026 (LOT A)', 'manual'),
    expDate: field('09/2028 (LOT A)', 'derived'),
    batchCode: field('JUR260725XYZ', 'manual'),
  });
  assert.ok(codes(check(tight, raw, 203)).includes('BARCODE_TOO_NARROW'));
  assert.ok(codes(check(tight, raw, 300)).includes('BARCODE_TOO_NARROW'),
    '300 dpi is not enough; the whole layout scaled with it');
  assert.ok(!codes(check(tight, raw, 600)).includes('BARCODE_TOO_NARROW'),
    '600 dpi finally clears the two dot floor');
});

test('dots per module rises linearly with resolution', () => {
  const at = (dpi) => layout(resolve(raw, dpi), referenceContext)
    .elements.find((e) => e.id === 'batch').plan.dotsPerModule;
  const ratio = at(600) / at(203);
  assert.ok(Math.abs(ratio - 600 / 203) < 0.05, `expected ~2.96, got ${ratio.toFixed(2)}`);
});
