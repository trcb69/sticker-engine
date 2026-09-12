import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPipelineJob, buildPipelineZpl, pipelineWarnings } from './fixtures/pipeline.js';
import { textOf } from '../src/model/types.js';

const golden = readFileSync(new URL('./fixtures/golden-pipeline-203.zpl', import.meta.url), 'utf8');

test('fixture documents produce the golden ZPL byte for byte', async () => {
  // The widest regression net in the suite. Any change to parsing, joining,
  // enrichment, layout, metrics or the emitter shows up here as a diff, which
  // is the point: those modules are only correct together.
  assert.equal(await buildPipelineZpl(), golden);
});

test('the golden run is three labels across three lines', () => {
  const starts = golden.match(/\^XA/g) ?? [];
  assert.equal(starts.length, 3);
  assert.equal((golden.match(/\^PQ1\n/g) ?? []).length, 1);
  assert.equal((golden.match(/\^PQ3\n/g) ?? []).length, 1);
  assert.equal((golden.match(/\^PQ2\n/g) ?? []).length, 1);
});

test('the values printed came off the documents, not from anywhere else', () => {
  assert.ok(golden.includes('Jay Jay Mills Lanka (PVT) Ltd | RSMINV26091087'));
  assert.ok(golden.includes('MANUFACTURER - Miscellaneous Supplier'));
  assert.ok(golden.includes('FW-777-Hybrid White'), 'the Picklist description, verbatim');
  assert.ok(golden.includes('QTY :- 0.30KG'), 'the Picklist numeral and unit, verbatim');
  assert.ok(golden.includes('QTY :- 0.10KG'), 'and a different quantity on another line');
});

test('the batch codes are encoded exactly as they were entered', () => {
  for (const code of ['JUR260721', 'JUR260722', 'REA260901']) {
    assert.ok(golden.includes(code), code);
  }
});

test('symbols are native ZPL throughout — no rasterised anything', () => {
  assert.ok(!golden.includes('^GFA'));
  assert.equal((golden.match(/\^BCN,48,Y,N,N/g) ?? []).length, 3, 'a barcode per label, HRI below');
  assert.equal((golden.match(/\^BQN,2,3\^FH_\^FDQA,/g) ?? []).length, 3, 'and a QR at the chosen ECC');
});

test('the logo is recalled from printer memory rather than resent per label', () => {
  assert.equal((golden.match(/\^XGR:LOGO\.GRF/g) ?? []).length, 3);
  assert.ok(!golden.includes('~DG'), 'the bitmap is stored once, elsewhere');
});

test('every label in the golden run passes the guard', () => {
  for (const { index, warnings } of pipelineWarnings()) {
    const problems = warnings.filter((warning) => warning.severity !== 'info');
    assert.deepEqual(problems, [], `line ${index}`);
  }
});

test('the lines that were left incomplete are not in the run', () => {
  const { job } = buildPipelineJob();
  const ready = job.lines.filter((line) => line.status === 'ready').map((line) => line.index);
  assert.deepEqual(ready, [1, 2, 5]);
  assert.ok(!golden.includes('8700T Clear Paste'), 'line 3 had no batch code');
});

test('the job carries both source documents and no warnings', () => {
  const { job, joinWarnings, warnings } = buildPipelineJob();
  assert.equal(job.source.picklistNo, 'PL-76120');
  assert.equal(job.source.sampleNoteNo, 'RSMINV26091087');
  assert.deepEqual(joinWarnings, []);
  assert.ok(!warnings.some((warning) => warning.severity === 'error'));
  assert.equal(textOf(job.customer), 'Jay Jay Mills Lanka (PVT) Ltd');
});

test('the same documents scale to 600 dpi without a second template', async () => {
  const at600 = await buildPipelineZpl({ dpi: 600 });
  assert.equal((at600.match(/\^PW2400/g) ?? []).length, 3);
  assert.equal((at600.match(/\^XA/g) ?? []).length, 3);
  assert.ok(at600.includes('FW-777-Hybrid White'));
});
