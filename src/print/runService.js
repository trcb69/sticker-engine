/**
 * Print runs and scan-back verification.
 *
 * A run is the unit of accountability: a set of lines, sent to one printer, by
 * one person, at one moment. It is not complete when the bytes are written —
 * it is complete when someone has scanned a label back and confirmed it reads.
 *
 * That verification step is the highest-value check in the system and costs
 * almost nothing. Darkness drift, a dirty printhead element and a stock change
 * all produce labels that look fine to a human and fail at the customer. A
 * scanner reading one label back catches all three before the pallet moves.
 */

import { randomUUID } from 'node:crypto';
import {
  ReprintReasonRequiredError, RunAlreadySettledError, RunNotFoundError,
  VerificationMismatchError,
} from '../errors.js';
import { isPresent, textOf } from '../model/types.js';

/**
 * @typedef {'pending'|'printed'|'verified'|'failed'|'mismatch'} RunStatus
 *
 * `pending` exists only for browser transport: the ZPL has been handed to the
 * operator's machine and nothing is known about what happened to it yet. It
 * settles to `printed` or `failed` when the browser reports back.
 */

/**
 * @param {{ printerClient: object, queue: object, auditLog: object,
 *           emit: Function, template: Function, renderContext: Function,
 *           id?: () => string, now?: () => string,
 *           logger?: { info: Function, warn: Function } }} deps
 */
