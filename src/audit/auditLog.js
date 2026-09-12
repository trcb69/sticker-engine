/**
 * Append-only print audit log.
 *
 * One line of JSON per event, never rewritten. This is the record that answers
 * "who printed this batch, when, and did anyone check it came out right" — a
 * question that gets asked months later, usually because something went wrong
 * downstream. Append-only because an audit trail that can be edited is not one.
 *
 * JSON Lines rather than a single document: an interrupted write costs the last
 * line rather than the whole file.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @typedef {object} AuditEntry
 * @property {string} at ISO 8601.
 * @property {string} event
 * @property {string} [runId]
 * @property {string} [jobId]
 * @property {string} [operator]
 * @property {string} [printer]
 * @property {string} [batchCode]
 * @property {number} [copies]
 * @property {string} [reason]
 * @property {boolean} [verified]
 */

/**
 * @param {{ path: string, now?: () => string,
 *           io?: { appendFile?: Function, readFile?: Function, mkdir?: Function } }} options
 */
export function createAuditLog(options) {
  const now = options.now ?? (() => new Date().toISOString());
  const io = options.io ?? {};
  const appendImpl = io.appendFile ?? appendFile;
  const readImpl = io.readFile ?? readFile;
  const mkdirImpl = io.mkdir ?? mkdir;

  return {
    /**
     * @param {Omit<AuditEntry, 'at'>} entry
     */
    async append(entry) {
      const record = { at: now(), ...entry };
      await mkdirImpl(dirname(options.path), { recursive: true });
      await appendImpl(options.path, `${JSON.stringify(record)}\n`, 'utf8');
      return record;
    },

    /** @returns {Promise<AuditEntry[]>} */
    async read() {
      let text;
      try {
        text = await readImpl(options.path, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      return text.split('\n').filter(Boolean).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          // A truncated final line from an interrupted write. Skipping it is
          // right; failing to read the whole log because of it is not.
          return null;
        }
      }).filter(Boolean);
    },

    /**
     * Every previous print of a batch code.
     *
     * A second label carrying a batch code already in circulation is a
     * traceability event, so this is what the reprint check consults.
     *
     * @param {string} batchCode
     * @returns {Promise<AuditEntry[]>}
     */
    async historyFor(batchCode) {
      const wanted = String(batchCode).trim().toUpperCase();
      const entries = await this.read();
      return entries.filter((entry) => entry.event === 'label.printed'
        && String(entry.batchCode ?? '').trim().toUpperCase() === wanted);
    },
  };
}
