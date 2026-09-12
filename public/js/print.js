/**
 * The print flow.
 *
 * Four steps, in this order for a reason:
 *
 *   1. ask the server to prepare a run — this is where reprint gating happens,
 *      and it must happen before anything reaches a printer;
 *   2. check the printer says it can print;
 *   3. send the ZPL;
 *   4. tell the server what happened.
 *
 * Step 4 is what writes the audit trail. Nothing is recorded as printed until
 * a printer has actually been handed the label, because an audit trail that
 * records intentions rather than events is not one.
 */

import * as api from './api.js';
import * as browserPrint from './browserPrint.js';
import * as webusb from './webusb.js';

/**
 * The two ways a page can reach a USB printer. Both expose the same two
 * functions, so the flow below does not care which is in use — which is the
 * point: WebUSB needs no install but Windows may not release the printer to
 * it, and Browser Print always works but needs its helper application and an
 * origin it is allowed to call. A site can end up needing either.
 */
const TRANSPORTS = { browser: browserPrint, webusb };

/**
 * @param {string} transport
 * @returns {{ checkReady: Function, sendZpl: Function }}
 */
function deliveryFor(transport) {
  const impl = TRANSPORTS[transport];
  if (!impl) {
    const error = new Error(`No delivery is implemented for the "${transport}" transport.`);
    error.code = 'TRANSPORT_UNKNOWN';
    throw error;
  }
  return impl;
}

/** Remembered per origin: a workstation has one printer and picking it every shift is friction. */
const DEVICE_KEY = 'sticker.device.uid';

/** @returns {string|null} */
export function rememberedDeviceUid() {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    // Private browsing, or storage disabled by policy. Not worth failing over.
    return null;
  }
}

/** @param {string} uid */
export function rememberDevice(uid) {
  try {
    localStorage.setItem(DEVICE_KEY, uid);
  } catch { /* as above */ }
}

/**
 * @typedef {object} PrintRequest
 * @property {string} jobId
 * @property {number[]} lines
 * @property {number} dpi
 * @property {string|null} reason
 * @property {object|null} device      The printer handle, for the browser and
 *                                     webusb transports: a Browser Print device
 *                                     or a USBDevice respectively.
 * @property {string} printerName
 * @property {'browser'|'webusb'|'network'} transport
 */

/**
 * @param {PrintRequest} request
 * @param {(stage: string, detail?: string) => void} onProgress
 * @returns {Promise<{ run: object, verify: boolean }>}
 */
export async function runPrint(request, onProgress = () => {}) {
  onProgress('preparing');
  const prepared = await api.startPrint(request.jobId, {
    printer: request.printerName,
    lines: request.lines,
    dpi: request.dpi,
    transport: request.transport,
    reason: request.reason ?? null,
  });

  if (request.transport === 'network') {
    onProgress('done');
    return { run: prepared.run, verify: true };
  }

  const { run, zpl } = prepared;
  const delivery = deliveryFor(request.transport);

  // From here the run exists and is pending, so every path below has to settle
  // it. A run left pending is a job nobody can account for.
  try {
    onProgress('checking');
    const ready = await delivery.checkReady(request.device);
    if (ready.known && !ready.ready) {
      const error = new Error(ready.message);
      error.code = 'PRINTER_NOT_READY';
      throw error;
    }

    onProgress('sending', `${zpl.length} bytes`);
    await delivery.sendZpl(request.device, zpl);
  } catch (error) {
    await api.reportSent(run.id, {
      ok: false,
      deviceName: request.printerName,
      error: error.message,
    }).catch(() => {});
    throw error;
  }

  onProgress('recording');
  const settled = await api.reportSent(run.id, { ok: true, deviceName: request.printerName });
  onProgress('done');
  return { run: settled.run, verify: true };
}
