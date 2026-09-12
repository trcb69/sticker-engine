/**
 * Raw TCP transport to a Zebra printer.
 *
 * There is no driver and no spooler: a Zebra listens on port 9100 and prints
 * whatever ZPL arrives. That simplicity is also the hazard — the printer
 * acknowledges nothing, reports nothing, and will happily consume a malformed
 * job in silence. So everything that can be checked here is checked here, and
 * anything that cannot is said out loud rather than assumed.
 *
 * The socket factory is injected, so the whole module is testable without a
 * printer on the network.
 */

import net from 'node:net';
import { PrinterUnreachableError, PrinterWriteError, UnknownPrinterError } from '../errors.js';

/** Control characters that wrap a Zebra's replies. */
const STX = '\x02';
const ETX = '\x03';

/**
 * @typedef {object} PrinterConfig
 * @property {string} host
 * @property {number} port
 * @property {number} dpi
 */

/**
 * @typedef {object} Transport
 * @property {(printer: PrinterConfig, payload: string, options?: object) => Promise<void>} send
 * @property {(printer: PrinterConfig, payload: string, options?: object) => Promise<string>} ask
 */

/**
 * Default transport over a real socket.
 * @param {{ connect?: Function, connectTimeoutMs?: number, writeTimeoutMs?: number,
 *           replyTimeoutMs?: number }} [options]
 * @returns {Transport}
 */
export function createSocketTransport(options = {}) {
  const connect = options.connect ?? ((opts) => net.createConnection(opts));
  const connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  const writeTimeoutMs = options.writeTimeoutMs ?? 5000;
  const replyTimeoutMs = options.replyTimeoutMs ?? 1500;

  /**
   * @param {PrinterConfig} printer
   * @param {string} payload
   * @param {{ expectReply?: boolean, replyTimeoutMs?: number }} [opts]
   * @returns {Promise<string>}
   */
  function talk(printer, payload, opts = {}) {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: printer.host, port: printer.port });
      let settled = false;
      let reply = '';
      /** @type {NodeJS.Timeout|null} */
      let replyTimer = null;

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (replyTimer) clearTimeout(replyTimer);
        socket.destroy();
        if (error) reject(error); else resolve(value);
      };

      socket.setTimeout(connectTimeoutMs);
      socket.once('timeout', () => finish(new PrinterUnreachableError(
        `${printer.host}:${printer.port} did not answer within ${connectTimeoutMs / 1000} seconds. ` +
        'Check the printer is switched on and on the network.',
        { detail: `phase=connect host=${printer.host} port=${printer.port}` },
      )));
      socket.once('error', (cause) => finish(new PrinterUnreachableError(
        `Could not reach the printer at ${printer.host}:${printer.port}.`,
        { cause, detail: cause?.code },
      )));

      socket.once('connect', () => {
        socket.setTimeout(writeTimeoutMs);
        socket.write(payload, 'binary', (error) => {
          if (error) {
            finish(new PrinterWriteError(
              `The printer at ${printer.host}:${printer.port} accepted the connection but not the data.`,
              { cause: error },
            ));
            return;
          }
          if (!opts.expectReply) {
            // Nothing comes back from a print job, so a completed write is the
            // only signal there is. It confirms the bytes left this machine —
            // not that a label came out.
            finish(null, '');
            return;
          }
          replyTimer = setTimeout(() => finish(null, reply), opts.replyTimeoutMs ?? replyTimeoutMs);
        });
      });

      socket.on('data', (chunk) => {
        reply += chunk.toString('binary');
        if (reply.includes(ETX) && opts.expectReply) {
          // A complete reply arrived early; no need to wait out the timer.
          if (replyTimer) clearTimeout(replyTimer);
          replyTimer = setTimeout(() => finish(null, reply), 120);
        }
      });
    });
  }

  return {
    async send(printer, payload, opts) { await talk(printer, payload, opts); },
    ask(printer, payload, opts) { return talk(printer, payload, { ...opts, expectReply: true }); },
  };
}

/**
 * A printer client: graphic checks, host status, and sending a job.
 *
 * @param {{ transport: Transport, printers: Record<string, PrinterConfig>,
 *           logoZpl?: string|null, logoObject?: string,
 *           logger?: { info: Function, warn: Function } }} options
 */
