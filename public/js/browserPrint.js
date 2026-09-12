/**
 * Zebra Browser Print, wrapped.
 *
 * A Zebra on USB cannot be reached by a server, so the browser delivers the
 * ZPL itself. Zebra's Browser Print is a small application installed per
 * workstation plus a JavaScript library that hands raw ZPL to a locally
 * connected printer. The label is byte-identical to what the network path
 * would send: only the delivery changes.
 *
 * Zebra's library is callback-based and reports every failure as an opaque
 * string. This wrapper turns it into promises and typed errors, and — more
 * usefully — distinguishes the handful of failures that actually happen in a
 * warehouse from each other, because "unavailable" covers four different
 * problems with four different fixes.
 */
import { url } from './base.js';

/** How long to wait before deciding the local application is not there. */
const AVAILABILITY_TIMEOUT_MS = 3000;

/** Where Zebra's library is vendored. */
const LIBRARY_URL = url('/vendor/BrowserPrint.js');
const ZEBRA_LIBRARY_URL = url('/vendor/BrowserPrint-Zebra.js');

export class BrowserPrintError extends Error {
  /**
   * @param {string} code
   * @param {string} message Operator-safe.
   * @param {{ detail?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'BrowserPrintError';
    this.code = code;
    this.detail = options.detail;
    this.cause = options.cause;
  }
}

/**
 * The page is on HTTPS but Browser Print's local service is plain HTTP.
 *
 * A browser blocks that as mixed content, and the failure is indistinguishable
 * from the application not being installed — which is how an afternoon gets
 * lost. Detected up front so the message can say which problem it is.
 * @returns {boolean}
 */
export function isMixedContentBlocked() {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

/** @type {Promise<boolean>|null} */
let libraryLoad = null;

/**
 * Load Zebra's library from our own origin.
 *
 * Not from a CDN: a warehouse machine may have no route out, and a page that
 * dies when the internet does is worse than one that never depended on it.
 * @returns {Promise<boolean>}
 */
function loadLibrary() {
  if (libraryLoad) return libraryLoad;
  libraryLoad = new Promise((resolve) => {
    if (typeof window === 'undefined') { resolve(false); return; }
    if (window.BrowserPrint) { resolve(true); return; }

    const script = document.createElement('script');
    script.src = LIBRARY_URL;
    script.onload = () => {
      // The Zebra device wrapper adds isReadyToPrint. Optional: without it the
      // printer's state is simply not checked before sending.
      const zebra = document.createElement('script');
      zebra.src = ZEBRA_LIBRARY_URL;
      zebra.onload = () => resolve(Boolean(window.BrowserPrint));
      zebra.onerror = () => resolve(Boolean(window.BrowserPrint));
      document.head.append(zebra);
    };
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  return libraryLoad;
}

/**
 * Promisify one of Zebra's callback pairs, with a deadline.
 * @template T
 * @param {(resolve: (value: T) => void, reject: (error: unknown) => void) => void} run
 * @param {number} timeoutMs
 * @param {() => BrowserPrintError} onTimeout
 * @returns {Promise<T>}
 */
function withTimeout(run, timeoutMs, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(onTimeout());
    }, timeoutMs);
    const done = (fn) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    run(done(resolve), done(reject));
  });
}

/**
 * Is the local Browser Print application running and reachable?
 *
 * Never throws and never hangs. A workstation that has not had the application
 * installed must not present as a frozen page — it must say so in a sentence.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, version?: string, code?: string, message?: string }>}
 */
export async function isAvailable(options = {}) {
  const timeoutMs = options.timeoutMs ?? AVAILABILITY_TIMEOUT_MS;

  if (!(await loadLibrary())) {
    return {
      ok: false,
      code: 'BROWSER_PRINT_UNAVAILABLE',
      message: `Zebra's library is missing from this server (${LIBRARY_URL}). `
        + 'Download Browser Print from Zebra and copy BrowserPrint.js into public/vendor/.',
    };
  }

  try {
    const config = await withTimeout(
      (resolve, reject) => window.BrowserPrint.getApplicationConfiguration(resolve, reject),
      timeoutMs,
      () => new BrowserPrintError('BROWSER_PRINT_UNAVAILABLE', 'timed out'),
    );
    return { ok: true, version: config?.application?.version ?? config?.version ?? 'unknown' };
  } catch (cause) {
    return {
      ok: false,
      code: 'BROWSER_PRINT_UNAVAILABLE',
      message: isMixedContentBlocked()
        ? 'This page is served over HTTPS, and Browser Print listens on plain HTTP, so the '
          + 'browser is blocking the connection. Either open this page over http:// on the '
          + 'local network, or configure Browser Print\'s HTTPS endpoint and trust its '
          + 'certificate on this machine.'
        : 'Zebra Browser Print is not running on this computer. It is a tray application — '
          + 'check the system tray, and start it if it is not there.',
      detail: String(cause?.message ?? cause),
    };
  }
}

/**
 * Every printer this machine can see, default first.
 *
 * Zebra's guidance is to ask for the default and run discovery together on
 * page load: discovery is slow when network and Bluetooth scanning are on, and
 * showing the default straight away makes it feel immediate. A missing default
 * is normal, not an error.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ devices: object[], defaultUid: string|null }>}
 */
