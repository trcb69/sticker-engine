/**
 * Server calls.
 *
 * Every error the API returns is already written for an operator, so this
 * layer keeps the message intact rather than replacing it with something
 * generic. The request id travels with it, which is what makes a support call
 * solvable.
 */
import { url } from './base.js';

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, requestId?: string }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = meta.code ?? 'UNKNOWN';
    this.status = meta.status ?? 0;
    this.requestId = meta.requestId ?? null;
  }
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    throw new ApiError('Lost contact with the label service. Check the connection and try again.', {
      code: 'NETWORK',
    });
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = typeof body === 'object' ? body.error ?? {} : {};
    throw new ApiError(error.message ?? 'The request failed.', {
      code: error.code,
      status: response.status,
      requestId: error.requestId,
    });
  }
  return body;
}

/** @param {File[]} files */
export function createJob(files) {
  const form = new FormData();
  for (const file of files) form.append('documents', file, file.name);
  return call(url('/api/jobs'), { method: 'POST', body: form });
}

/** @param {string} id */
export const getJob = (id) => call(`/api/jobs/${id}`);

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export const patchJob = (id, patch) => call(`/api/jobs/${id}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(patch),
});

/**
 * @param {string} id
 * @param {number} index
 * @param {Record<string, unknown>} patch
 */
export const patchLine = (id, index, patch) => call(`/api/jobs/${id}/lines/${index}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(patch),
});

/**
 * @param {string} id
 * @param {number} index
 * @param {number} dpi
 */
export const previewLine = (id, index, dpi) =>
  call(`/api/jobs/${id}/lines/${index}/preview?dpi=${dpi}`, { method: 'POST' });

/** @param {number} dpi */
export const getTemplate = (dpi) => call(`/api/template?dpi=${dpi}`);

/** @param {string} url */
export const shorten = (url) => call(url('/api/shortlinks'), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url }),
});

export const getHealth = () => call(url('/api/health'));

/**
 * Ask the server to prepare a run.
 *
 * In browser mode this returns the ZPL for the browser to deliver; the run
 * stays pending until `reportSent` says what happened to it.
 *
 * @param {string} id
 * @param {{ printer: string, lines: number[], dpi: number, transport?: string,
 *           reason?: string|null, operator?: string }} body
 */
export const startPrint = (id, body) => call(`/api/jobs/${id}/print`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * @param {string} runId
 * @param {{ ok: boolean, deviceName?: string, error?: string }} body
 */
export const reportSent = (runId, body) => call(`/api/runs/${runId}/sent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * @param {string} runId
 * @param {string} scanned
 */
export const verifyRun = (runId, scanned) => call(`/api/runs/${runId}/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scanned }),
});
export const getPrinters = () => call(url('/api/printers'));

/**
 * @param {string} id
 * @param {number[]} lines
 * @param {number} dpi
 */
export function zplUrl(id, lines, dpi) {
  const query = new URLSearchParams({ dpi: String(dpi) });
  if (lines.length > 0) query.set('lines', lines.join(','));
  return `/api/jobs/${id}/zpl?${query}`;
}
