/**
 * Upload handling.
 *
 * Type is decided by magic bytes, not by the filename. An extension is
 * attacker-controlled text; the first four bytes of a file are what the parser
 * will actually have to deal with.
 */

import multer from 'multer';
import { AppError } from '../../errors.js';

export class UploadRejectedError extends AppError {
  static code = 'UPLOAD_REJECTED';
  static httpStatus = 415;
}

export class UploadTooLargeError extends AppError {
  static code = 'UPLOAD_TOO_LARGE';
  static httpStatus = 413;
}

/** @type {{ mime: string, label: string, matches: (buffer: Buffer) => boolean }[]} */
export const SIGNATURES = [
  {
    mime: 'application/pdf',
    label: 'PDF',
    matches: (buffer) => buffer.subarray(0, 4).toString('latin1') === '%PDF',
  },
  {
    mime: 'image/png',
    label: 'PNG',
    matches: (buffer) => buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  },
  {
    mime: 'image/jpeg',
    label: 'JPEG',
    matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
];

/**
 * Identify a buffer by its leading bytes.
 * @param {Buffer} buffer
 * @returns {{ mime: string, label: string }|null}
 */
export function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  const found = SIGNATURES.find((signature) => signature.matches(buffer));
  return found ? { mime: found.mime, label: found.label } : null;
}

/**
 * @param {{ maxBytes: number, maxFiles?: number }} options
 */
export function uploadHandler(options) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: options.maxBytes, files: options.maxFiles ?? 3 },
  }).array('documents', options.maxFiles ?? 3);

  return (req, res, next) => {
    upload(req, res, (error) => {
      if (error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(new UploadTooLargeError(
            `Each document must be under ${Math.round(options.maxBytes / (1024 * 1024))} MB.`,
          ));
        }
        if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new UploadRejectedError(
            `Upload at most ${options.maxFiles ?? 3} documents, in a field named "documents".`,
          ));
        }
        return next(new UploadRejectedError('The upload could not be read.', { cause: error }));
      }
      return next();
    });
  };
}

/**
 * Validate uploaded buffers by content.
 * @param {Express.Multer.File[]|undefined} files
 * @returns {{ buffer: Buffer, originalName: string, mime: string, size: number }[]}
 */
export function validateUploads(files) {
  if (!files || files.length === 0) {
    throw new UploadRejectedError(
      'No documents were uploaded. Attach a Picklist, and a Sample Note if you have one.',
    );
  }
  return files.map((file) => {
    const detected = sniff(file.buffer);
    if (!detected) {
      throw new UploadRejectedError(
        `"${file.originalname}" is not a PDF, PNG or JPEG. ` +
        'Its contents do not match any of those, whatever the file is named.',
        { detail: `declared=${file.mimetype}` },
      );
    }
    return {
      buffer: file.buffer,
      originalName: file.originalname,
      mime: detected.mime,
      size: file.size,
    };
  });
}
