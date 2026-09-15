import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, EXIT } from '../bin/sticker.js';

const CLI = fileURLToPath(new URL('../bin/sticker.js', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: ROOT }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

/* -- Argument parsing ----------------------------------------------------- */

test('flags parse in both --name value and --name=value forms', () => {
  assert.deepEqual(parseArgs(['job.json', '--line', '3', '--dpi=300', '--knockout']), {
    positional: ['job.json'],
    flags: { line: '3', dpi: '300', knockout: true },
  });
});

test('a flag followed by another flag is a boolean, not a value', () => {
  assert.deepEqual(parseArgs(['--knockout', '--out', 'x.zpl']).flags,
    { knockout: true, out: 'x.zpl' });
});

/* -- Exit codes ----------------------------------------------------------- */

test('the exit codes distinguish what went wrong', async () => {
  // A shell script needs to tell a bad document from a dead printer from its
  // own mistake, without parsing stderr.
  assert.equal((await run([])).code, EXIT.USAGE, 'no command');
  assert.equal((await run(['frobnicate'])).code, EXIT.USAGE, 'unknown command');
  assert.equal((await run(['parse'])).code, EXIT.USAGE, 'missing argument');
  assert.equal((await run(['parse', '/tmp/does-not-exist.pdf'])).code, EXIT.USAGE, 'missing file');
  assert.equal((await run(['--help'])).code, EXIT.OK);
});

test('help lists every command', async () => {
  const { stdout } = await run(['--help']);
  for (const command of ['parse', 'job', 'zpl', 'print', 'validate-template', 'logo']) {
    assert.match(stdout, new RegExp(`sticker ${command}`), command);
  }
});

/* -- validate-template ---------------------------------------------------- */

test('the shipped template validates and reports its sizes', async () => {
  const { code, stdout } = await run(['validate-template', 'src/template/label-4x1.json']);
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /is valid — 11 slots/);
  assert.match(stdout, /203 dpi {2}800x200 dots/);
  assert.match(stdout, /600 dpi {2}2365x591 dots/);
});

test('an invalid template exits 5 and names the problem', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'bad.json');
  await writeFile(path, JSON.stringify({
    id: 'x', widthIn: 4, heightIn: 1, slots: [{ id: 'a', type: 'hologram' }],
  }));
  const { code, stderr } = await run(['validate-template', path]);
  assert.equal(code, EXIT.INVALID);
  assert.match(stderr, /unknown type "hologram"/);
  await rm(dir, { recursive: true, force: true });
});

test('a file that is not JSON is a document failure, not a crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'nope.json');
  await writeFile(path, 'this is not json');
  const { code, stderr } = await run(['validate-template', path]);
  assert.equal(code, EXIT.DOCUMENT);
  assert.match(stderr, /not valid JSON/);
  await rm(dir, { recursive: true, force: true });
});

/* -- zpl ------------------------------------------------------------------ */

test('zpl emits a printable label for one line of a job', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'job.json');
  await writeFile(path, JSON.stringify(sampleJob()));

  const { code, stdout } = await run(['zpl', path, '--line', '1']);
  assert.equal(code, EXIT.OK);
  assert.ok(stdout.startsWith('^XA'));
  assert.ok(stdout.includes('FW-777-Hybrid White'));
  assert.ok(stdout.includes('QTY :- 0.30KG'));
  assert.ok(stdout.includes('JUR260725'));
  await rm(dir, { recursive: true, force: true });
});

test('zpl honours the resolution and rejects anything else', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'job.json');
  await writeFile(path, JSON.stringify(sampleJob()));

  assert.match((await run(['zpl', path, '--line', '1', '--dpi', '600'])).stdout, /\^PW2365/);
  assert.equal((await run(['zpl', path, '--line', '1', '--dpi', '204'])).code, EXIT.BUG);
  await rm(dir, { recursive: true, force: true });
});

test('an unknown line number is a usage error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'job.json');
  await writeFile(path, JSON.stringify(sampleJob()));
  assert.equal((await run(['zpl', path, '--line', '9'])).code, EXIT.USAGE);
  await rm(dir, { recursive: true, force: true });
});

/* -- print ---------------------------------------------------------------- */

test('print refuses without a printer name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'job.json');
  await writeFile(path, JSON.stringify(sampleJob()));
  const { code, stderr } = await run(['print', path]);
  assert.equal(code, EXIT.USAGE);
  assert.match(stderr, /STICKER_PRINTERS/);
  await rm(dir, { recursive: true, force: true });
});

test('print exits 4 when the printer is not configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'job.json');
  await writeFile(path, JSON.stringify(sampleJob()));
  const { code, stderr } = await run(['print', path, '--printer', 'wh1']);
  assert.equal(code, EXIT.PRINT);
  assert.match(stderr, /No printers are configured/);
  await rm(dir, { recursive: true, force: true });
});

/* -- logo ----------------------------------------------------------------- */

test('logo converts a PNG to a ~DG command', async () => {
  const { code, stdout } = await run(['logo', 'assets/logo-solid-144.png', '--size', '144']);
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /^~DGR:LOGO\.GRF,2592,18,\n[0-9A-F]+\n$/);
});

