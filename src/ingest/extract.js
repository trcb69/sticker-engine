/**
 * Document extraction.
 *
 * Readers turn a file into text; classification then decides what the text is.
 * The two are separate so an OCR reader drops in behind the same interface
 * without touching the parsers: it only has to return `{ pageCount, layoutText,
 * confidence }` like any other reader.
 *
 * The poppler reader takes its process runner by injection. Nothing here
 * spawns a child process directly, so the whole module is testable without
 * poppler installed and without a real PDF on disk.
 */

import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { DocumentReadError, UnknownDocumentError } from '../errors.js';

/**
 * @typedef {object} ReaderResult
 * @property {number} pageCount
 * @property {string} layoutText
 * @property {number} [confidence] 0-1. Absent means "exact", as with a text PDF.
 */

/**
 * @typedef {object} Reader
 * @property {string} id
 * @property {(path: string, hints?: { mime?: string }) => boolean} accepts
 * @property {(path: string) => Promise<ReaderResult>} read
 */

/**
 * @typedef {object} ExtractResult
 * @property {'sampleNote'|'picklist'|'salesOrder'} kind
 * @property {number} pageCount
 * @property {string} layoutText
 * @property {string} reader Reader id, for the audit trail.
 * @property {number} [confidence]
 */

/**
 * Document markers. Adding a document type is a change to this table, not to
 * the classifier.
 * @type {Readonly<Record<string, { label: string, markers: {name: string, pattern: RegExp}[] }>>}
 */
export const DOCUMENT_MARKERS = Object.freeze({
  sampleNote: {
    label: 'Sample Note',
    markers: [
      { name: 'the heading "SAMPLE NOTE"', pattern: /SAMPLE\s+NOTE/i },
      { name: 'a document number beginning RSMINV', pattern: /\bRSMINV\d+/i },
    ],
  },
  picklist: {
    label: 'Picklist',
    markers: [
      { name: 'the heading "Picklist"', pattern: /\bPicklist\b/i },
      { name: 'a picklist number beginning PL-', pattern: /\bPL-\d+/i },
    ],
  },
  salesOrder: {
    label: 'Sales Order',
    markers: [
      { name: 'the caption "Sales Order#"', pattern: /Sales\s+Order\s*#/i },
      { name: 'an order number beginning RSMSO', pattern: /\bRSMSO\d+/i },
    ],
  },
  packagingSlip: {
    label: 'Packaging Slip',
    markers: [
      { name: 'the caption "Package#"', pattern: /Package\s*#/i },
      { name: 'a package number beginning PKG-', pattern: /\bPKG-\d+/i },
      { name: 'the caption "Package Dispatch Location"', pattern: /Package\s*Dispatch/i },
    ],
  },
});

/**
 * Classify extracted text.
 *
 * Scores each document type by how many of its markers appear and takes the
 * best. A single marker is enough when nothing else matches — a Picklist whose
 * heading was rendered as an image still has its `PL-` number — but a tie is
 * refused rather than guessed.
 *
 * @param {string} text
 * @returns {{ kind: 'sampleNote'|'picklist'|'salesOrder', matched: string[], score: number }}
 */
export function detectKind(text) {
  const scores = Object.entries(DOCUMENT_MARKERS).map(([kind, spec]) => {
    const matched = spec.markers.filter((m) => m.pattern.test(text)).map((m) => m.name);
    return { kind, matched, score: matched.length };
  });

  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const tied = scores.filter((s) => s.score === best.score && s.kind !== best.kind);

  if (best.score === 0) {
    throw new UnknownDocumentError(
      'This document is not a Packaging Slip.',
      { detail: `searched for: ${describeMarkers()}` },
    );
  }
  if (tied.length > 0) {
    throw new UnknownDocumentError(
      'This document matches two document types equally. Please upload one document at a time.',
      { detail: `searched for: ${describeMarkers()}` },
    );
  }
  return /** @type {any} */ (best);
}

/** @returns {string} */
function describeMarkers() {
  return Object.values(DOCUMENT_MARKERS)
    .map((spec) => `${spec.label} — ${spec.markers.map((m) => m.name).join(' and ')}`)
    .join('; ');
}

/**
 * Default process runner. Injected everywhere else so tests never spawn.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function execFileRunner(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * Reader backed by poppler's `pdfinfo` and `pdftotext -layout`.
 *
 * `-layout` matters: it preserves the horizontal spacing the row parser uses
 * to align wrapped cells to their columns. Plain `pdftotext` collapses that
 * and the tables become unreadable.
 *
 * @param {{ run?: typeof execFileRunner, binDir?: string }} [options]
 * @returns {Reader}
 */
export function createPopplerReader(options = {}) {
  const run = options.run ?? execFileRunner;
  const bin = (name) => (options.binDir ? join(options.binDir, name) : name);

  return {
    id: 'poppler',
    accepts: (path, hints = {}) => hints.mime === 'application/pdf' || /\.pdf$/i.test(path),
    async read(path) {
      let info;
      try {
        info = await run(bin('pdfinfo'), [path]);
      } catch (cause) {
        throw new DocumentReadError(
          `Could not read "${basename(path)}". It may not be a valid PDF.`,
          { cause, detail: 'pdfinfo failed' },
        );
      }

      const pages = /^Pages:\s*(\d+)$/m.exec(info.stdout);
      if (!pages) {
        throw new DocumentReadError(
          `Could not determine how many pages "${basename(path)}" has.`,
          { detail: 'pdfinfo produced no Pages line' },
        );
      }

      let text;
      try {
        text = await run(bin('pdftotext'), ['-layout', path, '-']);
      } catch (cause) {
        throw new DocumentReadError(
          `Could not read the text of "${basename(path)}".`,
          { cause, detail: 'pdftotext failed' },
        );
      }

      if (text.stdout.trim() === '') {
        throw new DocumentReadError(
          `"${basename(path)}" contains no selectable text. It is probably a scan, ` +
          'which needs a different reader.',
          { detail: 'pdftotext returned empty output' },
        );
      }

      return { pageCount: Number(pages[1]), layoutText: text.stdout };
    },
  };
}

/**
 * Build an extractor over a set of readers.
 * @param {{ readers?: Reader[] }} [options]
 * @returns {{ extract: (path: string) => Promise<ExtractResult> }}
 */
export function createExtractor(options = {}) {
  const readers = options.readers ?? [createPopplerReader()];

  return {
    /**
     * @param {string} path
     * @param {{ mime?: string }} [hints] Content type as sniffed from the bytes,
     *   which is more trustworthy than the path's extension.
     */
    async extract(path, hints = {}) {
      const reader = readers.find((candidate) => candidate.accepts(path, hints));
      if (!reader) {
        throw new DocumentReadError(
          `Nothing here can read "${basename(path)}".`,
          { detail: `readers: ${readers.map((r) => r.id).join(', ') || 'none'}` },
        );
      }
      const result = await reader.read(path);
      const { kind } = detectKind(result.layoutText);
      return {
        kind,
        pageCount: result.pageCount,
        layoutText: result.layoutText,
        reader: reader.id,
        ...(result.confidence === undefined ? {} : { confidence: result.confidence }),
      };
    },
  };
}
