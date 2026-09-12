import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, pdf } from './fixtures/app.js';
import { sniff, validateUploads, UploadRejectedError } from '../src/http/middleware/uploads.js';
import { createJobStore } from '../src/store/jobStore.js';
import { createMemoryFileStore } from '../src/store/files.js';
import { createPopplerProbe, createPrinterProbe } from '../src/http/probes.js';
import { AppError } from '../src/errors.js';

/* -- Request identity and logging ----------------------------------------- */

test('every response carries a request id, and a supplied one is honoured', async () => {
  const harness = buildApp();
  const generated = await request(harness.app).get('/api/health').expect(200);
  assert.match(generated.headers['x-request-id'], /^req_/);

  const supplied = await request(harness.app)
    .get('/api/health').set('x-request-id', 'req_from-hub').expect(200);
  assert.equal(supplied.headers['x-request-id'], 'req_from-hub');
});

test('an error response carries the same id as the header', async () => {
  const harness = buildApp();
  const response = await request(harness.app).get('/api/jobs/nope').expect(404);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
});

test('logs describe uploads without recording their contents', async () => {
  const harness = buildApp();
  await request(harness.app)
    .post('/api/jobs').attach('documents', pdf('picklist'), 'secret-customer.pdf').expect(201);

  const entry = harness.logs.find((log) => log.event === 'http.request');
  assert.equal(entry.uploads.length, 1);
  assert.deepEqual(Object.keys(entry.uploads[0]).sort(), ['bytes', 'mimetype']);

  const serialised = JSON.stringify(harness.logs);
  assert.ok(!serialised.includes('Jay Jay Mills'), 'no extracted customer name');
  assert.ok(!serialised.includes('PL-76120'), 'no document numbers');
  assert.ok(!serialised.includes('secret-customer'), 'not even the filename');
});

/* -- Upload validation ---------------------------------------------------- */

test('magic bytes identify a file, whatever it is called', () => {
  assert.equal(sniff(Buffer.from('%PDF-1.7\n'))?.mime, 'application/pdf');
  assert.equal(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime, 'image/png');
  assert.equal(sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8)]))?.mime, 'image/jpeg');
  assert.equal(sniff(Buffer.from('just some text here')), null);
  assert.equal(sniff(Buffer.from('%PD')), null, 'too short to judge');
});

test('a declared mimetype is ignored in favour of the bytes', () => {
  assert.throws(
    () => validateUploads([{
      buffer: Buffer.from('not really a pdf at all'),
      originalname: 'invoice.pdf',
      mimetype: 'application/pdf',
      size: 23,
    }]),
    UploadRejectedError,
  );
});

test('an empty upload list explains what to attach', () => {
  assert.throws(() => validateUploads([]), /No documents were uploaded/);
  assert.throws(() => validateUploads(undefined), UploadRejectedError);
});

/* -- Error envelope ------------------------------------------------------- */

test('an unrouted path answers in the standard envelope', async () => {
  const response = await request(buildApp().app).get('/api/nowhere').expect(404);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  assert.ok(response.body.error.requestId);
});

test('an unexpected failure is reduced to a generic message and logged whole', async () => {
  const harness = buildApp({
    poppler: async () => { throw new TypeError('deref of undefined at line 42'); },
  });
  // The probe wrapper catches its own failures, so force one further in.
  harness.jobStore.get = () => { throw new TypeError('internal detail leaked'); };

  const response = await request(harness.app).get('/api/jobs/anything').expect(500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!response.body.error.message.includes('internal detail'),
    'the operator sees nothing about internals');
  assert.match(response.body.error.message, /request id/);

  const logged = harness.logs.find((log) => log.event === 'http.error');
  assert.ok(logged.stack, 'but the stack is kept for whoever has to fix it');
});

test('a typed error keeps its own status and message', async () => {
  const response = await request(buildApp().app)
    .post('/api/jobs').attach('documents', Buffer.from('nope'), 'x.pdf').expect(415);
  assert.equal(response.body.error.code, 'UPLOAD_REJECTED');
  assert.ok(AppError.prototype instanceof Error);
});

/* -- Job store ------------------------------------------------------------ */

