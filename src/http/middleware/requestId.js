/**
 * Request identity and structured logging.
 *
 * One rule governs everything logged here: never the contents of a document.
 * Uploads carry customer names, addresses and order numbers, and a log file is
 * the wrong place for them. Sizes, types and timings are logged; bytes and
 * extracted values are not.
 */

import { randomUUID } from 'node:crypto';

/**
 * @param {{ id?: () => string }} [options]
 */
export function requestId(options = {}) {
  const id = options.id ?? randomUUID;
  return (req, res, next) => {
    req.id = req.get('x-request-id') ?? `req_${id()}`;
    res.set('x-request-id', req.id);
    next();
  };
}

/**
 * @param {{ logger?: { info: Function }, now?: () => number }} [options]
 */
export function requestLogging(options = {}) {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => Date.now());

  return (req, res, next) => {
    const startedAt = now();
    res.on('finish', () => {
      logger.info({
        event: 'http.request',
        requestId: req.id,
        method: req.method,
        // The routed path, not the URL: a short code or job id in the path is
        // an identifier, and identifiers do not belong in an aggregate log.
        route: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs: now() - startedAt,
        // Uploads are described, never recorded.
        uploads: req.files?.map((file) => ({
          bytes: file.size,
          mimetype: file.mimetype,
        })),
      });
    });
    next();
  };
}
