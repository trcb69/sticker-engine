import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from '../src/template/schema.js';
import { emit, escapeFieldData, emitGraphicStore } from '../src/render/zpl.js';
import { field } from '../src/model/types.js';
import { referenceContext, contextWith, longNameContext } from './fixtures/context.js';

const raw = JSON.parse(readFileSync(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'));
const golden = readFileSync(new URL('./fixtures/golden-4x1-203.zpl', import.meta.url), 'utf8');
const render = (context, options) => emit(resolve(raw, options?.dpi ?? 203), context, options).zpl;

test('the reference label reproduces the golden fixture byte for byte', () => {
  assert.equal(render(referenceContext), golden);
});

test('the label opens and closes correctly and declares its size', () => {
  const zpl = render(referenceContext);
  assert.ok(zpl.startsWith('^XA\n'));
  assert.ok(zpl.trimEnd().endsWith('^XZ'));
  assert.match(zpl, /\^PW812\n/);
  assert.match(zpl, /\^LL203\n/);
  assert.match(zpl, /\^CI28\n/, 'UTF-8 so accented item names survive');
});

test('print settings come from the template, not hard-coded', () => {
  const zpl = render(referenceContext);
  assert.match(zpl, /\^MD10\n/);
  assert.match(zpl, /\^PR4\n/);
  assert.match(zpl, /\^MNY\n/, 'gap-sensed media');

  const markStock = JSON.parse(JSON.stringify(raw));
  markStock.print.mediaTracking = 'mark';
  markStock.print.darkness = 18;
  const marked = emit(resolve(markStock, 203), referenceContext).zpl;
  assert.match(marked, /\^MNM\n/);
  assert.match(marked, /\^MD18\n/);
});

test('copies are carried by ^PQ and never fall below one', () => {
  assert.match(render(referenceContext, { copies: 12 }), /\^PQ12\n/);
  assert.match(render(referenceContext, { copies: 0 }), /\^PQ1\n/);
  assert.match(render(referenceContext, { copies: -5 }), /\^PQ1\n/);
});

test('the barcode is native ZPL with its text below the bars', () => {
  const zpl = render(referenceContext);
  assert.match(zpl, /\^BY2,3,48\n/, 'module width, ratio, height');
  assert.match(zpl, /\^BCN,48,Y,N,N/, 'HRI on, and not above the bars');
  assert.ok(!zpl.includes('^GFA'), 'no rasterised symbol anywhere');
});

test('the barcode data is encoded exactly as entered', () => {
  // A code containing the letter O rather than a zero is the operator error
  // the UI warns about. The emitter must still print what was typed: silently
  // correcting it would produce a barcode scanning as a batch nobody entered.
  const typo = render(contextWith({ batchCode: field('JUR26O725', 'manual') }));
  assert.ok(typo.includes('JUR26O725'));
  assert.ok(!typo.includes('JUR260725'));
});

test('the QR is native ZPL carrying its error-correction prefix', () => {
  const zpl = render(referenceContext);
  assert.match(zpl, /\^BQN,2,3\^FH_\^FDMA,HTTPS:\/\/X\.GD\/HFH7K2\^FS/);
});

test('bold is a double strike one dot apart, since ^A0 has no bold weight', () => {
  const strikes = render(referenceContext)
    .split('\n')
    .filter((line) => line.includes('Win-Poly Blue 7007'));
  assert.equal(strikes.length, 2);
  const xs = strikes.map((line) => Number(line.match(/\^FO(\d+),/)[1]));
  assert.equal(xs[1] - xs[0], 1);
});

test('reversed text is marked ^FR and its bar is emitted first', () => {
  const lines = render(referenceContext).split('\n');
  const barIndex = lines.findIndex((l) => l.startsWith('^FO166,64^GB512,54,54'));
  const textIndex = lines.findIndex((l) => l.includes('^FR') && l.includes('Win-Poly'));
  assert.ok(barIndex !== -1 && textIndex !== -1);
  assert.ok(barIndex < textIndex, 'the filled bar must exist before ^FR reverses over it');
});

test('a filled box uses a border equal to its height; an outline does not', () => {
  const zpl = render(referenceContext);
  assert.match(zpl, /\^GB512,54,54\^FS/, 'filled');
  assert.match(zpl, /\^GB804,195,3\^FS/, 'outline');
});

test('command characters in data are hex-escaped, not left to inject', () => {
  assert.equal(escapeFieldData('A^B'), 'A_5EB');
  assert.equal(escapeFieldData('A~B'), 'A_7EB');
  assert.equal(escapeFieldData('A\\B'), 'A_5CB');
  assert.equal(escapeFieldData('A_B'), 'A_5FB', 'the escape character escapes itself');
  assert.equal(escapeFieldData('Win-Poly Blue 7007'), 'Win-Poly Blue 7007');

  const hostile = render(contextWith({ displayName: field('Resin ^XZ~JA', 'extracted') }));
  assert.ok(!hostile.includes('Resin ^XZ'), 'the injected commands are neutralised');
  assert.ok(hostile.includes('Resin _5EXZ_7EJA'));
  assert.equal(hostile.trimEnd().endsWith('^XZ'), true, 'the label still terminates properly');
});

test('300 and 600 dpi emit a correctly scaled label from the same template', () => {
  const at300 = render(referenceContext, { dpi: 300 });
  assert.match(at300, /\^PW1200\n/);
  assert.match(at300, /\^LL300\n/);

  const at600 = render(referenceContext, { dpi: 600 });
  assert.match(at600, /\^PW2400\n/);
  assert.match(at600, /\^LL600\n/);
});

test('a shrunk product name emits at its shrunk size, still reversed', () => {
  const zpl = render(longNameContext);
  const line = zpl.split('\n').find((l) => l.includes('FW-777-Hybrid'));
  const size = Number(line.match(/\^A0N,(\d+),/)[1]);
  assert.ok(size < 38 && size >= 18);
  assert.ok(line.includes('^FR'));
});

test('the logo is recalled from printer memory, not resent per label', () => {
  const zpl = render(referenceContext);
  assert.match(zpl, /\^FO14,50\^XGR:LOGO\.GRF,1,1\^FS/);
  assert.ok(!zpl.includes('~DG'), 'the bitmap is stored once, elsewhere');
});

test('emitGraphicStore produces the one-time download command', () => {
  const stored = emitGraphicStore('R:LOGO.GRF', { bytes: 2592, bytesPerRow: 18, hex: 'FFAA' });
  assert.equal(stored, '~DGR:LOGO.GRF,2592,18,\nFFAA\n');
});
