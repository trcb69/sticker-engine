/**
 * WebUSB transport.
 *
 * The other way to reach a USB printer from a browser. Zebra's Browser Print
 * does it by running a small HTTP service on the workstation; this talks to the
 * printer's bulk endpoint directly from the page, with nothing installed.
 *
 * The reason it exists here: this interface is served over HTTPS through the
 * Hub, and Browser Print's local service is plain HTTP. Whether a browser
 * permits that call has moved around between Chrome versions and is not
 * something to bet a shift on. WebUSB is a browser API, so the question does
 * not arise — but it brings its own constraint, below, which is why neither
 * transport is removed.
 *
 * **Windows claims printers first.** A USB printer is bound by `usbprint.sys`,
 * and a browser cannot claim an interface a kernel driver already holds:
 * `claimInterface()` rejects with an access error. The fix is to rebind that
 * one device to WinUSB (Zadig does it), which also removes it from the Windows
 * printer list — fine for a Zebra only ever driven by this page, not fine for
 * one someone also prints to from Word. That decision belongs to whoever sets
 * the workstation up, so the error says exactly this rather than "failed".
 *
 * Linux needs a udev rule granting the browser access to the vendor id.
 * macOS and ChromeOS need neither.
 */

/** Zebra Technologies. Every Zebra printer answers to this. */
export const ZEBRA_VENDOR_ID = 0x0a5f;

/** USB printer class, from the USB device class definitions. */
const PRINTER_CLASS = 0x07;

/** How long to wait for a status read before giving up on it. */
const READ_TIMEOUT_MS = 3000;

export class WebUsbError extends Error {
  /**
   * @param {string} code
   * @param {string} message Operator-safe.
   * @param {{ detail?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'WebUsbError';
    this.code = code;
    this.detail = options.detail;
    this.cause = options.cause;
  }
}

/**
 * Whether this browser exposes WebUSB at all.
 *
 * `navigator.usb` is absent outside a secure context, so a false here can mean
 * either an unsupported browser or a page that is not on HTTPS. Both are
 * reported the same way because the operator's next step is the same: tell
 * whoever set the machine up.
 *
 * @returns {boolean}
 */
export function isSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.usb?.requestDevice === 'function';
}

/**
 * Printers this page has already been granted.
 *
 * WebUSB permission is per origin and per device and survives a reload, so a
 * workstation authorises its printer once rather than every shift.
 *
 * @returns {Promise<USBDevice[]>}
 */
export async function listPrinters() {
  if (!isSupported()) return [];
  try {
    const devices = await navigator.usb.getDevices();
    return devices.filter((d) => d.vendorId === ZEBRA_VENDOR_ID);
  } catch {
    return [];
  }
}

/**
 * Ask the operator to pick a printer.
 *
 * Must be called from a user gesture — the browser refuses otherwise, and the
 * refusal looks like the picker silently not opening.
 *
 * @returns {Promise<USBDevice>}
 */
export async function requestDevice() {
  if (!isSupported()) {
    throw new WebUsbError(
      'WEBUSB_UNSUPPORTED',
      'This browser cannot talk to USB devices. Use Chrome or Edge, and make sure the page is on HTTPS.',
      { detail: 'navigator.usb is undefined' },
    );
  }
  try {
    return await navigator.usb.requestDevice({ filters: [{ vendorId: ZEBRA_VENDOR_ID }] });
  } catch (cause) {
    // A cancelled picker is not an error worth a red banner — the operator
    // closed it — but it has to be distinguishable from a real failure.
    if (cause?.name === 'NotFoundError') {
      throw new WebUsbError('WEBUSB_NO_DEVICE_CHOSEN', 'No printer was chosen.', { cause });
    }
    throw new WebUsbError(
      'WEBUSB_PICKER_FAILED',
      'The printer chooser could not be opened.',
      { cause, detail: String(cause?.message ?? cause) },
    );
  }
}

