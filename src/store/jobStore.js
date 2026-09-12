/**
 * Job store.
 *
 * A job lives in memory while an operator works through it, then is archived
 * to disk when its labels are printed. The split is deliberate: an open job
 * changes on every keystroke and belongs in memory, whereas a printed job is a
 * traceability record and has to outlive the process.
 *
 * The interface below is the whole contract. Route handlers never see a Map, a
 * timer or a file path, so replacing this with a database later is one module.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../errors.js';

export class JobNotFoundError extends AppError {
  static code = 'JOB_NOT_FOUND';
  static httpStatus = 404;
}

export class LineNotFoundError extends AppError {
  static code = 'LINE_NOT_FOUND';
  static httpStatus = 404;
}

/**
 * @typedef {object} StoredJob
 * @property {import('../model/types.js').LabelJob} job
 * @property {string[]} warnings          From ingestion.
 * @property {object[]} enrichWarnings    From the last enrichment pass.
 * @property {object} buckets
 * @property {string[]} stagedFiles       Paths to remove when the job expires.
 * @property {number} expiresAt           Epoch milliseconds.
 */

/**
 * @param {{ fileStore: import('./files.js').FileStore, ttlSeconds?: number,
 *           archiveDir?: string, now?: () => number, id?: () => string,
 *           logger?: { info: Function, warn: Function },
 *           io?: { mkdir?: Function, writeFile?: Function, readFile?: Function } }} options
 */
export function createJobStore(options) {
  const { fileStore } = options;
  const ttlMs = (options.ttlSeconds ?? 1800) * 1000;
  const archiveDir = options.archiveDir ?? './data/jobs';
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const logger = options.logger ?? { info() {}, warn() {} };
  const io = options.io ?? {};

  /** @type {Map<string, StoredJob>} */
  const jobs = new Map();
  /** @type {NodeJS.Timeout|null} */
  let timer = null;

  const touch = (record) => { record.expiresAt = now() + ttlMs; return record; };

  const require_ = (jobId) => {
    const record = jobs.get(jobId);
    if (!record) {
      throw new JobNotFoundError(
        'That job has expired or does not exist. Upload the documents again.',
        { detail: `jobId=${jobId}` },
      );
    }
    return touch(record);
  };

  return {
    /**
     * @param {{ job: import('../model/types.js').LabelJob, warnings?: string[],
     *           enrichWarnings?: object[], buckets?: object, stagedFiles?: string[] }} input
     * @returns {StoredJob}
     */
    create(input) {
      const record = touch({
        job: { ...input.job, id: input.job.id ?? id() },
        warnings: input.warnings ?? [],
        enrichWarnings: input.enrichWarnings ?? [],
        buckets: input.buckets ?? { matched: [], orderedOnly: [], picklistOnly: [] },
        stagedFiles: input.stagedFiles ?? [],
        expiresAt: 0,
      });
      jobs.set(record.job.id, record);
      return record;
    },

    /** @param {string} jobId */
    get(jobId) {
      return require_(jobId);
    },

    /** @param {string} jobId */
    has(jobId) {
      return jobs.has(jobId);
    },

    /**
     * Replace job-level fields. The caller supplies the already-validated
     * patch; this only stores it and resets the expiry.
     * @param {string} jobId
     * @param {Partial<import('../model/types.js').LabelJob>} patch
     */
    patchJob(jobId, patch) {
      const record = require_(jobId);
      record.job = { ...record.job, ...patch };
      return record;
    },

    /**
     * @param {string} jobId
     * @param {number} index 1-based, as printed on the document.
     * @param {Partial<import('../model/types.js').LabelLine>} patch
     */
    patchLine(jobId, index, patch) {
      const record = require_(jobId);
      const position = record.job.lines.findIndex((line) => line.index === index);
      if (position === -1) {
        throw new LineNotFoundError(
          `This job has no line ${index}.`,
          { detail: `jobId=${jobId} lines=${record.job.lines.map((l) => l.index).join(',')}` },
        );
      }
      const lines = [...record.job.lines];
      lines[position] = { ...lines[position], ...patch };
      record.job = { ...record.job, lines };
      return record;
    },

    /**
     * Replace the enrichment result wholesale. Enrichment is a pure function of
     * the job, so it is recomputed rather than patched.
     * @param {string} jobId
     * @param {{ job: import('../model/types.js').LabelJob, warnings: object[] }} result
     */
    setEnriched(jobId, result) {
      const record = require_(jobId);
      record.job = result.job;
      record.enrichWarnings = result.warnings;
      return record;
    },

    /** @returns {{ id: string, createdAt: string, lines: number, ready: number, expiresAt: number }[]} */
    list() {
      return [...jobs.values()].map((record) => ({
        id: record.job.id,
        createdAt: record.job.createdAt,
        lines: record.job.lines.length,
        ready: record.job.lines.filter((line) => line.status === 'ready').length,
        expiresAt: record.expiresAt,
      }));
    },

    /** @param {string} jobId */
    async delete(jobId) {
      const record = jobs.get(jobId);
      if (!record) return false;
      jobs.delete(jobId);
      await removeStaged(record);
      return true;
    },

    /**
     * Archive a job to disk so a reprint months later needs no re-upload.
     *
     * The staged PDFs are still discarded — the archive holds the parsed job,
     * which is what a reprint actually needs, and keeping every uploaded
     * document forever is a storage problem nobody asked for.
     *
     * @param {string} jobId
     * @returns {Promise<string>} archive path
     */
    async archive(jobId) {
      const record = require_(jobId);
      const mkdirImpl = io.mkdir ?? mkdir;
      const writeImpl = io.writeFile ?? writeFile;
      await mkdirImpl(archiveDir, { recursive: true });
      const path = join(archiveDir, `${record.job.id}.json`);
      await writeImpl(path, `${JSON.stringify({
        archivedAt: new Date(now()).toISOString(),
        job: record.job,
        warnings: record.warnings,
        enrichWarnings: record.enrichWarnings,
        buckets: record.buckets,
      }, null, 2)}\n`, 'utf8');
      logger.info({ event: 'job.archived', jobId: record.job.id, path });
      return path;
    },

    /**
     * @param {string} jobId
     * @returns {Promise<object|null>}
     */
    async readArchived(jobId) {
      const readImpl = io.readFile ?? readFile;
      try {
        return JSON.parse(await readImpl(join(archiveDir, `${jobId}.json`), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    /**
     * Remove expired jobs and their staged uploads. Exposed so tests can drive
     * it directly instead of waiting on a timer.
     * @returns {Promise<number>} how many were swept
     */
    async sweep() {
      const deadline = now();
      let swept = 0;
      for (const [jobId, record] of jobs) {
        if (record.expiresAt > deadline) continue;
        jobs.delete(jobId);
        await removeStaged(record);
        swept += 1;
        logger.info({ event: 'job.expired', jobId });
      }
      return swept;
    },

    /** @param {number} [intervalMs] */
    startSweeper(intervalMs = 60000) {
      if (timer) return;
      timer = setInterval(() => {
        this.sweep().catch((error) => logger.warn({ event: 'job.sweep_failed', error: error.message }));
      }, intervalMs);
      timer.unref?.();
    },

    stopSweeper() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    get size() {
      return jobs.size;
    },
  };

  /** @param {StoredJob} record */
  async function removeStaged(record) {
    for (const path of record.stagedFiles) {
      try {
        await fileStore.remove(path);
      } catch (error) {
        logger.warn({ event: 'upload.remove_failed', path, error: error.message });
      }
    }
  }
}
