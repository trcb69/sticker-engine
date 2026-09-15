import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from '../src/template/schema.js';
import { emit, escapeFieldData, emitGraphicStore } from '../src/render/zpl.js';
import { decodePng } from '../src/logo.js';
import { field, missing } from '../src/model/types.js';
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
  assert.match(zpl, /\^PW800\n/);
  assert.match(zpl, /\^LL200\n/);
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
  assert.match(zpl, /\^BY2,3,40\n/, 'module width, ratio, height');
  assert.match(zpl, /\^BCN,40,Y,N,N/, 'HRI on, and not above the bars');
  const rasters = zpl.split('\n').filter((line) => line.includes('^GF'));
  assert.equal(rasters.length, 1, 'the logo is the only bitmap; symbols stay native');
  assert.ok(rasters[0].startsWith('^FO14,28^GFA,'));
});

test('the barcode starts after its quiet zone, as the preview draws it', () => {
  const { zpl, placed } = emit(resolve(raw, 203), referenceContext);
  const batch = placed.elements.find((el) => el.id === 'batch');
  assert.equal(batch.plan.moduleWidth, 2);
  assert.match(zpl, new RegExp(`\\^FO${batch.x + batch.plan.quietZone},${batch.y}\\^BCN`));
  assert.ok(batch.x + 2 * batch.plan.quietZone + batch.plan.barWidth <= batch.x + batch.w);
  assert.ok(batch.x + batch.w <= placed.width - placed.quietZone);
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

test('reversed text is struck in black, then its bar reverses over it', () => {
  // ^FR flips every dot a field covers. Two reversed strikes one dot apart
  // flip each other back and leave hollow outlines, which is what a GC420t
  // printed on 2026-09-14. Striking the text black and reversing the bar over
  // it inverts the bold union instead: solid white glyphs on a black bar.
  const lines = render(referenceContext).split('\n');
  for (const [text, strikes, bar] of [
    ['Win-Poly Blue 7007', ['^FO175,72^A0N,38,38', '^FO176,72^A0N,38,38'], '^FO166,67^FR^GB510,48,48^FS'],
    ['QTY :- 310ML', ['^FO175,128^A0N,22,22', '^FO176,128^A0N,22,22'], '^FO166,119^FR^GB156,40,40^FS'],
  ]) {
    const first = lines.findIndex((l) => l.includes(text));
    assert.ok(first !== -1, `${text} is emitted`);
    assert.ok(lines[first].startsWith(strikes[0]), `${text}: first strike, no ^FR`);
    assert.ok(lines[first + 1].startsWith(strikes[1]), `${text}: second strike, no ^FR`);
    assert.ok(lines[first + 1].includes(text));
    assert.equal(lines[first + 2], bar, `${text}: the bar follows, reversed`);
  }
  assert.ok(!lines.includes('^FO166,67^GB510,48,48^FS'), 'the bar is not also emitted unreversed');
});

test('^FR appears only on the two bars, never on text', () => {
  const lines = render(referenceContext).split('\n');
  const reversed = lines.filter((l) => l.includes('^FR'));
  assert.equal(reversed.length, 2);
  assert.ok(reversed.every((l) => l.includes('^GB')));
  assert.ok(!lines.some((l) => l.includes('^A0') && l.includes('^FR')));
});

test('ordinary bold text and the border are untouched', () => {
  const lines = render(referenceContext).split('\n');
  for (const text of ['MANUFACTURER - Miscellaneous Supplier', 'MNF :- 05/2026', 'EXP  :- 05/2028']) {
    const strikes = lines.filter((l) => l.includes(text));
    assert.equal(strikes.length, 2, `${text} is a double strike`);
    assert.ok(strikes.every((l) => !l.includes('^FR')));
  }
  const body = lines.filter((l) => l.startsWith('^FO'));
  assert.equal(body.at(-1), '^FO12,12^GB775,176,2^FS', 'the border is still the last field, inside the margin');
});

test('a bar whose caption is absent prints plain; a bar sized to it is dropped', () => {
  const noName = render(contextWith({ displayName: missing('not extracted') })).split('\n');
  const bar = noName.indexOf('^FO166,67^GB510,48,48^FS');
  assert.ok(bar !== -1, 'the name bar still prints, unreversed');
  assert.ok(noName[bar - 1].includes('MANUFACTURER - Miscellaneous Supplier'), 'at its own position');
  assert.equal(noName.filter((l) => l.includes('^FR')).length, 1, 'only the QTY bar is reversed');

  const noQty = render(contextWith({ qtyText: missing('not extracted') }));
  assert.ok(!noQty.includes('^FO166,119^'), 'no QTY bar, at any width');
  assert.equal(noQty.split('\n').filter((l) => l.includes('^FR')).length, 1, 'only the name bar is reversed');
});

test('nothing else is printed inside a reversed bar, at any density', () => {
  // A reversed bar inverts whatever is already under it. Only its own caption
  // may be there, or a template edit would silently print something white.
  const inkOf = (el) => {
    if (el.kind === 'box' && !el.fill) {
      const t = el.thickness || 1;
      return [
        { x: el.x, y: el.y, w: el.w, h: t },
        { x: el.x, y: el.y + el.h - t, w: el.w, h: t },
        { x: el.x, y: el.y, w: t, h: el.h },
        { x: el.x + el.w - t, y: el.y, w: t, h: el.h },
      ];
    }
    return [{ x: el.x, y: el.y, w: el.w, h: el.h }];
  };
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  for (const dpi of [203, 300, 600]) {
    for (const context of [referenceContext, longNameContext]) {
      const { placed } = emit(resolve(raw, dpi), context);
      const captions = placed.elements.filter((el) => el.kind === 'text' && el.reverse);
      assert.equal(captions.length, 2);
      for (const caption of captions) {
        const bar = placed.elements.find((el) => el.id === caption.box);
        assert.ok(bar?.fill, `${caption.id} sits in a filled bar`);
        for (const other of placed.elements) {
          if (other === bar || other === caption) continue;
          for (const ink of inkOf(other)) {
            assert.ok(!overlaps(ink, bar), `${other.id} overlaps ${bar.id} at ${dpi} dpi`);
          }
        }
      }
    }
  }
});

test('a filled box uses a border equal to its height; an outline does not', () => {
  const zpl = render(referenceContext);
  assert.match(zpl, /\^GB510,48,48\^FS/, 'filled');
  assert.match(zpl, /\^GB775,176,2\^FS/, 'outline');
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
  assert.match(at300, /\^PW1182\n/);
  assert.match(at300, /\^LL296\n/);

  const at600 = render(referenceContext, { dpi: 600 });
  assert.match(at600, /\^PW2365\n/);
  assert.match(at600, /\^LL591\n/);
});

test('a shrunk product name emits at its shrunk size, still reversed by its bar', () => {
  const lines = render(longNameContext).split('\n');
  const first = lines.findIndex((l) => l.includes('FW-777-Hybrid'));
  const size = Number(lines[first].match(/\^A0N,(\d+),/)[1]);
  assert.ok(size < 38 && size >= 18);
  assert.ok(!lines[first].includes('^FR') && !lines[first + 1].includes('^FR'));
  assert.equal(lines[first + 2], '^FO166,67^FR^GB510,48,48^FS');
});

test('the logo travels inside the label, so it cannot print blank', () => {
  // Nothing on the Browser Print path ever stored R:LOGO.GRF, and R: is RAM
  // anyway. An inline ^GFA needs no printer state at all.
  const zpl = render(referenceContext);
  const matches = zpl.match(/\^FO14,28\^GFA,2592,2592,18,([0-9A-F]{5184})\^FS/g) ?? [];
  assert.equal(matches.length, 1);
  assert.ok(!zpl.includes('^XG'), 'no recall from printer memory');
  assert.ok(!zpl.includes('~DG'), 'and nothing stored');
});

test('the logo bits are exactly the bold line-art PNG', () => {
  const hex = render(referenceContext).match(/\^GFA,2592,2592,18,([0-9A-F]+)\^FS/)[1];
  const bytes = Buffer.from(hex, 'hex');
  const bit = (x, y) => (bytes[y * 18 + (x >> 3)] >> (7 - (x & 7))) & 1;

  // Expected bits come straight from the PNG's grey values, not from the
  // converter that produced the hex, so a bit-order or polarity slip shows.
  const png = decodePng(readFileSync(new URL('../assets/logo-lineart-bold-144.png', import.meta.url)));
  assert.deepEqual([png.width, png.height], [144, 144]);
  let black = 0;
  let leftmost = 144;
  for (let y = 0; y < 144; y += 1) {
    for (let x = 0; x < 144; x += 1) {
      const expected = png.grey[y * 144 + x] < 128 ? 1 : 0;
      assert.equal(bit(x, y), expected, `dot ${x},${y}`);
      if (expected) { black += 1; leftmost = Math.min(leftmost, x); }
    }
  }
  const coverage = (100 * black) / (144 * 144);
  assert.ok(coverage > 9.5 && coverage < 9.7, `coverage ${coverage.toFixed(2)}%`);
  assert.ok(14 + leftmost >= 17, 'the ring clears the border line by at least 3 dots');
});

test('emitGraphicStore produces the one-time download command', () => {
  const stored = emitGraphicStore('R:LOGO.GRF', { bytes: 2592, bytesPerRow: 18, hex: 'FFAA' });
  assert.equal(stored, '~DGR:LOGO.GRF,2592,18,\nFFAA\n');
});