/**
 * Open a device and claim its printer interface.
 *
 * Idempotent: a device already opened and claimed is returned as it is, because
 * the print flow calls this on every run and reclaiming throws.
 *
 * @param {USBDevice} device
 * @returns {Promise<{ device: USBDevice, interfaceNumber: number, endpointOut: number,
 *                     endpointIn: number|null }>}
 */
export async function openDevice(device) {
  if (!device) {
    throw new WebUsbError('WEBUSB_NO_DEVICE', 'No printer is selected.');
  }

  try {
    if (!device.opened) await device.open();
  } catch (cause) {
    throw new WebUsbError(
      'WEBUSB_OPEN_FAILED',
      'The printer could not be opened. Another program may be using it.',
      { cause, detail: String(cause?.message ?? cause) },
    );
  }

  if (device.configuration === null) await device.selectConfiguration(1);

  const iface = findPrinterInterface(device);
  if (!iface) {
    throw new WebUsbError(
      'WEBUSB_NO_PRINTER_INTERFACE',
      'That device does not present a printer interface.',
      { detail: `vendorId=0x${device.vendorId.toString(16)} productId=0x${device.productId.toString(16)}` },
    );
  }

  try {
    if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
  } catch (cause) {
    // The Windows case, and by far the most likely failure in a warehouse.
    // Naming the cause is the difference between a five-minute fix and an
    // afternoon spent reinstalling a browser.
    throw new WebUsbError(
      'WEBUSB_INTERFACE_BUSY',
      'Windows is holding this printer, so the browser cannot use it. '
      + 'The printer has to be switched to the WinUSB driver (Zadig) before '
      + 'WebUSB can reach it — or use Zebra Browser Print instead.',
      { cause, detail: `claimInterface(${iface.interfaceNumber}): ${String(cause?.message ?? cause)}` },
    );
  }

  const { endpointOut, endpointIn } = findEndpoints(device, iface.interfaceNumber);
  if (endpointOut === null) {
    throw new WebUsbError(
      'WEBUSB_NO_ENDPOINT',
      'This printer exposes no way to receive a label.',
      { detail: `interface=${iface.interfaceNumber}` },
    );
  }

  return { device, interfaceNumber: iface.interfaceNumber, endpointOut, endpointIn };
}

/**
 * Ask the printer whether it can print.
 *
 * Uses `~HS`, the host status query, the same command the server-side network
 * transport uses. A printer that does not answer is reported as unknown rather
 * than as not ready: a status read that times out is a far weaker signal than
 * a printer actually saying it has no media, and refusing to print on it would
 * ground a working machine.
 *
 * @param {USBDevice} device
 * @returns {Promise<{ known: boolean, ready: boolean, message?: string }>}
 */
export async function checkReady(device) {
  let opened;
  try {
    opened = await openDevice(device);
  } catch (error) {
    // A device that cannot be opened is a real failure, not an unknown status.
    throw error;
  }

  if (opened.endpointIn === null) return { known: false, ready: true };

  try {
    await write(opened, '~HS');
    const reply = await readWithTimeout(opened, READ_TIMEOUT_MS);
    if (!reply) return { known: false, ready: true };

    const status = parseHostStatus(reply);
    if (status === null) return { known: false, ready: true };
    if (status.ready) return { known: true, ready: true };
    return { known: true, ready: false, message: status.message };
  } catch {
    return {
      known: false,
      ready: true,
      message: 'The printer did not answer a status check.',
    };
  }
}

/**
 * Send ZPL to the printer.
 *
 * @param {USBDevice} device
 * @param {string} zpl
 * @returns {Promise<void>}
 */
export async function sendZpl(device, zpl) {
  const opened = await openDevice(device);
  const result = await write(opened, zpl);
  if (result.status !== 'ok') {
    throw new WebUsbError(
      'WEBUSB_SEND_FAILED',
      'The label did not reach the printer.',
      { detail: `transferOut status=${result.status}` },
    );
  }
}

/**
 * Read whatever the printer has to say. Used by the scan-back verification.
 *
 * @param {USBDevice} device
 * @returns {Promise<string>}
 */