export function createRunService(deps) {
  const id = deps.id ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());
  const logger = deps.logger ?? { info() {}, warn() {} };
  /** @type {Map<string, object>} */
  const runs = new Map();

  /** @param {string} runId */
  function requireRun(runId) {
    const run = runs.get(runId);
    if (!run) {
      throw new RunNotFoundError(
        'That print run is not known. It may have been completed on another machine.',
        { detail: `runId=${runId}` },
      );
    }
    return run;
  }

  return {
    get(runId) { return requireRun(runId); },
    list(jobId) {
      return [...runs.values()].filter((run) => !jobId || run.jobId === jobId);
    },

    /**
     * Every batch code in this selection that has been printed before.
     * @param {object[]} lines
     */
    async findReprints(lines) {
      const found = [];
      for (const line of lines) {
        if (!isPresent(line.batchCode)) continue;
        const history = await deps.auditLog.historyFor(textOf(line.batchCode));
        if (history.length > 0) found.push({ batchCode: textOf(line.batchCode), previously: history });
      }
      return found;
    },

    /**
     * Create a run and check it is allowed, without sending anything.
     *
     * Both transports start here, so reprint gating and the run record cannot
     * drift apart between them.
     *
     * @param {{ job: object, lines: object[], printerName: string, dpi: number,
     *           operator: string, reason?: string|null,
     *           transport?: 'browser'|'network' }} request
     */
    async begin(request) {
      const { job, lines, printerName, dpi, operator } = request;
      const transport = request.transport ?? 'network';

      // A network printer must exist in configuration. A browser device is
      // whatever Zebra Browser Print found on the operator's own machine, and
      // this server has no business having an opinion about it.
      const address = transport === 'network'
        ? (() => {
          const printer = deps.printerClient.resolve(printerName);
          return `${printerName} (${printer.host}:${printer.port})`;
        })()
        : printerName;

      const reprints = await this.findReprints(lines);
      if (reprints.length > 0 && !request.reason) {
        throw new ReprintReasonRequiredError(
          `Batch ${reprints.map((r) => r.batchCode).join(', ')} `
          + `${reprints.length === 1 ? 'has' : 'have'} been printed before. `
          + 'Give a reason for the reprint — a duplicate batch code in circulation has to be traceable.',
          { detail: reprints.map((r) => `${r.batchCode}x${r.previously.length}`).join(' ') },
        );
      }

      const run = {
        id: `run_${id()}`,
        jobId: job.id,
        transport,
        printer: printerName,
        printerAddress: address,
        dpi,
        operator,
        reason: request.reason ?? null,
        isReprint: reprints.length > 0,
        labels: lines.reduce((sum, line) => sum + (line.copies ?? 1), 0),
        startedAt: now(),
        finishedAt: null,
        status: /** @type {RunStatus} */ ('pending'),
        verification: null,
        error: null,
        lines: lines.map((line) => ({
          index: line.index,
          displayName: textOf(line.displayName),
          batchCode: isPresent(line.batchCode) ? textOf(line.batchCode) : null,
          copies: line.copies ?? 1,
        })),
      };
      runs.set(run.id, run);
      return run;
    },

    /**
     * The ZPL for a run, identical whichever transport carries it.
     * @param {object} job
     * @param {object[]} lines
     * @param {number} dpi
     * @returns {string}
     */
    buildZpl(job, lines, dpi) {
      return lines
        .map((line) => deps.emit(
          deps.template(dpi),
          deps.renderContext(job, line),
          { copies: line.copies ?? 1 },
        ).zpl)
        .join('');
    },

    /**
     * Browser transport: prepare a run and hand the ZPL back.
     *
     * Nothing is written to the audit trail here. Nothing has been printed —
     * the operator's machine has not even been asked yet — and an audit trail
     * that records intentions rather than events is not an audit trail.
     *
     * @param {object} request as `begin`
     * @returns {Promise<{ run: object, zpl: string }>}
     */
    async prepare(request) {
      const run = await this.begin({ ...request, transport: 'browser' });
      logger.info({ event: 'run.prepared', runId: run.id, labels: run.labels });
      return { run, zpl: this.buildZpl(request.job, request.lines, request.dpi) };
    },

    /**
     * Network transport: prepare, send, and settle in one call.
     * @param {object} request as `begin`
     */
    async print(request) {
      const { job, lines, printerName, dpi } = request;
      const run = await this.begin({ ...request, transport: 'network' });

      // Everything below happens inside the printer's queue, so two operators
      // cannot interleave their ZPL on the wire.
      try {
        await deps.queue.submit(printerName, async () => {
          await deps.printerClient.ensureGraphic(printerName);
          await deps.printerClient.print(printerName, this.buildZpl(job, lines, dpi));
        });
      } catch (error) {
        await this.settle({ runId: run.id, ok: false, error: error.message });
        throw error;
      }

      return this.settle({ runId: run.id, ok: true });
    },

    /**
     * Record what actually happened to a run.
     *
     * The single place the audit trail is written, so the two transports
     * cannot record different things about the same event.
     *
     * @param {{ runId: string, ok: boolean, deviceName?: string, error?: string }} report
     */
    async settle(report) {
      const run = requireRun(report.runId);
      if (run.status !== 'pending') {
        // A replayed or duplicated confirmation would otherwise write the
        // audit trail twice, which is worse than losing it once.
        throw new RunAlreadySettledError(
          `This run was already recorded as ${run.status}.`,
          { detail: `runId=${run.id} status=${run.status}` },
        );
      }

      run.finishedAt = now();
      if (report.deviceName) {
        run.printer = report.deviceName;
        run.printerAddress = report.deviceName;
      }

      if (!report.ok) {
        run.status = 'failed';
        run.error = { code: 'PRINT_FAILED', message: report.error ?? 'The label was not printed.' };
        await deps.auditLog.append({
          event: 'run.failed',
          runId: run.id,
          jobId: run.jobId,
          operator: run.operator,
          printer: run.printer,
          transport: run.transport,
          message: run.error.message,
        });
        // Deliberately no label entries. A batch code that never reached a
        // printer must not enter the reprint history, or the next genuine
        // print of it would be refused as a duplicate.
        logger.warn({ event: 'run.failed', runId: run.id, message: run.error.message });
        return run;
      }

      run.status = 'printed';
      await deps.auditLog.append({
        event: 'run.printed',
        runId: run.id,
        jobId: run.jobId,
        operator: run.operator,
        printer: run.printerAddress,
        transport: run.transport,
        dpi: run.dpi,
        labels: run.labels,
        lines: run.lines.length,
        reprint: run.isReprint,
        reason: run.reason,
      });

      // A line per batch code as well as a line per run, because the question
      // asked months later is almost always "where did this batch go".
      for (const line of run.lines) {
        await deps.auditLog.append({
          event: 'label.printed',
          runId: run.id,
          jobId: run.jobId,
          operator: run.operator,
          printer: run.printer,
          batchCode: line.batchCode,
          item: line.displayName,
          copies: line.copies,
          reprint: run.isReprint,
          reason: run.reason,
        });
      }

      logger.info({
        event: 'run.printed', runId: run.id, transport: run.transport, labels: run.labels,
      });
      return run;
    },

    /**
     * Compare a scanned label against what the run should have produced.
     *
     * A match verifies the run. A mismatch blocks it: the run stays incomplete
     * and the operator is told which code was expected and which was read,
     * because the difference is usually the diagnosis. A wrong batch means the
     * wrong line printed; an unreadable scan means the printer is the problem.
     *
     * @param {{ runId: string, scanned: string, operator: string }} request
     */
    async verify(request) {
      const run = requireRun(request.runId);
      const scanned = String(request.scanned ?? '').trim();
      const expected = run.lines.map((line) => line.batchCode).filter(Boolean);

      if (scanned === '') {
        throw new VerificationMismatchError('Nothing was scanned. Scan one printed label.');
      }

      const matched = expected.includes(scanned);
      const nearMiss = !matched
        && expected.find((code) => code.toUpperCase() === scanned.toUpperCase());

      run.verification = {
        at: now(), operator: request.operator, scanned, expected, matched,
      };

      await deps.auditLog.append({
        event: 'run.verified',
        runId: run.id,
        jobId: run.jobId,
        operator: request.operator,
        printer: run.printer,
        scanned,
        verified: matched,
      });

      if (!matched) {
        run.status = 'mismatch';
        throw new VerificationMismatchError(
          nearMiss
            ? `The scan read "${scanned}", which differs from "${nearMiss}" only in case. `
              + 'The barcode encodes exactly what was typed, so the label is wrong, not the scanner.'
            : `The scan read "${scanned}" but this run printed ${expected.map((c) => `"${c}"`).join(', ')}. `
              + 'Do not release these labels until the difference is understood.',
          { detail: `runId=${run.id}` },
        );
      }

      run.status = 'verified';
      logger.info({ event: 'run.verified', runId: run.id, operator: request.operator });
      return run;
    },
  };
}
