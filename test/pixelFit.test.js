import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_PAD, cssPixels, fitScale, padToWholeCssPixels } from '../public/js/pixelFit.js';

/**
 * The preview used to be drawn large and shrunk by CSS, which drops or doubles
 * rows of pixels: the 3-dot border came out 3 pixels on one side and 4 on
 * another, and on a phone the canvas ran past its card and lost its right edge.
 * These are the numbers that stop both. Each case was confirmed against Chrome
 * by comparing screen pixels with the canvas bitmap.
 */

// The calibrate canvas at 203 dpi: 812 dots plus a 48-dot margin each side.
const CALIBRATE_DOTS = 812 + 96;

/* -- Pixels per dot ------------------------------------------------------- */

test('whole device pixels per dot whenever the column has room', () => {
  assert.deepEqual(fitScale(CALIBRATE_DOTS, { fitWidth: 1010, pixelRatio: 1, maxCssPerDot: 3 }),
    { scale: 1, pixelRatio: 1, exact: true });
  assert.equal(fitScale(CALIBRATE_DOTS, { fitWidth: 1010, pixelRatio: 2, maxCssPerDot: 3 }).scale, 2);
  // 1.25 is a common Windows laptop setting.
  assert.equal(fitScale(CALIBRATE_DOTS, { fitWidth: 900, pixelRatio: 1.25, maxCssPerDot: 3 }).scale, 1);
});

test('never more CSS pixels per dot than asked for, however wide the screen', () => {
  const { scale, pixelRatio } = fitScale(CALIBRATE_DOTS, { fitWidth: 5000, pixelRatio: 1, maxCssPerDot: 3 });
  assert.equal(scale / pixelRatio, 3);
});

test('the drawn width, padding included, never exceeds the column', () => {
  for (const pixelRatio of [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (let fitWidth = 200; fitWidth <= 2600; fitWidth += 37) {
      const { scale } = fitScale(CALIBRATE_DOTS, { fitWidth, pixelRatio, maxCssPerDot: 3 });
      const drawn = padToWholeCssPixels(Math.round(CALIBRATE_DOTS * scale), pixelRatio);
      assert.ok(drawn / pixelRatio <= fitWidth + 1e-9,
        `${fitWidth}px column at ${pixelRatio}x drew ${drawn / pixelRatio}px`);
    }
  }
});

test('a phone gets a fraction and is told it is not exact, rather than a cut-off label', () => {
  const fit = fitScale(CALIBRATE_DOTS, { fitWidth: 340, pixelRatio: 2, maxCssPerDot: 3 });
  assert.equal(fit.exact, false);
  assert.ok(fit.scale < 1 && fit.scale > 0);
});

test('without a width to fit, the ceiling is used', () => {
  assert.deepEqual(fitScale(812, { maxCssPerDot: 2 }), { scale: 2, pixelRatio: 1, exact: true });
});

/* -- Whole CSS pixels ------------------------------------------------------ */

test('pads a bitmap until its CSS size is a whole number of pixels', () => {
  // 299 rows at 2x is 149.5px, which Chrome paints by resampling.
  assert.equal(padToWholeCssPixels(299, 2), 300);
  assert.equal(padToWholeCssPixels(908, 3), 909);
  assert.equal(padToWholeCssPixels(908, 1.25), 910);
  assert.equal(padToWholeCssPixels(299, 1.75), 301);
  assert.equal(padToWholeCssPixels(812, 1), 812);
});

test('padding is bounded, and a ratio with no short period is left alone', () => {
  for (const pixelRatio of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (let pixels = 100; pixels < 3000; pixels += 7) {
      const padded = padToWholeCssPixels(pixels, pixelRatio);
      assert.ok(padded - pixels <= MAX_PAD);
      assert.equal(cssPixels(padded, pixelRatio), Math.round(padded / pixelRatio));
    }
  }
  assert.equal(padToWholeCssPixels(1000, Math.PI), 1000);
});