export async function readBack(device) {
  const opened = await openDevice(device);
  if (opened.endpointIn === null) return '';
  return (await readWithTimeout(opened, READ_TIMEOUT_MS)) ?? '';
}

/**
 * A stable name for the audit log and the device picker.
 *
 * @param {USBDevice} device
 * @returns {string}
 */
export function describeDevice(device) {
  if (!device) return 'unknown printer';
  const parts = [device.manufacturerName, device.productName].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return `USB printer 0x${device.productId?.toString(16) ?? '????'}`;
}

/**
 * WebUSB has no persistent device id, so this is what identifies a printer
 * across reloads. Serial number when the printer reports one — every Zebra
 * does — and otherwise the product identity, which is enough on a workstation
 * with one printer.
 *
 * @param {USBDevice} device
 * @returns {string}
 */
export function deviceUid(device) {
  if (device?.serialNumber) return `usb:${device.serialNumber}`;
  return `usb:${device?.vendorId ?? 0}:${device?.productId ?? 0}`;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {USBDevice} device
 * @returns {{ interfaceNumber: number, claimed: boolean }|null}
 */
function findPrinterInterface(device) {
  for (const iface of device.configuration?.interfaces ?? []) {
    for (const alternate of iface.alternates ?? []) {
      if (alternate.interfaceClass === PRINTER_CLASS) {
        return { interfaceNumber: iface.interfaceNumber, claimed: iface.claimed };
      }
    }
  }
  return null;
}

/**
 * @param {USBDevice} device
 * @param {number} interfaceNumber
 * @returns {{ endpointOut: number|null, endpointIn: number|null }}
 */
function findEndpoints(device, interfaceNumber) {
  let endpointOut = null;
  let endpointIn = null;
  for (const iface of device.configuration?.interfaces ?? []) {
    if (iface.interfaceNumber !== interfaceNumber) continue;
    for (const alternate of iface.alternates ?? []) {
      for (const endpoint of alternate.endpoints ?? []) {
        if (endpoint.type !== 'bulk') continue;
        if (endpoint.direction === 'out' && endpointOut === null) {
          endpointOut = endpoint.endpointNumber;
        }
        if (endpoint.direction === 'in' && endpointIn === null) {
          endpointIn = endpoint.endpointNumber;
        }
      }
    }
  }
  return { endpointOut, endpointIn };
}

/**
 * @param {{ device: USBDevice, endpointOut: number }} opened
 * @param {string} data
 */
function write(opened, data) {
  return opened.device.transferOut(opened.endpointOut, new TextEncoder().encode(data));
}

/**
 * @param {{ device: USBDevice, endpointIn: number }} opened
 * @param {number} ms
 * @returns {Promise<string|null>}
 */
async function readWithTimeout(opened, ms) {
  // transferIn has no timeout of its own and a printer with nothing to say
  // simply never completes it, which would hang the print flow.
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    const result = await Promise.race([opened.device.transferIn(opened.endpointIn, 64), timeout]);
    if (!result?.data) return null;
    return new TextDecoder().decode(result.data);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the first field of a `~HS` reply.
 *
 * A Zebra answers with three comma-separated lines. The first carries the
 * paper-out and pause flags, which are the two that stop a run and the two an
 * operator can do something about. Anything unparseable returns null, and the
 * caller treats that as "unknown" rather than inventing a fault.
 *
 * @param {string} reply
 * @returns {{ ready: boolean, message: string }|null}
 */
export function parseHostStatus(reply) {
  const fields = String(reply).replace(/[\x02\x03\r]/g, '').split('\n')[0]?.split(',');
  if (!fields || fields.length < 10) return null;

  const paperOut = fields[1] === '1';
  const paused = fields[2] === '1';

  if (paperOut && paused) {
    return { ready: false, message: 'The printer is out of labels and paused.' };
  }
  if (paperOut) return { ready: false, message: 'The printer is out of labels.' };
  if (paused) return { ready: false, message: 'The printer is paused.' };
  return { ready: true, message: '' };
}
