import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, fitsWithin, fitHeight, truncateToWidth, centreY, SAFETY_MARGIN } from '../src/render/metrics.js';

test('measurement scales linearly with character height', () => {
  const a = measure('HELLO', 20);
  const b = measure('HELLO', 40);
  assert.ok(Math.abs(b - a * 2) <= 2, `${b} should be about twice ${a}`);
});

test('proportional widths differ per character', () => {
  assert.ok(measure('WWW', 22) > measure('iii', 22), 'W is wider than i');
});

test('bold measures wider, because it is double-struck', () => {
  assert.ok(measure('ABC', 22, { bold: true }) > measure('ABC', 22));
});

test('fitsWithin applies the safety margin rather than the raw width', () => {
  const width = measure('ABCDEF', 20);
  assert.equal(fitsWithin('ABCDEF', 20, width), false, 'exactly the measured width is not a fit');
  assert.equal(fitsWithin('ABCDEF', 20, width / SAFETY_MARGIN + 1), true);
});

test('fitHeight never raises above the declared size', () => {
  const result = fitHeight('OK', 38, 18, 10000);
  assert.equal(result.height, 38, 'a short string keeps the house size');
  assert.equal(result.shrunk, false);
  assert.equal(result.overflow, false);
});

test('fitHeight shrinks a long string down toward the floor', () => {
  const result = fitHeight('FW-777-Hybrid White Reactant Compound', 38, 18, 494, { bold: true });
  assert.ok(result.height < 38, 'shrank');
  assert.ok(result.height >= 18, 'did not pass the floor');
  assert.equal(result.shrunk, true);
  assert.equal(result.overflow, false);
});

test('fitHeight reports overflow instead of shrinking past the floor', () => {
  const result = fitHeight('A'.repeat(400), 38, 18, 100);
  assert.equal(result.height, 18);
  assert.equal(result.overflow, true);
});

test('truncateToWidth adds an ellipsis and actually fits', () => {
  const truncated = truncateToWidth('FW-777-Hybrid White Reactant Compound', 38, 200);
  assert.ok(truncated.endsWith('...'));
  assert.ok(truncated.length < 37);
  assert.equal(fitsWithin(truncated, 38, 200), true);
});

test('centreY recomputes with the font height', () => {
  assert.equal(centreY(64, 54, 38), 72);
  assert.equal(centreY(64, 54, 24), 79, 'a smaller font sits lower, still centred');
  assert.equal(centreY(64, 20, 38), 64, 'never pushed above its box');
});
