import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, pdf } from './fixtures/app.js';

const browserApp = () => buildApp({ env: { STICKER_PRINT_TRANSPORT: 'browser' } });

async function readyJob(harness, lines = [1]) {
  const created = await request(harness.app)
    .post('/api/jobs')
    .attach('documents', pdf('picklist'), 'a.pdf')
    .attach('documents', pdf('sampleNote'), 'b.pdf')
    .expect(201);
  const { id } = created.body;
  await request(harness.app).patch(`/api/jobs/${id}`)
    .send({ manufacturer: 'Miscellaneous Supplier' }).expect(200);
  for (const index of lines) {
    await request(harness.app).patch(`/api/jobs/${id}/lines/${index}`)
      .send({ batchCode: `JUR26072${index}`, mnfDate: '05/2026', expDate: '05/2028' })
      .expect(200);
  }
  return id;
}

const startPrint = (harness, id, body = {}) => request(harness.app)
  .post(`/api/jobs/${id}/print`)
  .set('x-operator', 'hadhee')
  .send({ printer: 'ZD421-203dpi ZPL', lines: [1], ...body });

/* -- Preparing a run ------------------------------------------------------ */

test('browser transport returns the ZPL instead of sending it', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);
  const response = await startPrint(harness, id).expect(202);

  assert.equal(response.body.run.transport, 'browser');
  assert.equal(response.body.run.status, 'pending');
  assert.ok(response.body.zpl.startsWith('^XA'));
  assert.ok(response.body.zpl.includes('JUR260721'));
  assert.equal(harness.sent.length, 0, 'the server sent nothing itself');
});

test('the ZPL is byte-identical to what the network path would have sent', async () => {
  // This is the property the whole change rests on: the delivery moved, the
  // label did not.
  const viaBrowser = browserApp();
  const id = await readyJob(viaBrowser);
  const prepared = await startPrint(viaBrowser, id, { lines: [1] }).expect(202);

  const viaNetwork = buildApp();
  const networkId = await readyJob(viaNetwork);
  await request(viaNetwork.app).post(`/api/jobs/${networkId}/print`)
    .send({ printer: 'wh1', lines: [1] }).expect(202);
  const sentToPrinter = viaNetwork.sent.find((entry) => entry.payload.startsWith('^XA'));

  assert.equal(prepared.body.zpl, sentToPrinter.payload);
});

test('copies are in the ZPL handed to the browser', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);
  await request(harness.app).patch(`/api/jobs/${id}/lines/1`).send({ copies: 4 }).expect(200);
  const response = await startPrint(harness, id).expect(202);
  assert.match(response.body.zpl, /\^PQ4/);
  assert.equal(response.body.run.labels, 4);
});

test('a device name is recorded as given, not checked against configuration', async () => {
  // The server cannot see a printer plugged into someone else's desk and has
  // no business having an opinion about its name.
  const harness = browserApp();
  const id = await readyJob(harness);
  const response = await startPrint(harness, id, { printer: 'Zebra on Farhan PC' }).expect(202);
  assert.equal(response.body.run.printer, 'Zebra on Farhan PC');
});

test('readiness and reprint gating still run before anything is handed over', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);

  const notReady = await startPrint(harness, id, { lines: [1, 2] }).expect(409);
  assert.equal(notReady.body.error.code, 'JOB_NOT_READY');

  const first = await startPrint(harness, id).expect(202);
  await request(harness.app).post(`/api/runs/${first.body.run.id}/sent`)
    .send({ ok: true }).expect(200);

  const reprint = await startPrint(harness, id).expect(409);
  assert.equal(reprint.body.error.code, 'REPRINT_REASON_REQUIRED');
});

/* -- The audit trail records events, not intentions ----------------------- */

test('nothing is written to the audit trail until the browser reports back', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);
  await startPrint(harness, id).expect(202);
  assert.deepEqual(harness.auditEntries, [], 'nothing has been printed yet');
});

