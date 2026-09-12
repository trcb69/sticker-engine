import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, pdf } from './fixtures/app.js';

async function readyJob(harness = buildApp(), lines = [1]) {
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
  return { harness, id };
}

const printRun = (harness, id, body = {}) => request(harness.app)
  .post(`/api/jobs/${id}/print`)
  .set('x-operator', 'hadhee')
  .send({ printer: 'wh1', lines: [1], ...body });

/* -- Printing ------------------------------------------------------------- */

test('a run sends ZPL to the named printer and returns the run', async () => {
  const { harness, id } = await readyJob();
  const response = await printRun(harness, id).expect(202);

  assert.equal(response.body.run.printer, 'wh1');
  assert.equal(response.body.run.status, 'printed');
  assert.equal(response.body.run.labels, 1);
  assert.equal(response.body.run.operator, 'hadhee');
  assert.equal(response.body.run.verification, null, 'not complete until it is checked');

  const job = harness.sent.find((entry) => entry.payload.startsWith('^XA'));
  assert.ok(job.payload.includes('FW-777-Hybrid White'));
  assert.ok(job.payload.includes('JUR260721'));
});

test('the logo is put on the printer before the first label', async () => {
  const { harness, id } = await readyJob();
  await printRun(harness, id).expect(202);
  assert.match(harness.sent[0].payload, /^~DG/, 'the graphic goes first');
  assert.match(harness.sent[1].payload, /^\^XA/);
});

test('copies are honoured and counted', async () => {
  const { harness, id } = await readyJob();
  await request(harness.app).patch(`/api/jobs/${id}/lines/1`).send({ copies: 5 }).expect(200);
  const response = await printRun(harness, id).expect(202);
  assert.equal(response.body.run.labels, 5);
  assert.match(harness.sent.at(-1).payload, /\^PQ5/);
});

test('printing a line that is not ready is refused before anything is sent', async () => {
  const { harness, id } = await readyJob();
  const response = await printRun(harness, id, { lines: [1, 2] }).expect(409);
  assert.equal(response.body.error.code, 'JOB_NOT_READY');
  assert.equal(harness.sent.length, 0, 'nothing reached the printer');
});

test('an unknown printer names the configured ones', async () => {
  const { harness, id } = await readyJob();
  const response = await printRun(harness, id, { printer: 'nope' }).expect(400);
  assert.equal(response.body.error.code, 'PRINTER_UNKNOWN');
  assert.match(response.body.error.message, /Configured: wh1/);
});

test('a run with no printer named is refused', async () => {
  const { harness, id } = await readyJob();
  const response = await request(harness.app)
    .post(`/api/jobs/${id}/print`).send({ lines: [1] }).expect(400);
  assert.match(response.body.error.message, /which printer/);
});

test('an unreachable printer marks the run failed and says so', async () => {
  const harness = buildApp({
    transport: {
      async send(_p, payload) {
        if (payload.startsWith('^XA')) throw Object.assign(new Error('boom'), { code: 'X' });
      },
      async ask() { return ''; },
    },
  });
  const { id } = await readyJob(harness);
  const response = await printRun(harness, id).expect(500);
  assert.ok(harness.auditEntries.some((entry) => entry.event === 'run.failed'));
});

/* -- Reprints ------------------------------------------------------------- */

test('a batch code printed before needs a reason', async () => {
  // A duplicate batch code in circulation is a traceability event, so it is
  // never allowed to happen silently.
  const { harness, id } = await readyJob();
  await printRun(harness, id).expect(202);

  const second = await printRun(harness, id).expect(409);
  assert.equal(second.body.error.code, 'REPRINT_REASON_REQUIRED');
  assert.match(second.body.error.message, /JUR260721/);
  assert.match(second.body.error.message, /has been printed before/);
});

test('with a reason the reprint proceeds and the reason is recorded', async () => {
  const { harness, id } = await readyJob();
  await printRun(harness, id).expect(202);
  const response = await printRun(harness, id, { reason: 'label smudged on the drum' }).expect(202);

  assert.equal(response.body.run.isReprint, true);
  assert.equal(response.body.run.reason, 'label smudged on the drum');
  const reprint = harness.auditEntries.find((e) => e.event === 'run.printed' && e.reprint);
  assert.equal(reprint.reason, 'label smudged on the drum');
});

/* -- Audit ---------------------------------------------------------------- */