export async function listPrinters(options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  if (!(await loadLibrary())) {
    throw new BrowserPrintError('BROWSER_PRINT_UNAVAILABLE',
      'Zebra Browser Print is not available on this computer.');
  }

  const defaultDevice = await withTimeout(
    (resolve) => window.BrowserPrint.getDefaultDevice('printer', resolve, () => resolve(null)),
    timeoutMs,
    () => new BrowserPrintError('BROWSER_PRINT_UNAVAILABLE', 'timed out asking for the default printer'),
  ).catch(() => null);

  const discovered = await withTimeout(
    (resolve) => window.BrowserPrint.getLocalDevices(resolve, () => resolve([]), 'printer'),
    timeoutMs,
    () => new BrowserPrintError('BROWSER_PRINT_UNAVAILABLE', 'timed out discovering printers'),
  ).catch(() => []);

  // getLocalDevices answers with a list on some versions and a map keyed by
  // device type on others. Both shapes are flattened here rather than in three
  // call sites.
  const list = Array.isArray(discovered)
    ? discovered
    : Object.values(discovered ?? {}).flat();

  /** @type {Map<string, object>} */
  const byUid = new Map();
  if (defaultDevice) byUid.set(defaultDevice.uid, defaultDevice);
  for (const device of list) {
    if (device?.uid && !byUid.has(device.uid)) byUid.set(device.uid, device);
  }

  if (byUid.size === 0) {
    throw new BrowserPrintError(
      'BROWSER_PRINT_NO_DEVICE',
      'No printer was found on this computer. Check the USB cable is connected and the '
      + 'printer is switched on, then reload the page.',
    );
  }

  return { devices: [...byUid.values()], defaultUid: defaultDevice?.uid ?? null };
}

/**
 * Ask the printer whether it can print, before sending anything.
 *
 * Only available when Zebra's device wrapper loaded. Finding out about paper
 * out after sending a run of forty labels is not finding out in time.
 *
 * @param {object} device
 * @returns {Promise<{ known: boolean, ready: boolean, message?: string }>}
 */
export async function checkReady(device) {
  if (typeof device?.isReadyToPrint !== 'function') return { known: false, ready: true };
  try {
    const ready = await withTimeout(
      (resolve) => device.isReadyToPrint(resolve),
      4000,
      () => new BrowserPrintError('BROWSER_PRINT_NOT_READY', 'timed out'),
    );
    if (ready) return { known: true, ready: true };
  } catch {
    return { known: false, ready: true, message: 'The printer did not answer a status check.' };
  }

  let detail = '';
  if (typeof device.getStatus === 'function') {
    detail = await withTimeout(
      (resolve) => device.getStatus((status) => resolve(describeStatus(status)), () => resolve('')),
      4000,
      () => new BrowserPrintError('BROWSER_PRINT_NOT_READY', 'timed out'),
    ).catch(() => '');
  }
  return {
    known: true,
    ready: false,
    message: detail || 'The printer reports it is not ready to print.',
  };
}

/**
 * @param {object} status
 * @returns {string}
 */
function describeStatus(status) {
  const faults = [
    status?.isPaperOut && 'out of paper',
    status?.isHeadOpen && 'the printhead is open',
    status?.isRibbonOut && 'out of ribbon',
    status?.isPaused && 'paused',
  ].filter(Boolean);
  if (faults.length === 0) return '';
  return `The printer is ${faults.join(', ')}.`;
}

/**
 * Send raw ZPL to a device.
 * @param {object} device
 * @param {string} zpl
 * @returns {Promise<void>}
 */
export async function sendZpl(device, zpl) {
  if (!device) {
    throw new BrowserPrintError('BROWSER_PRINT_NO_DEVICE', 'No printer is selected.');
  }
  try {
    await withTimeout(
      (resolve, reject) => device.send(zpl, resolve, reject),
      20000,
      () => new BrowserPrintError('BROWSER_PRINT_SEND_FAILED', 'timed out'),
    );
  } catch (cause) {
    throw new BrowserPrintError(
      'BROWSER_PRINT_SEND_FAILED',
      `The printer would not accept the labels. ${
        typeof cause?.message === 'string' && cause.message !== 'timed out'
          ? 'Check it is switched on and not showing an error.'
          : 'It did not respond in time.'}`,
      // Zebra's own wording goes in the detail, where it helps whoever is
      // debugging without confusing whoever is printing.
      { detail: String(cause?.message ?? cause), cause },
    );
  }
}

/**
 * Drain whatever the printer has said. Diagnostics only.
 * @param {object} device
 * @returns {Promise<string>}
 */
export async function readBack(device) {
  if (typeof device?.readAllAvailable !== 'function') return '';
  return withTimeout(
    (resolve, reject) => device.readAllAvailable(resolve, reject),
    3000,
    () => new BrowserPrintError('BROWSER_PRINT_SEND_FAILED', 'timed out reading back'),
  ).catch(() => '');
}

/** Reset the cached library load. Tests only. */
export function resetForTests() {
  libraryLoad = null;
}
