import test from 'node:test';
import assert from 'node:assert/strict';
import {
  code128Modules, planCode128, planQr, qrMode,
  MIN_BARCODE_DOTS_PER_MODULE, MIN_QR_DOTS_PER_MODULE,
} from '../src/render/symbology.js';

test('Code 128 module count covers start, checksum and stop', () => {
  assert.equal(code128Modules('JUR260725'), 11 * 11 + 13);
  assert.equal(code128Modules('A'), 11 * 3 + 13);
  assert.throws(() => code128Modules(''), TypeError);
});

test('a nine-character batch fits the space the label leaves it', () => {
  const plan = planCode128('JUR260725', 322);
  assert.equal(plan.fits, true);
  assert.ok(plan.dotsPerModule >= MIN_BARCODE_DOTS_PER_MODULE);
  assert.equal(plan.moduleWidth, 2);
});

test('too little room is reported, not silently shrunk to one dot', () => {
  const plan = planCode128('JUR260725', 200);
  assert.equal(plan.fits, false);
  assert.ok(plan.dotsPerModule < MIN_BARCODE_DOTS_PER_MODULE);
});

test('uppercase picks alphanumeric mode, one lowercase character does not', () => {
  assert.equal(qrMode('HTTPS://X.GD/HFH7K2'), 'alphanumeric');
  assert.equal(qrMode('https://x.gd/HFH7K2'), 'byte');
  assert.equal(qrMode('HTTPS://X.GD/aB3xK9'), 'byte');
});

test('uppercase buys a stronger error correction at the same symbol size', () => {
  const upperQ = planQr('HTTPS://X.GD/HFH7K2', 96, { ecc: 'Q' });
  const lowerM = planQr('https://x.gd/HFH7K2', 96, { ecc: 'M' });
  assert.equal(upperQ.totalModules, lowerM.totalModules, 'same symbol size');
  assert.equal(upperQ.ecc, 'Q', 'but stronger correction');
  assert.ok(upperQ.magnification >= MIN_QR_DOTS_PER_MODULE);
});

test('an x.gd link fits comfortably, mixed case or not', () => {
  assert.equal(planQr('HTTPS://X.GD/HFH7K2', 96, { ecc: 'Q' }).fits, true);
  assert.equal(planQr('https://x.gd/aB3xK9', 96, { ecc: 'Q' }).fits, true);
});

test('a raw ClickUp form URL is too dense to scan on this label', () => {
  const plan = planQr(
    'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC?Batch=JUR260725',
    96, { ecc: 'M' },
  );
  assert.ok(plan.magnification < MIN_QR_DOTS_PER_MODULE, 'below the scan floor');
});

test('a payload past version 10 is refused rather than encoded badly', () => {
  const plan = planQr('A'.repeat(2000), 96, { ecc: 'M' });
  assert.equal(plan.fits, false);
  assert.equal(plan.version, 0);
});