test('a successful send writes the run and every batch code', async () => {
  const harness = browserApp();
  const id = await readyJob(harness, [1, 2]);
  const run = (await startPrint(harness, id, { lines: [1, 2] }).expect(202)).body.run;

  const settled = await request(harness.app)
    .post(`/api/runs/${run.id}/sent`)
    .send({ ok: true, deviceName: 'ZD421 on bench 3' })
    .expect(200);

  assert.equal(settled.body.run.status, 'printed');
  assert.equal(settled.body.run.printer, 'ZD421 on bench 3');

  const runEntry = harness.auditEntries.find((entry) => entry.event === 'run.printed');
  assert.equal(runEntry.transport, 'browser');
  assert.equal(runEntry.operator, 'hadhee');
  assert.deepEqual(
    harness.auditEntries.filter((e) => e.event === 'label.printed').map((e) => e.batchCode),
    ['JUR260721', 'JUR260722'],
  );
});

test('a failed send records the failure and no batch codes', async () => {
  // A batch code that never reached a printer must not enter the reprint
  // history, or the next genuine print of it would be refused as a duplicate.
  const harness = browserApp();
  const id = await readyJob(harness);
  const run = (await startPrint(harness, id).expect(202)).body.run;

  const settled = await request(harness.app)
    .post(`/api/runs/${run.id}/sent`)
    .send({ ok: false, error: 'Unable to establish connection to ZD421' })
    .expect(200);

  assert.equal(settled.body.run.status, 'failed');
  assert.match(settled.body.run.error.message, /Unable to establish connection/);
  assert.ok(harness.auditEntries.some((entry) => entry.event === 'run.failed'));
  assert.equal(harness.auditEntries.filter((e) => e.event === 'label.printed').length, 0);

  // And the batch is still printable without a reprint reason.
  await startPrint(harness, id).expect(202);
});

test('a replayed confirmation is rejected rather than written twice', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);
  const run = (await startPrint(harness, id).expect(202)).body.run;

  await request(harness.app).post(`/api/runs/${run.id}/sent`).send({ ok: true }).expect(200);
  const replay = await request(harness.app)
    .post(`/api/runs/${run.id}/sent`).send({ ok: true }).expect(409);

  assert.equal(replay.body.error.code, 'RUN_ALREADY_SETTLED');
  assert.equal(harness.auditEntries.filter((e) => e.event === 'run.printed').length, 1);
});

test('confirming an unknown run 404s', async () => {
  const harness = browserApp();
  const response = await request(harness.app)
    .post('/api/runs/run_nope/sent').send({ ok: true }).expect(404);
  assert.equal(response.body.error.code, 'RUN_NOT_FOUND');
});

/* -- Verification is unchanged -------------------------------------------- */

test('scan-back still verifies a browser-delivered run', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);
  const run = (await startPrint(harness, id).expect(202)).body.run;
  await request(harness.app).post(`/api/runs/${run.id}/sent`).send({ ok: true }).expect(200);

  const verified = await request(harness.app)
    .post(`/api/runs/${run.id}/verify`).send({ scanned: 'JUR260721' }).expect(200);
  assert.equal(verified.body.run.status, 'verified');
});

/* -- Transport selection -------------------------------------------------- */

test('the health endpoint tells the browser which transport to use', async () => {
  assert.equal((await request(browserApp().app).get('/api/health')).body.printTransport, 'browser');
  assert.equal((await request(buildApp().app).get('/api/health')).body.printTransport, 'network');
});

test('a request can override the configured transport', async () => {
  const harness = buildApp();          // configured for network
  const id = await readyJob(harness);
  const response = await startPrint(harness, id, { transport: 'browser' }).expect(202);
  assert.equal(response.body.run.transport, 'browser');
  assert.ok(response.body.zpl);
  assert.equal(harness.sent.length, 0);
});

test('an unknown transport is refused', async () => {
  const harness = browserApp();
  const id = await readyJob(harness);
  const response = await startPrint(harness, id, { transport: 'carrier-pigeon' }).expect(400);
  assert.match(response.body.error.message, /"browser" or "network"/);
});

/* -- The interface is served ---------------------------------------------- */

test('the diagnostics page and its module are reachable', async () => {
  const harness = browserApp();
  await request(harness.app).get('/diagnostics.html').expect(200);
  await request(harness.app).get('/js/diagnostics.js').expect(200);
  await request(harness.app).get('/js/browserPrint.js').expect(200);
  await request(harness.app).get('/js/print.js').expect(200);
});
