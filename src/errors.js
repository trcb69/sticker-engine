/**
 * Typed error hierarchy. Every message must be safe to show a warehouse
 * operator: no stack traces, no internal paths, no raw object dumps.
 */

/**
 * @typedef {object} AppErrorOptions
 * @property {string} [detail] Extra context appended for logs, not for the operator.
 * @property {unknown} [cause]
 */

export class AppError extends Error {
  /** @type {string} */ static code = 'APP_ERROR';
  /** @type {number} */ static httpStatus = 500;

  /**
   * @param {string} message Operator-safe message.
   * @param {AppErrorOptions} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = /** @type {typeof AppError} */ (new.target).code;
    this.httpStatus = /** @type {typeof AppError} */ (new.target).httpStatus;
    this.detail = options.detail;
  }

  /** @returns {{ code: string, message: string, detail?: string }} */
  toJSON() {
    return { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

export class TemplateValidationError extends AppError {
  static code = 'TEMPLATE_INVALID';
  static httpStatus = 500;
}

export class TemplateBindError extends AppError {
  static code = 'TEMPLATE_BIND_FAILED';
  static httpStatus = 500;
}

export class LayoutError extends AppError {
  static code = 'LAYOUT_FAILED';
  static httpStatus = 500;
}

export class QrPayloadTooLargeError extends AppError {
  static code = 'QR_PAYLOAD_TOO_LARGE';
  static httpStatus = 400;
}

export class UnknownDocumentError extends AppError {
  static code = 'DOCUMENT_UNRECOGNISED';
  static httpStatus = 422;
}

export class DocumentReadError extends AppError {
  static code = 'DOCUMENT_UNREADABLE';
  static httpStatus = 422;
}

export class DateFormatError extends AppError {
  static code = 'DATE_UNPARSEABLE';
  static httpStatus = 422;
}

export class JoinError extends AppError {
  static code = 'JOIN_FAILED';
  static httpStatus = 422;
}

export class ConfigError extends AppError {
  static code = 'CONFIG_INVALID';
  static httpStatus = 500;
}

export class PrinterUnreachableError extends AppError {
  static code = 'PRINTER_UNREACHABLE';
  static httpStatus = 502;
}

export class PrinterWriteError extends AppError {
  static code = 'PRINTER_WRITE_FAILED';
  static httpStatus = 502;
}

export class UnknownPrinterError extends AppError {
  static code = 'PRINTER_UNKNOWN';
  static httpStatus = 400;
}

export class ReprintReasonRequiredError extends AppError {
  static code = 'REPRINT_REASON_REQUIRED';
  static httpStatus = 409;
}

export class VerificationMismatchError extends AppError {
  static code = 'VERIFICATION_MISMATCH';
  static httpStatus = 409;
}

export class RunNotFoundError extends AppError {
  static code = 'RUN_NOT_FOUND';
  static httpStatus = 404;
}

export class RunAlreadySettledError extends AppError {
  static code = 'RUN_ALREADY_SETTLED';
  static httpStatus = 409;
}