test('an expired job takes its staged uploads with it', async () => {
  let clock = 1_000_000;
  const fileStore = createMemoryFileStore();
  const store = createJobStore({ fileStore, ttlSeconds: 60, now: () => clock });

  const path = await fileStore.stage(Buffer.from('%PDF'), 'a.pdf');
  store.create({ job: { id: 'j1', lines: [] }, stagedFiles: [path] });
  assert.equal(fileStore.files.size, 1);

  clock += 30_000;
  assert.equal(await store.sweep(), 0, 'not yet');

  clock += 40_000;
  assert.equal(await store.sweep(), 1);
  assert.equal(store.size, 0);
  assert.equal(fileStore.files.size, 0, 'the PDF is gone too');
});

test('reading or editing a job pushes its expiry back', async () => {
  let clock = 1_000_000;
  const store = createJobStore({
    fileStore: createMemoryFileStore(), ttlSeconds: 60, now: () => clock,
  });
  store.create({ job: { id: 'j1', lines: [{ index: 1 }] } });

  clock += 50_000;
  store.get('j1');
  clock += 50_000;
  assert.equal(await store.sweep(), 0, 'an operator still working is not swept out from under');
});

test('a job in the store survives across requests', async () => {
  const harness = buildApp();
  const created = await request(harness.app)
    .post('/api/jobs').attach('documents', pdf('picklist'), 'a.pdf').expect(201);
  await request(harness.app).patch(`/api/jobs/${created.body.id}/lines/1`)
    .send({ batchCode: 'X1' }).expect(200);
  const refetched = await request(harness.app).get(`/api/jobs/${created.body.id}`).expect(200);
  assert.equal(refetched.body.lines[0].batchCode.value, 'X1');
});

test('the store archives a job to disk for a later reprint', async () => {
  const written = new Map();
  const store = createJobStore({
    fileStore: createMemoryFileStore(),
    archiveDir: '/archive',
    io: {
      mkdir: async () => {},
      writeFile: async (path, data) => written.set(path, data),
      readFile: async (path) => {
        if (!written.has(path)) { const e = new Error('x'); e.code = 'ENOENT'; throw e; }
        return written.get(path);
      },
    },
  });
  store.create({ job: { id: 'j1', createdAt: 'x', lines: [{ index: 1, status: 'ready' }] } });

  const path = await store.archive('j1');
  assert.equal(path, '/archive/j1.json');
  const restored = await store.readArchived('j1');
  assert.equal(restored.job.id, 'j1');
  assert.ok(restored.archivedAt);
  assert.equal(await store.readArchived('never-existed'), null);
});

/* -- Health --------------------------------------------------------------- */

test('health reports every dependency and the resolved date order', async () => {
  const response = await request(buildApp().app).get('/api/health').expect(200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.dateOrder, 'MDY');
  assert.deepEqual(Object.keys(response.body.checks).sort(),
    ['jobs', 'poppler', 'printers', 'shortener']);
});

test('missing poppler is unhealthy, because nothing can be read without it', async () => {
  const harness = buildApp({
    poppler: async () => ({ ok: false, detail: 'pdftotext is not available.' }),
  });
  const response = await request(harness.app).get('/api/health').expect(503);
  assert.equal(response.body.status, 'unhealthy');
});

test('an unreachable printer is degraded, not down', async () => {
  // An operator can still prepare a job. Reporting this as unhealthy would
  // train whoever watches the endpoint to ignore it.
  const harness = buildApp({
    printers: async () => ({ ok: false, detail: '0 of 1 reachable', printers: { wh1: false } }),
  });
  const response = await request(harness.app).get('/api/health').expect(200);
  assert.equal(response.body.status, 'degraded');
});

