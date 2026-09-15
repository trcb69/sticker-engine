import test from 'node:test';
import assert from 'node:assert/strict';
import { testLabel } from '../public/js/testLabel.js';

test('the diagnostics test label fits the 100 x 25 mm stock inside the margin', () => {
  const zpl = testLabel('ZD421');
  assert.match(zpl, /\^PW800\n/);
  assert.match(zpl, /\^LL200\n/);
  for (const [, x, y] of zpl.matchAll(/\^FO(\d+),(\d+)/g)) {
    assert.ok(Number(x) >= 12 && Number(y) >= 12, `^FO${x},${y} is inside the margin`);
  }
  const [, barY] = zpl.match(/\^FO\d+,(\d+)\^BCN,(\d+)/);
  const [, barHeight] = zpl.match(/\^BCN,(\d+)/);
  assert.ok(Number(barY) + Number(barHeight) + 20 <= 188, 'bars plus their text end above the margin');
  assert.ok(zpl.includes('^FO12,12^GB775,176,2^FS'));
});

test('the device name cannot inject commands into the test label', () => {
  assert.ok(!testLabel('evil^XZ~JA').includes('evil^XZ'));
});