export function createPrinterClient(options) {
  const { transport } = options;
  const logoObject = options.logoObject ?? 'R:LOGO.GRF';
  const logger = options.logger ?? { info() {}, warn() {} };
  /** @type {Map<string, 'present'|'sent'|'unverifiable'>} */
  const graphicState = new Map();

  /**
   * @param {string} name
   * @returns {PrinterConfig & { name: string }}
   */
  function resolve(name) {
    const printer = options.printers[name];
    if (!printer) {
      const known = Object.keys(options.printers);
      throw new UnknownPrinterError(
        known.length
          ? `There is no printer called "${name}". Configured: ${known.join(', ')}.`
          : 'No printers are configured. Set STICKER_PRINTERS.',
        { detail: `requested=${name}` },
      );
    }
    return { ...printer, name };
  }

  return {
    resolve,

    /**
     * Host status via `~HS`.
     *
     * Documented caveat: many networked Zebras never answer this. Older
     * firmware, print servers and some ZD models simply stay quiet, and a
     * silent printer here is not a broken printer. So a missing reply is
     * reported as `unknown` rather than as a fault — treating it as a fault
     * would block printing on perfectly healthy hardware.
     *
     * @param {string} name
     */
    async status(name) {
      const printer = resolve(name);
      let reply = '';
      try {
        reply = await transport.ask(printer, '~HS');
      } catch (error) {
        return { answered: false, reachable: false, detail: error.message };
      }
      if (!reply.trim()) {
        return {
          answered: false,
          reachable: true,
          detail: 'The printer accepted the connection but did not answer ~HS. '
            + 'Many networked Zebras never do; this is not a fault.',
        };
      }
      return { answered: true, reachable: true, ...parseHostStatus(reply) };
    },

    /**
     * Make sure the logo is in printer memory before a run.
     *
     * The label recalls the logo with `^XG`. If the object is missing the
     * printer prints a blank space and reports nothing — the labels come out
     * looking almost right, which is the worst kind of wrong.
     *
     * `R:` is RAM and clears on a power cycle, so this is checked once per
     * printer per process. When the printer will not answer the directory
     * query, the graphic is sent anyway: a few kilobytes once is cheap next to
     * a pallet of logo-less labels.
     *
     * @param {string} name
     */
    async ensureGraphic(name) {
      const printer = resolve(name);
      if (graphicState.has(name)) return graphicState.get(name);
      if (!options.logoZpl) {
        graphicState.set(name, 'unverifiable');
        return 'unverifiable';
      }

      const device = logoObject.split(':')[0];
      let listing = '';
      try {
        listing = await transport.ask(printer, `^XA^HW${device}:*.GRF^XZ`);
      } catch (error) {
        logger.warn({ event: 'printer.graphic_check_failed', printer: name, error: error.message });
      }

      const objectName = logoObject.split(':')[1];
      if (listing.includes(objectName)) {
        graphicState.set(name, 'present');
        return 'present';
      }

      await transport.send(printer, options.logoZpl);
      graphicState.set(name, listing ? 'sent' : 'unverifiable');
      logger.info({
        event: 'printer.graphic_sent',
        printer: name,
        verified: Boolean(listing),
      });
      return graphicState.get(name);
    },

    /**
     * @param {string} name
     * @param {string} zpl
     */
    async print(name, zpl) {
      const printer = resolve(name);
      await transport.send(printer, zpl);
    },

    /** Forget cached graphic state, e.g. after a printer is power cycled. */
    forget(name) {
      if (name) graphicState.delete(name); else graphicState.clear();
    },
  };
}

/**
 * Parse a `~HS` reply.
 *
 * Three comma-separated strings wrapped in STX/ETX. The field positions are
 * fixed by the ZPL manual and are not self-describing, so they are named here
 * rather than indexed at the call site:
 *
 *   String 1: settings, paperOut, paused, labelLength, formatsInBuffer,
 *             bufferFull, diagnosticMode, partialFormat, unused, corruptRam,
 *             underTemperature, overTemperature
 *   String 2: settings, unused, headUp, ribbonOut, thermalTransfer, printMode,
 *             printWidthMode, labelWaiting, labelsRemaining, formatWhilePrinting,
 *             graphicsStored
 *
 * Only the fields that change what an operator should do are lifted out; `raw`
 * keeps the rest for whoever is debugging a specific model.
 *
 * @param {string} reply
 */
export function parseHostStatus(reply) {
  const lines = reply
    .split('\r\n')
    .map((line) => line.replaceAll(STX, '').replaceAll(ETX, '').trim())
    .filter(Boolean);
  const one = (lines[0] ?? '').split(',');
  const two = (lines[1] ?? '').split(',');
  const flag = (fields, index) => fields[index] === '1';
  const count = (fields, index) => Number(fields[index] ?? 0) || 0;

  return {
    paperOut: flag(one, 1),
    paused: flag(one, 2),
    labelLengthDots: count(one, 3),
    formatsInBuffer: count(one, 4),
    bufferFull: flag(one, 5),
    corruptRam: flag(one, 9),
    underTemperature: flag(one, 10),
    // An overheating printhead is the first sign of a run that is about to
    // start producing weak bars, which is exactly what scan-back catches.
    overTemperature: flag(one, 11),
    headUp: flag(two, 2),
    ribbonOut: flag(two, 3),
    labelWaiting: flag(two, 7),
    labelsRemaining: count(two, 8),
    graphicsStored: count(two, 10),
    raw: lines,
  };
}