test('the audit log records the run and every batch code in it', async () => {
  const { harness, id } = await readyJob(buildApp(), [1, 2]);
  await printRun(harness, id, { lines: [1, 2] }).expect(202);

  const runEntry = harness.auditEntries.find((entry) => entry.event === 'run.printed');
  assert.equal(runEntry.operator, 'hadhee');
  assert.match(runEntry.printer, /wh1 \(10\.0\.0\.5:9100\)/);
  assert.equal(runEntry.labels, 2);
  assert.equal(runEntry.dpi, 203);

  const labelEntries = harness.auditEntries.filter((entry) => entry.event === 'label.printed');
  assert.deepEqual(labelEntries.map((entry) => entry.batchCode), ['JUR260721', 'JUR260722']);
  assert.ok(labelEntries.every((entry) => entry.at && entry.operator === 'hadhee'));
});

test('an unnamed operator is recorded as unattributed, not as nobody', async () => {
  const { harness, id } = await readyJob();
  await request(harness.app).post(`/api/jobs/${id}/print`).send({ printer: 'wh1', lines: [1] }).expect(202);
  const entry = harness.auditEntries.find((e) => e.event === 'run.printed');
  assert.equal(entry.operator, 'unattributed');
});

/* -- Scan-back verification ----------------------------------------------- */

test('scanning a printed label back verifies the run', async () => {
  const { harness, id } = await readyJob();
  const run = (await printRun(harness, id).expect(202)).body.run;

  const response = await request(harness.app)
    .post(`/api/runs/${run.id}/verify`)
    .set('x-operator', 'hadhee')
    .send({ scanned: 'JUR260721' })
    .expect(200);

  assert.equal(response.body.run.status, 'verified');
  assert.equal(response.body.run.verification.matched, true);
  const entry = harness.auditEntries.find((e) => e.event === 'run.verified');
  assert.equal(entry.verified, true);
  assert.equal(entry.operator, 'hadhee');
});

test('a mismatch blocks the run and shows both codes', async () => {
  // This is the check that catches darkness drift, a dirty printhead element
  // and a stock change — all of which produce labels that look fine.
  const { harness, id } = await readyJob();
  const run = (await printRun(harness, id).expect(202)).body.run;

  const response = await request(harness.app)
    .post(`/api/runs/${run.id}/verify`)
    .send({ scanned: 'JUR260799' })
    .expect(409);

  assert.equal(response.body.error.code, 'VERIFICATION_MISMATCH');
  assert.match(response.body.error.message, /read "JUR260799"/);
  assert.match(response.body.error.message, /"JUR260721"/);
  assert.match(response.body.error.message, /Do not release these labels/);

  const after = await request(harness.app).get(`/api/runs/${run.id}`).expect(200);
  assert.equal(after.body.run.status, 'mismatch', 'the run is not complete');
});

test('a case-only difference is diagnosed as a wrong label, not a bad scanner', async () => {
  const { harness, id } = await readyJob();
  const run = (await printRun(harness, id).expect(202)).body.run;
  const response = await request(harness.app)
    .post(`/api/runs/${run.id}/verify`).send({ scanned: 'jur260721' }).expect(409);
  assert.match(response.body.error.message, /only in case/);
  assert.match(response.body.error.message, /the label is wrong, not the scanner/);
});

test('a failed verification is still recorded', async () => {
  const { harness, id } = await readyJob();
  const run = (await printRun(harness, id).expect(202)).body.run;
  await request(harness.app).post(`/api/runs/${run.id}/verify`).send({ scanned: 'WRONG' }).expect(409);
  const entry = harness.auditEntries.find((e) => e.event === 'run.verified');
  assert.equal(entry.verified, false, 'a mismatch is part of the trail too');
});

test('an empty scan is refused rather than counted as a pass', async () => {
  const { harness, id } = await readyJob();
  const run = (await printRun(harness, id).expect(202)).body.run;
  await request(harness.app).post(`/api/runs/${run.id}/verify`).send({ scanned: '  ' }).expect(409);
});

test('verifying an unknown run 404s', async () => {
  const harness = buildApp();
  const response = await request(harness.app)
    .post('/api/runs/run_nope/verify').send({ scanned: 'X' }).expect(404);
  assert.equal(response.body.error.code, 'RUN_NOT_FOUND');
});

test('runs for a job can be listed', async () => {
  const { harness, id } = await readyJob();
  await printRun(harness, id).expect(202);
  const response = await request(harness.app).get(`/api/jobs/${id}/runs`).expect(200);
  assert.equal(response.body.runs.length, 1);
  assert.equal(response.body.runs[0].jobId, id);
});
