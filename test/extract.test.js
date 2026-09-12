import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExtractor, createPopplerReader, detectKind, DOCUMENT_MARKERS } from '../src/ingest/extract.js';
import { DocumentReadError, UnknownDocumentError } from '../src/errors.js';

const picklistText = readFileSync(new URL('./fixtures/picklist-PL-76120.txt', import.meta.url), 'utf8');
const sampleNoteText = readFileSync(new URL('./fixtures/sample-note-RSMINV26091087.txt', import.meta.url), 'utf8');

/** A poppler stand-in. No process is ever spawned in these tests. */
function fakeRunner({ pages = 1, text = picklistText, fail = null } = {}) {
  return async (command, args) => {
    if (fail === command) throw new Error(`${command} exploded`);
    if (command.endsWith('pdfinfo')) return { stdout: `Title: x\nPages:          ${pages}\n`, stderr: '' };
    if (command.endsWith('pdftotext')) {
      assert.ok(args.includes('-layout'), 'layout mode is required for column alignment');
      return { stdout: text, stderr: '' };
    }
    throw new Error(`unexpected command ${command}`);
  };
}

test('both document kinds are recognised from their markers', () => {
  assert.equal(detectKind(picklistText).kind, 'picklist');
  assert.equal(detectKind(sampleNoteText).kind, 'sampleNote');
  assert.equal(detectKind(sampleNoteText).matched.length, 2, 'both markers present');
});

test('a single surviving marker is enough to classify', () => {
  assert.equal(detectKind('Job sheet for PL-76120 issued today').kind, 'picklist');
  assert.equal(detectKind('reference RSMINV26091087 attached').kind, 'sampleNote');
});

test('an unrecognised document names every marker that was searched for', () => {
  assert.throws(
    () => detectKind('Delivery note 12345'),
    (error) => {
      assert.ok(error instanceof UnknownDocumentError);
      assert.match(error.detail, /SAMPLE NOTE/);
      assert.match(error.detail, /RSMINV/);
      assert.match(error.detail, /Picklist/);
      assert.match(error.detail, /PL-/);
      return true;
    },
  );
});

test('a document matching both kinds equally is refused, not guessed', () => {
  assert.throws(
    () => detectKind('SAMPLE NOTE RSMINV26091087 Picklist PL-76120'),
    (error) => error instanceof UnknownDocumentError && /both/.test(error.message),
  );
});

test('the marker table is data, so adding a document type needs no new code', () => {
  assert.deepEqual(Object.keys(DOCUMENT_MARKERS), ['sampleNote', 'picklist', 'salesOrder']);
  for (const spec of Object.values(DOCUMENT_MARKERS)) {
    assert.ok(spec.markers.length >= 1);
    assert.ok(spec.markers.every((m) => m.pattern instanceof RegExp));
  }
});

test('the poppler reader returns page count and layout text', async () => {
  const reader = createPopplerReader({ run: fakeRunner({ pages: 3 }) });
  const result = await reader.read('/tmp/picklist.pdf');
  assert.equal(result.pageCount, 3);
  assert.ok(result.layoutText.includes('PL-76120'));
});

test('the reader only accepts PDFs, leaving room for other readers', () => {
  const reader = createPopplerReader({ run: fakeRunner() });
  assert.equal(reader.accepts('/tmp/a.pdf'), true);
  assert.equal(reader.accepts('/tmp/a.PDF'), true);
  assert.equal(reader.accepts('/tmp/a.jpg'), false);
});

test('a failing pdfinfo becomes an operator-safe message', async () => {
  const reader = createPopplerReader({ run: fakeRunner({ fail: 'pdfinfo' }) });
  await assert.rejects(
    () => reader.read('/tmp/broken.pdf'),
    (error) => {
      assert.ok(error instanceof DocumentReadError);
      assert.match(error.message, /broken\.pdf/);
      assert.ok(!/exploded/.test(error.message), 'the underlying error is not leaked');
      return true;
    },
  );
});

test('a PDF with no selectable text is identified as needing another reader', async () => {
  const reader = createPopplerReader({ run: fakeRunner({ text: '   \n  \n' }) });
  await assert.rejects(() => reader.read('/tmp/scan.pdf'), /scan/i);
});

test('the extractor picks a reader, reads and classifies in one step', async () => {
  const extractor = createExtractor({
    readers: [createPopplerReader({ run: fakeRunner({ text: sampleNoteText, pages: 1 }) })],
  });
  const result = await extractor.extract('/tmp/note.pdf');
  assert.equal(result.kind, 'sampleNote');
  assert.equal(result.pageCount, 1);
  assert.equal(result.reader, 'poppler');
});

test('an OCR reader drops in behind the same interface', async () => {
  // Nothing in the extractor knows what OCR is; it only knows the shape.
  const ocr = {
    id: 'tesseract',
    accepts: (path) => /\.(png|jpe?g)$/i.test(path),
    read: async () => ({ pageCount: 1, layoutText: picklistText, confidence: 0.71 }),
  };
  const extractor = createExtractor({
    readers: [createPopplerReader({ run: fakeRunner() }), ocr],
  });
  const result = await extractor.extract('/tmp/photo.jpg');
  assert.equal(result.reader, 'tesseract');
  assert.equal(result.kind, 'picklist');
  assert.equal(result.confidence, 0.71, 'confidence travels with the result for the UI to flag');
});

test('a file nothing can read says so, listing the readers available', async () => {
  const extractor = createExtractor({ readers: [createPopplerReader({ run: fakeRunner() })] });
  await assert.rejects(
    () => extractor.extract('/tmp/notes.docx'),
    (error) => error instanceof DocumentReadError && /poppler/.test(error.detail),
  );
});
