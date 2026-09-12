/**
 * Central error handling.
 *
 * Anything thrown anywhere ends up here and becomes the same shape. An
 * `AppError` carries a message already written for a warehouse operator;
 * anything else is a bug and is deliberately reduced to a generic message,
 * because the alternative is leaking a stack trace or a file path onto a screen
 * on the shop floor.
 */

import { AppError } from '../../errors.js';

/**
 * @param {{ logger?: { error: Function } }} [options]
 */
export function errorHandler(options = {}) {
  const logger = options.logger ?? console;

  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    const known = error instanceof AppError;
    const status = known ? error.httpStatus : 500;

    logger.error({
      event: 'http.error',
      requestId: req.id,
      method: req.method,
      route: req.route?.path ?? req.path,
      code: known ? error.code : 'INTERNAL_ERROR',
      status,
      message: error.message,
      detail: known ? error.detail : undefined,
      stack: known ? undefined : error.stack,
    });

    res.status(status).json({
      error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known
          ? error.message
          : 'Something went wrong. Quote the request id below when reporting it.',
        requestId: req.id,
      },
    });
  };
}

/** 404 for anything unrouted, in the same envelope as every other error. */
export function notFoundHandler() {
  return (req, res) => {
    res.status(404).json({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No such endpoint: ${req.method} ${req.path}`,
        requestId: req.id,
      },
    });
  };
}
