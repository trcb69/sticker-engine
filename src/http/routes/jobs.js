/**
 * Job routes.
 *
 * Every handler is thin. Parsing, joining, enriching and rendering all live in
 * their own modules; these functions translate HTTP into calls on them and back
 * again. Nothing here reaches into the store's internals or the filesystem.
 */

import { Router } from 'express';
import { AppError } from '../../errors.js';
import { field, missing } from '../../model/types.js';
import { uploadHandler, validateUploads } from '../middleware/uploads.js';
import { renderContext, serialiseJob, serialiseLine } from '../serialise.js';

export class BadRequestError extends AppError {
  static code = 'BAD_REQUEST';
  static httpStatus = 400;
}

export class JobNotReadyError extends AppError {
  static code = 'JOB_NOT_READY';
  static httpStatus = 409;
}

/** Fields an operator may set on a job, and the note recorded when cleared. */
const JOB_PATCHABLE = {
  manufacturer: 'Cleared by the operator',
  customer: 'Cleared by the operator',
  docNo: 'Cleared by the operator',
};

/** Fields an operator may set on a line. */
const LINE_PATCHABLE = {
  batchCode: 'Entered or pasted by the operator',
  mnfDate: 'Entered by the operator',
  expDate: 'Entered by the operator',
  qtyAmount: 'Entered by the operator',
  qtyUom: 'Entered by the operator',
};

/**
 * @param {object} deps
 */
export function jobRoutes(deps) {
  const {
    config, jobStore, fileStore, extractor, parsers, join, enrich,
    template, emit, guard, shortLinks, runs,
  } = deps;
  const router = Router();

  router.post('/', uploadHandler({ maxBytes: config.maxUploadBytes }), async (req, res) => {
    const uploads = validateUploads(req.files);

    /** @type {Record<string, object>} */
    const parsed = {};
    /** @type {string[]} */
    const stagedFiles = [];

    for (const upload of uploads) {
      const path = await fileStore.stage(upload.buffer, upload.originalName);
      stagedFiles.push(path);
      const extracted = await extractor.extract(path, { mime: upload.mime });
      const parser = parsers[extracted.kind];
      if (!parser) {
        throw new BadRequestError(`No parser is available for a ${extracted.kind}.`);
      }
      if (parsed[extracted.kind]) {
        throw new BadRequestError(
          `Two ${extracted.kind} documents were uploaded. Upload one of each type.`,
        );
      }
      parsed[extracted.kind] = parser(extracted.layoutText, { dateOrder: config.dateOrder });
    }

    const joined = join(parsed);
    const enriched = enrich(joined.job, { config });
    const record = jobStore.create({
      job: enriched.job,
      warnings: joined.warnings,
      enrichWarnings: enriched.warnings,
      buckets: joined.buckets,
      stagedFiles,
    });

    res.status(201).json(serialiseJob(record));
  });

  router.get('/', (req, res) => {
    res.json({ jobs: jobStore.list() });
  });

  router.get('/:id', (req, res) => {
    res.json(serialiseJob(jobStore.get(req.params.id)));
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await jobStore.delete(req.params.id);
    res.status(deleted ? 204 : 404).end();
  });

  router.patch('/:id', async (req, res) => {
    const patch = buildPatch(req.body, JOB_PATCHABLE);

    if ('qrUrl' in (req.body ?? {})) {
      // Pressing Proceed on the link field is what mints the short code. The
      // symbol is planned here, before anything is printed, so an unscannable
      // link is refused now rather than discovered on a drum.
      const link = await shortLinks.mint(String(req.body.qrUrl));
      patch.qrUrl = field(link.target, 'manual');
      patch.qrShortCode = field(link.code, 'derived', `Shortened via ${link.provider}`);
      patch.qrPayload = field(link.qrPayload, 'derived');
      patch.qrPlan = link.plan;
    }

    jobStore.patchJob(req.params.id, patch);
    const enriched = enrich(jobStore.get(req.params.id).job, { config });
    res.json(serialiseJob(jobStore.setEnriched(req.params.id, enriched)));
  });

  router.patch('/:id/lines/:index', (req, res) => {
    const index = parseIndex(req.params.index);
    jobStore.patchLine(req.params.id, index, buildLinePatch(req.body));

    // Enrichment is a pure function of the job, so it is re-run rather than
    // patched. That is what keeps status and provenance honest after an edit.
    const enriched = enrich(jobStore.get(req.params.id).job, { config });
    const record = jobStore.setEnriched(req.params.id, enriched);
    const line = record.job.lines.find((candidate) => candidate.index === index);

    res.json({
      line: serialiseLine(line),
      warnings: record.enrichWarnings.filter((w) => w.line === index || w.line === undefined),
      readiness: {
        total: record.job.lines.length,
        ready: record.job.lines.filter((candidate) => candidate.status === 'ready').length,
      },
    });
  });

  router.post('/:id/lines/:index/preview', (req, res) => {
    const index = parseIndex(req.params.index);
    const record = jobStore.get(req.params.id);
    const line = requireLine(record, index);
    const dpi = parseDpi(req.query.dpi ?? req.body?.dpi);
    const { zpl, placed } = emit(template(dpi), renderContext(record.job, line), { copies: 1 });
    res.json({ zpl, warnings: guard(placed), dpi });
  });

  router.post('/:id/print', async (req, res) => {
    const record = jobStore.get(req.params.id);
    const dpi = parseDpi(req.body?.dpi);
    const selected = selectLines(record, req.body?.lines?.join?.(',') ?? req.body?.lines);
    requireReady(record, selected);

    const printerName = req.body?.printer;
    if (typeof printerName !== 'string' || printerName === '') {
      throw new BadRequestError(
        'Say which printer to use. On USB that is the device name Browser Print reported; '
        + 'on the network, see GET /api/printers.',
      );
    }
    // Identity reaches the audit log or the log is worth much less. Where a
    // host system forwards a user, that wins; otherwise the operator names
    // themselves, and an unnamed run is recorded as unattributed rather than
    // silently anonymous.
    const operator = String(req.get('x-operator') ?? req.body?.operator ?? '').trim()
      || 'unattributed';

    const transport = req.body?.transport ?? config.printTransport;
    if (!['browser', 'network'].includes(transport)) {
      throw new BadRequestError(`Transport must be "browser" or "network". Received "${transport}".`);
    }

    const request = {
      job: record.job,
      lines: selected,
      printerName,
      dpi,
      operator,
      reason: req.body?.reason ?? null,
    };

    if (transport === 'browser') {
      // The server cannot reach a USB printer on someone else's desk, so the
      // ZPL goes back to the browser to deliver. The run stays pending until
      // the browser says what happened to it.
      const { run, zpl } = await runs.prepare(request);
      res.status(202).json({ run, zpl });
      return;
    }

    const run = await runs.print(request);
    res.status(202).json({ run });
  });

  router.get('/:id/runs', (req, res) => {
    jobStore.get(req.params.id);
    res.json({ runs: runs.list(req.params.id) });
  });

  router.get('/:id/zpl', (req, res) => {
    const record = jobStore.get(req.params.id);
    const dpi = parseDpi(req.query.dpi);
    const selected = selectLines(record, req.query.lines);
    requireReady(record, selected);

    const parts = [];
    for (const line of selected) {
      const { zpl } = emit(template(dpi), renderContext(record.job, line), { copies: line.copies });
      parts.push(zpl);
    }

    // Sent as a Buffer so Express does not append a charset to what is a
    // download rather than a document.
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${record.job.id}.zpl"`);
    res.send(Buffer.from(parts.join(''), 'utf8'));
  });

  return router;
}

