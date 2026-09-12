/**
 * Health probes.
 *
 * Each takes its side effect by injection, so the health endpoint is testable
 * without poppler installed and without a printer on the network.
 */

import net from 'node:net';
import { execFileRunner } from '../ingest/extract.js';

/**
 * @param {{ run?: typeof execFileRunner, binDir?: string }} [options]
 */
export function createPopplerProbe(options = {}) {
  const run = options.run ?? execFileRunner;
  const bin = options.binDir ? `${options.binDir}/pdftotext` : 'pdftotext';
  return async () => {
    try {
      // pdftotext prints its version to stderr and exits non-zero on some
      // builds, so the absence of a spawn error is the signal, not the code.
      const result = await run(bin, ['-v']);
      const version = /pdftotext version ([\d.]+)/i.exec(
        `${result.stdout ?? ''}${result.stderr ?? ''}`,
      );
      return { ok: true, detail: version ? `pdftotext ${version[1]}` : 'pdftotext present' };
    } catch {
      return {
        ok: false,
        detail: 'pdftotext is not available. Install poppler-utils; uploads cannot be read without it.',
      };
    }
  };
}

/**
 * @param {{ printers: Record<string, {host: string, port: number, dpi: number}>,
 *           connect?: Function, timeoutMs?: number }} options
 */
export function createPrinterProbe(options) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const connect = options.connect ?? defaultConnect;

  return async () => {
    const names = Object.keys(options.printers);
    if (names.length === 0) {
      return { ok: true, detail: 'No printers configured yet', printers: {} };
    }
    const results = {};
    await Promise.all(names.map(async (name) => {
      const printer = options.printers[name];
      results[name] = await connect(printer.host, printer.port, timeoutMs);
    }));
    const reachable = Object.values(results).filter(Boolean).length;
    return {
      ok: reachable === names.length,
      detail: `${reachable} of ${names.length} reachable`,
      printers: results,
    };
  };
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function defaultConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
