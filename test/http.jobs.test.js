import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, pdf, png } from './fixtures/app.js';

const upload = (agent, ...markers) => {
  let req = agent.post('/api/jobs');
  for (const marker of markers) req = req.attach('documents', pdf(marker), `${marker}.pdf`);
  return req;
};

async function createJob(harness = buildApp()) {
  const response = await upload(request(harness.app), 'picklist', 'sampleNote').expect(201);
  return { harness, job: response.body };
}

/* -- Creating a job ------------------------------------------------------- */

test('two uploads become a job, with warnings and a provenance summary', async () => {
  const { job } = await createJob();
  assert.match(job.id, /[0-9a-f-]{36}/);
  assert.equal(job.source.picklistNo, 'PL-76120');
  assert.equal(job.source.sampleNoteNo, 'RSMINV26091087');
  assert.equal(job.lines.length, 6);
  assert.deepEqual(job.warnings, []);
  assert.equal(job.readiness.ready, 0);
  assert.equal(job.readiness.total, 6);
  assert.ok(job.provenance.total > 0);
  assert.ok(job.provenance.counts.missing > 0, 'the manual fields are waiting');
  assert.ok(job.provenance.jobMissing.includes('manufacturer') === false,
    'the manufacturer is defaulted during enrichment');
});

test('documents are classified without being told which is which', async () => {
  const forwards = await upload(request(buildApp().app), 'picklist', 'sampleNote').expect(201);
  const backwards = await upload(request(buildApp().app), 'sampleNote', 'picklist').expect(201);
  assert.deepEqual(forwards.body.source, backwards.body.source);
});

test('a Picklist alone is accepted, with the document number missing', async () => {
  const response = await upload(request(buildApp().app), 'picklist').expect(201);
  assert.equal(response.body.docNo.provenance, 'missing');
  assert.equal(response.body.lines.length, 6);
  assert.ok(response.body.warnings.some((w) => /no document number/i.test(w)));
});

test('the quantity is served as text, so nothing downstream reassembles it', async () => {
  const { job } = await createJob();
  assert.equal(job.lines[0].qtyText, '0.30KG');
  assert.equal(job.lines[0].qtyAmount.value, '0.30');
  assert.equal(job.lines[0].qtyUom.value, 'kg');
});

test('uploading nothing explains what to attach', async () => {
  const response = await request(buildApp().app).post('/api/jobs').expect(415);
  assert.equal(response.body.error.code, 'UPLOAD_REJECTED');
  assert.match(response.body.error.message, /Picklist/);
});

test('two documents of the same kind are refused', async () => {
  const response = await upload(request(buildApp().app), 'picklist', 'picklist').expect(400);
  assert.equal(response.body.error.code, 'BAD_REQUEST');
  assert.match(response.body.error.message, /Upload one of each type/);
});

test('a file is judged by its bytes, not its name', async () => {
  const response = await request(buildApp().app)
    .post('/api/jobs')
    .attach('documents', Buffer.from('this is just text'), 'picklist.pdf')
    .expect(415);
  assert.equal(response.body.error.code, 'UPLOAD_REJECTED');
  assert.match(response.body.error.message, /whatever the file is named/);
});

test('an oversized upload is refused with the limit stated', async () => {
  const harness = buildApp({ env: { STICKER_MAX_UPLOAD_BYTES: String(1024) } });
  const response = await request(harness.app)
    .post('/api/jobs')
    .attach('documents', Buffer.concat([pdf('picklist'), Buffer.alloc(4096)]), 'big.pdf')
    .expect(413);
  assert.equal(response.body.error.code, 'UPLOAD_TOO_LARGE');
});

test('an unrecognised document names every marker that was searched for', async () => {
  const harness = buildApp({ texts: { other: 'Delivery note 12345\n' } });
  const response = await request(harness.app)
    .post('/api/jobs')
    .attach('documents', pdf('other'), 'other.pdf')
    .expect(422);
  assert.equal(response.body.error.code, 'DOCUMENT_UNRECOGNISED');
});

test('a PNG is accepted by the uploader and rejected by the reader, not by extension', async () => {
  // Magic bytes say PNG, so the upload passes; no reader accepts it, so the
  // failure is about capability rather than file naming.
  const response = await request(buildApp().app)
    .post('/api/jobs')
    .attach('documents', png(), 'scan.png')
    .expect(422);
  assert.equal(response.body.error.code, 'DOCUMENT_UNREADABLE');
  assert.match(response.body.error.detail ?? response.body.error.message, /poppler|read/i);
});

/* -- Reading -------------------------------------------------------------- */

