/**
 * Per-printer print queue.
 *
 * Jobs to one printer are serialised. Two operators pressing Print at the same
 * moment would otherwise interleave their ZPL on the wire, and a Zebra parses
 * a byte stream — a `^XA` arriving inside another label's field data produces
 * garbage on both runs, and neither operator sees anything go wrong.
 *
 * Queues are per printer rather than global: two printers should work at once.
 */

/**
 * @param {{ logger?: { info: Function, warn: Function } }} [options]
 */
export function createPrintQueue(options = {}) {
  const logger = options.logger ?? { info() {}, warn() {} };
  /** @type {Map<string, Promise<unknown>>} */
  const tails = new Map();
  /** @type {Map<string, number>} */
  const depth = new Map();

  return {
    /**
     * @template T
     * @param {string} printerName
     * @param {() => Promise<T>} work
     * @returns {Promise<T>}
     */
    submit(printerName, work) {
      const waiting = (depth.get(printerName) ?? 0) + 1;
      depth.set(printerName, waiting);
      if (waiting > 1) {
        logger.info({ event: 'print.queued', printer: printerName, ahead: waiting - 1 });
      }

      const previous = tails.get(printerName) ?? Promise.resolve();
      const run = previous
        // The queue must survive a failed job: one printer error should delay
        // the next operator, not deadlock the printer for the rest of the day.
        .catch(() => {})
        .then(work)
        .finally(() => {
          const remaining = (depth.get(printerName) ?? 1) - 1;
          if (remaining > 0) depth.set(printerName, remaining); else depth.delete(printerName);
        });

      tails.set(printerName, run.catch(() => {}));
      return run;
    },

    /** @param {string} printerName */
    depthOf(printerName) {
      return depth.get(printerName) ?? 0;
    },

    /** Wait for every queue to drain, for a clean shutdown. */
    async drain() {
      await Promise.allSettled([...tails.values()]);
    },
  };
}
