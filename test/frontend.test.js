import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { encodeCode128 } from '../public/js/symbols.js';
import { normaliseMonthYear, qrVerdict, labelCount } from '../public/js/format.js';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* -- Date entry ----------------------------------------------------------- */

test('every way an operator might type a month is accepted', () => {
  for (const input of ['05/2026', '5/2026', '05/26', '5/26', '052026', '0526', '05-2026', '05.2026', ' 05/2026 ']) {
    assert.equal(normaliseMonthYear(input), '05/2026', input);
  }
});

test('a two-digit year is read as this century', () => {
  assert.equal(normaliseMonthYear('12/28'), '12/2028');
});

test('an impossible month is left alone rather than reinterpreted', () => {
  // The server prints it as entered and warns. Silently turning 13/2026 into
  // something plausible would put a date nobody chose onto a drum.
  assert.equal(normaliseMonthYear('13/2026'), '13/2026');
  assert.equal(normaliseMonthYear('00/2026'), '00/2026');
  assert.equal(normaliseMonthYear('May 2026'), 'May 2026');
  assert.equal(normaliseMonthYear('nonsense'), 'nonsense');
});

test('an empty field stays empty', () => {
  assert.equal(normaliseMonthYear(''), '');
  assert.equal(normaliseMonthYear('   '), '');
  assert.equal(normaliseMonthYear(null), '');
});

/* -- QR verdict ----------------------------------------------------------- */

test('the QR indicator turns on the three dot floor', () => {
  assert.equal(qrVerdict({ magnification: 4 }).level, 'good');
  assert.equal(qrVerdict({ magnification: 3 }).level, 'tight');
  assert.equal(qrVerdict({ magnification: 2 }).level, 'bad');
  assert.equal(qrVerdict(null).level, 'bad');
  assert.match(qrVerdict({ magnification: 3 }).label, /minimum for a reliable scan/);
});

test('label counts read as English', () => {
  assert.equal(labelCount(1), '1 label');
  assert.equal(labelCount(400), '400 labels');
});

/* -- Code 128 ------------------------------------------------------------- */

test('the batch code encodes to the same modules as a reference encoder', () => {
  // Verified against python-barcode's Code128 for the same input.
  const result = encodeCode128('JUR260725');
  assert.equal(result.modules, 112);
  assert.equal(result.bits.slice(0, 40), '1101001000010110111000110111011101100010');
  assert.deepEqual(result.values, [104, 42, 53, 50, 99, 26, 7, 25, 12]);
});

test('the checksum is the weighted sum the specification defines', () => {
  const { values } = encodeCode128('ABC');
  const payload = values.slice(0, -1);
  const expected = payload.reduce((sum, value, i) => sum + (i === 0 ? value : i * value), 0) % 103;
  assert.equal(values[values.length - 1], expected);
});

test('a run of digits switches to subset C, which is what the printer does', () => {
  const short = encodeCode128('AB12');
  const long = encodeCode128('AB123456');
  // Four digits in subset C occupy two symbols rather than four, so eight
  // digits cost only four more modules than four do, not forty-four.
  assert.equal(long.modules - short.modules, 22);
});

test('an odd digit run drops back to subset B for its last digit', () => {
  const result = encodeCode128('A12345');
  assert.ok(result.values.includes(99), 'switched into C');
  assert.ok(result.values.includes(100), 'and back out for the odd digit');
});

test('bars and spaces alternate from a bar, as a scanner expects', () => {
  const { bits } = encodeCode128('JUR260725');
  assert.equal(bits[0], '1', 'starts with a bar');
  assert.equal(bits.slice(-2), '11', 'ends with the two-module terminator');
});

test('a character subset B cannot carry is refused, not mangled', () => {
  assert.throws(() => encodeCode128('café'), RangeError);
});

/* -- No reimplementation -------------------------------------------------- */

test('the canvas renderer imports the shared layout, not a copy of it', () => {
  // This is the property that keeps preview and print identical. If someone
  // ever reimplements placement in the browser, this fails.
  const canvas = source('public/js/render-canvas.js');
  assert.match(canvas, /import \{ layout \} from '\/src\/render\/layout\.js'/);
  assert.match(canvas, /from '\/src\/render\/symbology\.js'/);
  assert.ok(!/function fitHeight|function measure\b|function centreY/.test(canvas),
    'no local copy of the metrics logic');
  assert.ok(!/const ADVANCE|EM_PER_DOT_HEIGHT\s*=/.test(canvas),
    'no local copy of the width table');
});

test('the modules the browser imports stay free of Node built-ins', () => {
  // layout.js and everything it pulls in are served to the browser. A single
  // `node:` import anywhere in that chain breaks the preview at run time, and
  // would only be noticed by opening the page.
  const chain = [
    'src/render/layout.js',
    'src/render/metrics.js',
    'src/render/symbology.js',
    'src/template/schema.js',
    'src/template/bind.js',
    'src/model/types.js',
    'src/errors.js',
  ];
  for (const path of chain) {
    assert.ok(!/from 'node:/.test(source(path)), `${path} imports a Node built-in`);
  }
});

test('the frontend carries no build step and no framework', () => {
  const files = readdirSync(new URL('../public/js', import.meta.url), { recursive: true })
    .filter((name) => String(name).endsWith('.js'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const text = source(`public/js/${name}`);
    assert.ok(!/from ['"][a-z@]/.test(text), `${name} imports a bare package specifier`);
    assert.ok(!/require\(/.test(text), `${name} uses CommonJS`);
  }
});

/* -- The browser module graph --------------------------------------------- */

test('every module the browser imports is actually served', async () => {
  // A missing file or a bare package specifier would leave a blank page with
  // one line in the console, which is not a failure mode anyone should find in
  // a warehouse. Walking the graph over HTTP catches it here instead.
  const request = (await import('supertest')).default;
  const { buildApp } = await import('./fixtures/app.js');
  const { app } = buildApp();

  const seen = new Set();
  const queue = ['/js/app.js'];
  const failures = [];

  while (queue.length > 0) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);

    const response = await request(app).get(path);
    if (response.status !== 200) { failures.push(`${path} -> ${response.status}`); continue; }

    for (const match of response.text.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1];
      if (specifier.startsWith('/')) queue.push(specifier);
      else if (specifier.startsWith('.')) queue.push(new URL(specifier, `http://x${path}`).pathname);
      else failures.push(`${path} imports the bare specifier "${specifier}"`);
    }
  }

  assert.deepEqual(failures, []);
  assert.ok(seen.has('/src/render/layout.js'), 'the shared layout engine is reachable');
  assert.ok(seen.has('/src/render/metrics.js'), 'and so are its metrics');
  assert.ok(seen.size >= 18, `expected the whole graph, walked ${seen.size}`);
});

test('the source served to the browser is limited to modules', async () => {
  const request = (await import('supertest')).default;
  const { buildApp } = await import('./fixtures/app.js');
  const { app } = buildApp();
  await request(app).get('/src/render/layout.js').expect(200);
  await request(app).get('/src/template/label-4x1.json').expect(404);
  await request(app).get('/src/config.js').expect(200);
});