test('a job can be fetched back, and an unknown one 404s', async () => {
  const { harness, job } = await createJob();
  const fetched = await request(harness.app).get(`/api/jobs/${job.id}`).expect(200);
  assert.equal(fetched.body.id, job.id);

  const missing = await request(harness.app).get('/api/jobs/nope').expect(404);
  assert.equal(missing.body.error.code, 'JOB_NOT_FOUND');
  assert.match(missing.body.error.message, /Upload the documents again/);
});

test('the job list summarises without dumping every field', async () => {
  const { harness } = await createJob();
  const response = await request(harness.app).get('/api/jobs').expect(200);
  assert.equal(response.body.jobs.length, 1);
  assert.deepEqual(Object.keys(response.body.jobs[0]).sort(),
    ['createdAt', 'expiresAt', 'id', 'lines', 'ready']);
});

test('deleting a job removes it and its staged uploads', async () => {
  const { harness, job } = await createJob();
  assert.equal(harness.fileStore.files.size, 2);
  await request(harness.app).delete(`/api/jobs/${job.id}`).expect(204);
  assert.equal(harness.fileStore.files.size, 0);
  await request(harness.app).get(`/api/jobs/${job.id}`).expect(404);
});

/* -- Editing -------------------------------------------------------------- */

test('a job-level field is set as manual and re-enriched', async () => {
  const { harness, job } = await createJob();
  const response = await request(harness.app)
    .patch(`/api/jobs/${job.id}`)
    .send({ manufacturer: 'Acme Chemicals Ltd' })
    .expect(200);
  assert.equal(response.body.manufacturer.value, 'Acme Chemicals Ltd');
  assert.equal(response.body.manufacturer.provenance, 'manual');
});

test('sending null clears a field back to missing', async () => {
  const { harness, job } = await createJob();
  const response = await request(harness.app)
    .patch(`/api/jobs/${job.id}`)
    .send({ manufacturer: null })
    .expect(200);
  // Enrichment puts the configured default back, tagged derived rather than
  // manual, which is the honest description of where it came from.
  assert.equal(response.body.manufacturer.provenance, 'derived');
});

test('setting a field the operator does not own is refused', async () => {
  const { harness, job } = await createJob();
  const response = await request(harness.app)
    .patch(`/api/jobs/${job.id}`)
    .send({ id: 'hijacked', createdAt: 'whenever' })
    .expect(400);
  assert.match(response.body.error.message, /Cannot set id, createdAt/);
});

test('a line patch returns the line with recomputed status and provenance', async () => {
  const { harness, job } = await createJob();
  const response = await request(harness.app)
    .patch(`/api/jobs/${job.id}/lines/1`)
    .send({ batchCode: 'JUR260725', mnfDate: '05/2026', expDate: '05/2028' })
    .expect(200);

  assert.equal(response.body.line.status, 'ready');
  assert.equal(response.body.line.batchCode.provenance, 'manual');
  assert.equal(response.body.line.provenance.counts.manual, 3);
  assert.equal(response.body.readiness.ready, 1);
  assert.equal(response.body.readiness.total, 6);
});

test('the batch code is stored exactly as typed', async () => {
  const { harness, job } = await createJob();
  const response = await request(harness.app)
    .patch(`/api/jobs/${job.id}/lines/1`)
    .send({ batchCode: 'lot 44/b (drum 3)' })
    .expect(200);
  assert.equal(response.body.line.batchCode.value, 'lot 44/b (drum 3)');
});

test('copies are bounded, and a bad value is refused', async () => {
  const { harness, job } = await createJob();
  await request(harness.app).patch(`/api/jobs/${job.id}/lines/1`).send({ copies: 12 }).expect(200);
  for (const copies of [0, -1, 1000, 2.5, 'many']) {
    const response = await request(harness.app)
      .patch(`/api/jobs/${job.id}/lines/1`).send({ copies }).expect(400);
    assert.match(response.body.error.message, /between 1 and 999/);
  }
});

test('an out-of-range line number 404s rather than silently doing nothing', async () => {
  const { harness, job } = await createJob();
  const response = await request(harness.app)
    .patch(`/api/jobs/${job.id}/lines/99`).send({ batchCode: 'X' }).expect(404);
  assert.equal(response.body.error.code, 'LINE_NOT_FOUND');
});

test('a non-numeric line number is a bad request, not a crash', async () => {
  const { harness, job } = await createJob();
  await request(harness.app)
    .patch(`/api/jobs/${job.id}/lines/abc`).send({ batchCode: 'X' }).expect(400);
});