/**
 * Refuse to print anything that is not ready, naming the lines.
 * @param {object} record
 * @param {object[]} selected
 */
function requireReady(record, selected) {
  const blocked = selected.filter((line) => line.status !== 'ready');
  if (blocked.length === 0) return;
  const many = blocked.length > 1;
  throw new JobNotReadyError(
    `Line${many ? 's' : ''} ${blocked.map((l) => l.index).join(', ')} `
    + `still need${many ? '' : 's'} a batch code or dates.`,
    { detail: `jobId=${record.job.id}` },
  );
}

/** @param {string} raw */
function parseIndex(raw) {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1) {
    throw new BadRequestError(`"${raw}" is not a line number.`);
  }
  return index;
}

/** @param {unknown} raw */
function parseDpi(raw) {
  if (raw === undefined) return 203;
  const dpi = Number(raw);
  if (![203, 300, 600].includes(dpi)) {
    throw new BadRequestError(`Print resolution must be 203, 300 or 600. Received "${raw}".`);
  }
  return dpi;
}

/**
 * @param {import('../../store/jobStore.js').StoredJob} record
 * @param {number} index
 */
function requireLine(record, index) {
  const line = record.job.lines.find((candidate) => candidate.index === index);
  if (!line) throw new BadRequestError(`This job has no line ${index}.`);
  return line;
}

/**
 * @param {import('../../store/jobStore.js').StoredJob} record
 * @param {unknown} raw comma-separated line numbers, or absent for every ready line
 */
function selectLines(record, raw) {
  if (raw === undefined || raw === '') {
    const ready = record.job.lines.filter((line) => line.status === 'ready');
    if (ready.length === 0) {
      throw new JobNotReadyError('No line on this job is ready to print yet.');
    }
    return ready;
  }
  const wanted = String(raw).split(',').map((part) => part.trim()).filter(Boolean).map(parseIndex);
  return wanted.map((index) => requireLine(record, index));
}

/**
 * Turn a JSON body into Field patches.
 *
 * An explicit `null` clears a field back to `missing`; a value sets it to
 * `manual`. Omitting a key leaves it alone, so a client can send one field
 * without having to resend the rest.
 *
 * @param {Record<string, unknown>} body
 * @param {Record<string, string>} allowed
 */
function buildPatch(body, allowed) {
  if (!body || typeof body !== 'object') {
    throw new BadRequestError('The request body must be a JSON object.');
  }
  const unknown = Object.keys(body).filter(
    (key) => !(key in allowed) && key !== 'qrUrl' && key !== 'copies',
  );
  if (unknown.length > 0) {
    throw new BadRequestError(
      `Cannot set ${unknown.join(', ')}. Editable here: ${Object.keys(allowed).join(', ')}.`,
    );
  }

  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const [key, note] of Object.entries(allowed)) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === '') {
      patch[key] = missing(note);
    } else if (typeof value !== 'string') {
      throw new BadRequestError(`"${key}" must be text.`);
    } else {
      patch[key] = field(value, 'manual');
    }
  }
  return patch;
}

/** @param {Record<string, unknown>} body */
function buildLinePatch(body) {
  const patch = buildPatch(body, LINE_PATCHABLE);
  if ('copies' in (body ?? {})) {
    const copies = Number(body.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 999) {
      throw new BadRequestError('Copies must be a whole number between 1 and 999.');
    }
    patch.copies = copies;
  }
  return patch;
}