test('the converter reproduces the shipped asset exactly', async () => {
  // The asset was generated by an independent tool. If this ever diverges,
  // regenerating the logo would silently change what prints.
  const { stdout } = await run(['logo', 'assets/logo-solid-144.png', '--size', '144']);
  const shipped = await readFile(new URL('../assets/logo-store.zpl', import.meta.url), 'utf8');
  const mine = stdout.split('\n')[1];
  const theirs = shipped.split('~DGR:LOGO.GRF,2592,18,')[1].split('\n')[1];
  assert.equal(mine, theirs);
});

test('knockout inverts and clears the surround rather than blacking it out', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const solid = join(dir, 'solid.zpl');
  const knockout = join(dir, 'knockout.zpl');
  await run(['logo', 'assets/logo-solid-144.png', '--out', solid]);
  const { stdout } = await run(['logo', 'assets/logo-solid-144.png', '--knockout', '--out', knockout]);

  assert.match(stdout, /R:LOGOKO\.GRF/);
  // A plain inversion would put the white surround at roughly 30% black. The
  // surround is flooded back to white, leaving line art.
  assert.match(stdout, /8\.7% black/);

  const hexOf = async (path) => (await readFile(path, 'utf8')).split('\n')[1];
  const [solidHex, knockoutHex] = await Promise.all([hexOf(solid), hexOf(knockout)]);
  assert.equal(solidHex.length, knockoutHex.length, 'same bitmap dimensions');
  assert.notEqual(solidHex, knockoutHex);
  await rm(dir, { recursive: true, force: true });
});

test('a heavy logo comes with a warning about printhead heat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const { stdout } = await run(['logo', 'assets/logo-solid-144.png', '--out', join(dir, 'o.zpl')]);
  assert.match(stdout, /69\.9% black/);
  assert.match(stdout, /a lot of heat per label/);
  await rm(dir, { recursive: true, force: true });
});

test('a JPEG is refused with the command to convert it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-'));
  const path = join(dir, 'logo.jpg');
  await writeFile(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]));
  const { code, stderr } = await run(['logo', path]);
  assert.equal(code, EXIT.INVALID);
  assert.match(stderr, /That is a JPEG/);
  assert.match(stderr, /magick/);
  await rm(dir, { recursive: true, force: true });
});

test('an out-of-range size is a usage error', async () => {
  assert.equal((await run(['logo', 'assets/logo-solid-144.png', '--size', '4'])).code, EXIT.USAGE);
  assert.equal((await run(['logo', 'assets/logo-solid-144.png', '--size', 'big'])).code, EXIT.USAGE);
});

/** A job as `sticker job` would have written it. */
function sampleJob() {
  const field = (value, provenance = 'extracted') => ({ value, provenance });
  return {
    job: {
      id: 'job-cli',
      createdAt: '2026-09-06T00:00:00.000Z',
      source: { picklistNo: 'PL-76120', sampleNoteNo: 'RSMINV26091087', salesOrderNo: null },
      customer: field('Jay Jay Mills Lanka (PVT) Ltd'),
      docNo: field('RSMINV26091087'),
      manufacturer: field('Miscellaneous Supplier', 'manual'),
      qrUrl: { value: null, provenance: 'missing' },
      qrShortCode: { value: null, provenance: 'missing' },
      lines: [{
        index: 1,
        displayName: field('FW-777-Hybrid White'),
        qtyAmount: field('0.30'),
        qtyUom: field('kg'),
        mnfDate: field('05/2026', 'manual'),
        expDate: field('05/2028', 'manual'),
        batchCode: field('JUR260725', 'manual'),
        copies: 1,
        status: 'ready',
      }],
    },
  };
}

/* -- printers and status -------------------------------------------------- */

test('printers refuses when none are configured, and says what to set', async () => {
  const { code, stderr } = await run(['printers']);
  assert.equal(code, EXIT.USAGE);
  assert.match(stderr, /STICKER_PRINTERS=name=host:port,dpi/);
});

test('an unreachable printer exits 4 and points at the network, not the printer', async () => {
  // The usual cause on a fresh deployment is that the machine cannot route to
  // the factory LAN at all, which no amount of printer fiddling will fix.
  const { code, stdout } = await runWith(
    { STICKER_PRINTERS: 'wh1=127.0.0.1:9,203' }, ['printers'],
  );
  assert.equal(code, EXIT.PRINT);
  assert.match(stdout, /DOWN {2}wh1/);
  assert.match(stdout, /same network as the printer/);
});

test('status needs a printer name', async () => {
  const { code, stderr } = await runWith({ STICKER_PRINTERS: 'wh1=127.0.0.1:9,203' }, ['status']);
  assert.equal(code, EXIT.USAGE);
  assert.match(stderr, /sticker printers/);
});

test('printers speaks JSON for scripting', async () => {
  const { stdout } = await runWith(
    { STICKER_PRINTERS: 'wh1=127.0.0.1:9,203' }, ['printers', '--json'],
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.printers.wh1.port, 9);
  assert.equal(parsed.reachable.wh1, false);
});

/**
 * @param {Record<string, string>} env
 * @param {string[]} args
 */
function runWith(env, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env } },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
}