test('health says whether the shortener can mint, and through what', async () => {
  // Reported from the provider in use, not inferred from an env var — health
  // that describes a different system than the one running is worse than none.
  const without = await request(buildApp({ noShortener: true }).app).get('/api/health').expect(200);
  assert.equal(without.body.checks.shortener.provider, 'manual');
  assert.match(without.body.checks.shortener.detail, /STICKER_SHORT_BASE|by hand/);

  const withKey = buildApp({ env: { STICKER_XGD_API_KEY: '0af50e06255c7004f9ad71338f5ad56e' } });
  const response = await request(withKey.app).get('/api/health').expect(200);
  assert.equal(response.body.checks.shortener.provider, 'x.gd');

  const selfHosted = buildApp({ env: { STICKER_SHORT_BASE: 'https://standard-holdings.lk' } });
  const mine = await request(selfHosted.app).get('/api/health').expect(200);
  assert.equal(mine.body.checks.shortener.provider, 'self-hosted');
  assert.match(mine.body.checks.shortener.detail, /standard-holdings\.lk\/J\/<code>/);
});

test('mounted under a prefix, nothing answers at the root but the redirect', async () => {
  // SH-IT_Hub owns /api for its own gate pass endpoints. If the engine also
  // answered there, /api/jobs would reach the wrong service entirely.
  const { app } = buildApp({ env: { STICKER_BASE_PATH: '/stickers' } });

  await request(app).get('/stickers/api/health').expect(200);
  await request(app).get('/api/health').expect(404);
});

test('the redirect is never prefixed, because the label has no room for one', async () => {
  // https://standard-holdings.lk/J/HFH7K2 is 37 characters against a ceiling
  // of 38. A /stickers in front would not fit the QR, so a code printed on a
  // drum has to resolve at the root wherever the rest of the app is mounted.
  const { app, shortLinks } = buildApp({
    env: { STICKER_BASE_PATH: '/stickers', STICKER_SHORT_BASE: 'https://standard-holdings.lk' },
  });
  const { code } = await shortLinks.mint('https://forms.clickup.com/1/f/2/ABC');

  const hit = await request(app).get(`/J/${code}`).expect(302);
  assert.equal(hit.headers.location, 'https://forms.clickup.com/1/f/2/ABC');
});

test('the page carries the mount point the browser needs to find everything else', async () => {
  const prefixed = await request(buildApp({ env: { STICKER_BASE_PATH: '/stickers' } }).app)
    .get('/stickers').expect(200);
  assert.match(prefixed.text, /<meta name="sticker-base" content="\/stickers">/);
  assert.match(prefixed.text, /href="\/stickers\/css\/app\.css"/);
  assert.match(prefixed.text, /"\/src\/": "\/stickers\/src\/"/, 'the import map moves with it');
  assert.ok(!prefixed.text.includes('__BASE__'), 'no placeholder survives into the page');

  // Unmounted, the markup is what it always was.
  const root = await request(buildApp().app).get('/').expect(200);
  assert.match(root.text, /href="\/css\/app\.css"/);
  assert.ok(!root.text.includes('__BASE__'));
});

test('a probe that throws is reported, not propagated as a 500', async () => {
  const harness = buildApp({ poppler: async () => { throw new Error('spawn EACCES'); } });
  const response = await request(harness.app).get('/api/health').expect(503);
  assert.equal(response.body.checks.poppler.ok, false);
  assert.ok(!response.body.checks.poppler.detail.includes('EACCES'));
});

/* -- Probes --------------------------------------------------------------- */

test('the poppler probe reports the version it found', async () => {
  const probe = createPopplerProbe({
    run: async () => ({ stdout: '', stderr: 'pdftotext version 22.02.0\n' }),
  });
  const result = await probe();
  assert.equal(result.ok, true);
  assert.match(result.detail, /22\.02\.0/);
});

test('the poppler probe says what to install when it is absent', async () => {
  const probe = createPopplerProbe({ run: async () => { throw new Error('ENOENT'); } });
  const result = await probe();
  assert.equal(result.ok, false);
  assert.match(result.detail, /poppler-utils/);
});

test('the printer probe counts what answered', async () => {
  const probe = createPrinterProbe({
    printers: { wh1: { host: 'a', port: 9100 }, wh2: { host: 'b', port: 9100 } },
    connect: async (host) => host === 'a',
  });
  const result = await probe();
  assert.equal(result.ok, false);
  assert.equal(result.detail, '1 of 2 reachable');
  assert.deepEqual(result.printers, { wh1: true, wh2: false });
});

test('no printers configured is fine, not a failure', async () => {
  const result = await createPrinterProbe({ printers: {} })();
  assert.equal(result.ok, true);
});
