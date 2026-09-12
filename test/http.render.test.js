import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, pdf } from './fixtures/app.js';

async function readyJob(harness = buildApp()) {
  const created = await request(harness.app)
    .post('/api/jobs')
    .attach('documents', pdf('picklist'), 'a.pdf')
    .attach('documents', pdf('sampleNote'), 'b.pdf')
    .expect(201);
  const { id } = created.body;

  await request(harness.app).patch(`/api/jobs/${id}`)
    .send({ manufacturer: 'Miscellaneous Supplier' }).expect(200);
  await request(harness.app).patch(`/api/jobs/${id}`)
    .send({ qrUrl: 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC' }).expect(200);
  await request(harness.app).patch(`/api/jobs/${id}/lines/1`)
    .send({ batchCode: 'JUR260725', mnfDate: '05/2026', expDate: '05/2028' }).expect(200);

  return { harness, id };
}

/* -- Short links ---------------------------------------------------------- */

test('pressing Proceed mints a short code and reports the symbol plan', async () => {
  const harness = buildApp();
  const response = await request(harness.app)
    .post('/api/shortlinks')
    .send({ url: 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC' })
    .expect(201);

  assert.match(response.body.code, /^[A-Z2-9]{6}$/);
  assert.equal(response.body.qrPayload, `HTTPS://X.GD/${response.body.code}`);
  assert.equal(response.body.plan.mode, 'alphanumeric');
  assert.equal(response.body.plan.ecc, 'Q');
  assert.ok(response.body.plan.magnification >= 3,
    'the operator is told it will scan before anything prints');
});

test('re-pasting the same link returns the existing code, not a second one', async () => {
  const harness = buildApp();
  const url = 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC';
  const first = await request(harness.app).post('/api/shortlinks').send({ url }).expect(201);
  const second = await request(harness.app).post('/api/shortlinks').send({ url }).expect(200);
  assert.equal(second.body.code, first.body.code);
  assert.equal(second.body.reused, true);
});

test('a link that is not a URL is refused before anything is called', async () => {
  const harness = buildApp();
  await request(harness.app).post('/api/shortlinks').send({}).expect(400);
  await request(harness.app).post('/api/shortlinks').send({ url: 'not a url' }).expect(502);
});

test('an x.gd rate limit says plainly that nothing was printed', async () => {
  const harness = buildApp({ xgd: async () => ({ json: async () => ({ status: 429 }) }) });
  const response = await request(harness.app)
    .post('/api/shortlinks').send({ url: 'https://forms.clickup.com/x' }).expect(502);
  assert.equal(response.body.error.code, 'SHORTLINK_FAILED');
  assert.match(response.body.error.message, /no labels have been printed/);
});

test('setting the ClickUp link on a job stores the target and the short code', async () => {
  const { harness, id } = await readyJob();
  const job = await request(harness.app).get(`/api/jobs/${id}`).expect(200);
  assert.match(job.body.qrUrl.value, /^https:\/\/forms\.clickup\.com/);
  assert.equal(job.body.qrUrl.provenance, 'manual');
  assert.match(job.body.qrShortCode.value, /^[A-Z2-9]{6}$/);
  assert.equal(job.body.qrShortCode.provenance, 'derived');
  assert.equal(job.body.qrPayload.value, `HTTPS://X.GD/${job.body.qrShortCode.value}`);
  assert.ok(job.body.qrPlan.magnification >= 3, 'the plan travels with the job');
});

test('the QR reaches the label once the link is set, and is absent before', async () => {
  const harness = buildApp();
  const created = await request(harness.app)
    .post('/api/jobs').attach('documents', pdf('picklist'), 'a.pdf').expect(201);
  const { id } = created.body;
  await request(harness.app).patch(`/api/jobs/${id}/lines/1`)
    .send({ batchCode: 'B1', mnfDate: '05/2026', expDate: '05/2028' }).expect(200);

  const before = await request(harness.app).post(`/api/jobs/${id}/lines/1/preview`).expect(200);
  assert.ok(!before.body.zpl.includes('^BQN'), 'no QR slot without a link');
  assert.ok(before.body.warnings.some((w) => w.code === 'SLOT_DROPPED' && w.slotId === 'qr'));

  await request(harness.app).patch(`/api/jobs/${id}`)
    .send({ qrUrl: 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC' }).expect(200);

  const after = await request(harness.app).post(`/api/jobs/${id}/lines/1/preview`).expect(200);
  assert.match(after.body.zpl, /\^BQN,2,3\^FH_\^FDQA,HTTPS:\/\/X\.GD\/[A-Z2-9]{6}/);
  assert.ok(!after.body.warnings.some((w) => w.slotId === 'qr'));
});

/* -- Redirect ------------------------------------------------------------- */

test('an archived code redirects to its target, in either case', async () => {
  const harness = buildApp();
  const minted = await request(harness.app)
    .post('/api/shortlinks')
    .send({ url: 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC' })
    .expect(201);

  for (const code of [minted.body.code, minted.body.code.toLowerCase()]) {
    const response = await request(harness.app).get(`/j/${code}`).expect(302);
    assert.match(response.headers.location, /^https:\/\/forms\.clickup\.com/);
  }
});

test('an unknown code 404s in the same envelope as every other error', async () => {
  const response = await request(buildApp().app).get('/j/NOPE99').expect(404);
  assert.equal(response.body.error.code, 'SHORTLINK_NOT_FOUND');
  assert.ok(response.body.error.requestId);
});

/* -- Preview -------------------------------------------------------------- */

test('preview returns ZPL and the guard warnings for one line', async () => {
  const { harness, id } = await readyJob();
  const response = await request(harness.app)
    .post(`/api/jobs/${id}/lines/1/preview`).expect(200);

  assert.ok(response.body.zpl.startsWith('^XA'));
  assert.ok(response.body.zpl.includes('FW-777-Hybrid White'));
  assert.ok(response.body.zpl.includes('QTY :- 0.30KG'));
  assert.ok(response.body.zpl.includes('MANUFACTURER - Miscellaneous Supplier'));
  assert.ok(response.body.zpl.includes('JUR260725'));
  assert.deepEqual(response.body.warnings, []);
  assert.equal(response.body.dpi, 203);
});

test('an incomplete line still previews, so the operator can see it forming', async () => {
  const { harness, id } = await readyJob();
  const response = await request(harness.app)
    .post(`/api/jobs/${id}/lines/2/preview`).expect(200);
  assert.ok(response.body.zpl.includes('FC-777 Hybrid Clear'));
  // The absent batch code drops its slot rather than printing an empty barcode.
  assert.ok(response.body.warnings.some((w) => w.code === 'SLOT_DROPPED'));
});

test('preview honours the resolution and refuses anything else', async () => {
  const { harness, id } = await readyJob();
  const at300 = await request(harness.app)
    .post(`/api/jobs/${id}/lines/1/preview?dpi=300`).expect(200);
  assert.match(at300.body.zpl, /\^PW1200/);

  const bad = await request(harness.app)
    .post(`/api/jobs/${id}/lines/1/preview?dpi=204`).expect(400);
  assert.match(bad.body.error.message, /203, 300 or 600/);
});

/* -- ZPL download --------------------------------------------------------- */

test('the download concatenates the selected lines with their copy counts', async () => {
  const { harness, id } = await readyJob();
  await request(harness.app).patch(`/api/jobs/${id}/lines/1`).send({ copies: 3 }).expect(200);

  const response = await request(harness.app)
    .get(`/api/jobs/${id}/zpl?lines=1`)
    .buffer()
    .expect(200);
  assert.equal(response.headers['content-type'], 'application/octet-stream',
    'a download, not a document with a charset');
  assert.match(response.headers['content-disposition'], new RegExp(`${id}\\.zpl`));
  assert.match(response.body.toString('utf8'), /\^PQ3/);
});

test('printing a line that is not ready is refused, naming the line', async () => {
  const { harness, id } = await readyJob();
  const response = await request(harness.app)
    .get(`/api/jobs/${id}/zpl?lines=1,2`).expect(409);
  assert.equal(response.body.error.code, 'JOB_NOT_READY');
  assert.match(response.body.error.message, /Line 2 still needs/);
});

test('with no selection, every ready line is included', async () => {
  const { harness, id } = await readyJob();
  const response = await request(harness.app).get(`/api/jobs/${id}/zpl`).buffer().expect(200);
  assert.equal(response.body.toString('utf8').match(/\^XA/g).length, 1, 'only line 1 is ready');
});

test('a job with nothing ready says so rather than sending an empty file', async () => {
  const harness = buildApp();
  const created = await request(harness.app)
    .post('/api/jobs').attach('documents', pdf('picklist'), 'a.pdf').expect(201);
  const response = await request(harness.app)
    .get(`/api/jobs/${created.body.id}/zpl`).expect(409);
  assert.match(response.body.error.message, /No line on this job is ready/);
});

/* -- Template ------------------------------------------------------------- */

test('the template is served resolved to the requested resolution', async () => {
  const harness = buildApp();
  const at203 = await request(harness.app).get('/api/template').expect(200);
  assert.equal(at203.body.dpi, 203);
  assert.equal(at203.body.slots.find((s) => s.id === 'name').size, 38);

  const at600 = await request(harness.app).get('/api/template?dpi=600').expect(200);
  assert.equal(at600.body.dpi, 600);
  assert.equal(at600.body.slots.find((s) => s.id === 'name').size, 112);
});

test('an unsupported resolution is refused', async () => {
  await request(buildApp().app).get('/api/template?dpi=150').expect(400);
});
