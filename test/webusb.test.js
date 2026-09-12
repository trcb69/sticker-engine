import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ZEBRA_VENDOR_ID, WebUsbError, isSupported, listPrinters, requestDevice,
  openDevice, checkReady, sendZpl, describeDevice, deviceUid, parseHostStatus,
} from '../public/js/webusb.js';

/**
 * Exercised against a stubbed `navigator.usb`, because the real one needs a
 * browser, a secure context and a printer on the end of a cable. What matters
 * here is that the failures a warehouse actually produces — Windows holding
 * the printer, a cancelled picker, a printer that never answers — each come
 * out as their own explainable error rather than one opaque rejection.
 */
function withNavigator(usb, run) {
  const previous = global.navigator;
  // `navigator` is a getter on the global in Node, so it is replaced wholesale.
  Object.defineProperty(global, 'navigator', {
    value: usb === null ? {} : { usb }, configurable: true, writable: true,
  });
  return (async () => {
    try { return await run(); } finally {
      Object.defineProperty(global, 'navigator', {
        value: previous, configurable: true, writable: true,
      });
    }
  })();
}

/** A printer that behaves. */
function device(overrides = {}) {
  const sent = [];
  const base = {
    vendorId: ZEBRA_VENDOR_ID,
    productId: 0x0081,
    manufacturerName: 'Zebra Technologies',
    productName: 'ZTC ZD421-203dpi ZPL',
    serialNumber: 'D2J184600123',
    opened: false,
    configuration: {
      interfaces: [{
        interfaceNumber: 0,
        claimed: false,
        alternates: [{
          interfaceClass: 0x07,
          endpoints: [
            { endpointNumber: 1, direction: 'out', type: 'bulk' },
            { endpointNumber: 2, direction: 'in', type: 'bulk' },
          ],
        }],
      }],
    },
    sent,
    async open() { this.opened = true; },
    async selectConfiguration() {},
    async claimInterface() { this.configuration.interfaces[0].claimed = true; },
    async transferOut(endpoint, data) {
      sent.push({ endpoint, text: new TextDecoder().decode(data) });
      return { status: 'ok', bytesWritten: data.byteLength };
    },
    async transferIn() {
      return { data: new TextEncoder().encode('\x02014,0,0,0000,000,0,0,0,000,0,0,0\r\n') };
    },
  };
  return Object.assign(base, overrides);
}

/* -- capability ----------------------------------------------------------- */

test('a browser without WebUSB is reported as unsupported rather than crashing', async () => {
  await withNavigator(null, async () => {
    assert.equal(isSupported(), false);
    assert.deepEqual(await listPrinters(), []);
    await assert.rejects(() => requestDevice(), (e) => e.code === 'WEBUSB_UNSUPPORTED');
  });
});

test('only Zebras are offered, out of whatever else is plugged in', async () => {
  const zebra = device();
  const mouse = device({ vendorId: 0x046d, productName: 'USB Mouse' });
  await withNavigator({
    requestDevice: async () => zebra,
    getDevices: async () => [zebra, mouse],
  }, async () => {
    assert.deepEqual(await listPrinters(), [zebra]);
  });
});

test('a cancelled picker is its own outcome, not a failure', async () => {
  await withNavigator({
    requestDevice: async () => { const e = new Error('No device selected.'); e.name = 'NotFoundError'; throw e; },
    getDevices: async () => [],
  }, async () => {
    await assert.rejects(() => requestDevice(), (e) => {
      assert.equal(e.code, 'WEBUSB_NO_DEVICE_CHOSEN');
      return true;
    });
  });
});

/* -- opening -------------------------------------------------------------- */

test('opening finds the printer interface and its bulk endpoints', async () => {
  const opened = await openDevice(device());
  assert.equal(opened.interfaceNumber, 0);
  assert.equal(opened.endpointOut, 1);
  assert.equal(opened.endpointIn, 2);
});

test('Windows holding the printer says so, and says what to do about it', async () => {
  // The failure this transport is most likely to hit in a warehouse. An opaque
  // "access denied" here costs an afternoon; naming usbprint.sys and Zadig
  // costs five minutes.
  const held = device({
    async claimInterface() { const e = new Error('Access denied.'); e.name = 'SecurityError'; throw e; },
  });
  await assert.rejects(() => openDevice(held), (error) => {
    assert.ok(error instanceof WebUsbError);
    assert.equal(error.code, 'WEBUSB_INTERFACE_BUSY');
    assert.match(error.message, /Windows is holding this printer/);
    assert.match(error.message, /WinUSB|Zadig/, 'the fix is in the message, not a support call');
    return true;
  });
});

test('a device with no printer interface is refused before anything is sent', async () => {
  const notAPrinter = device({
    configuration: { interfaces: [{ interfaceNumber: 0, claimed: false,
      alternates: [{ interfaceClass: 0x03, endpoints: [] }] }] },
  });
  await assert.rejects(() => openDevice(notAPrinter), (e) => e.code === 'WEBUSB_NO_PRINTER_INTERFACE');
});

test('claiming happens once, however many labels are printed', async () => {
  const d = device();
  let claims = 0;
  d.claimInterface = async function claim() { claims += 1; this.configuration.interfaces[0].claimed = true; };
  await openDevice(d);
  await openDevice(d);
  assert.equal(claims, 1, 'reclaiming an interface throws, so the second run must not try');
});

/* -- status --------------------------------------------------------------- */

test('the host status reply is read for the two faults an operator can fix', () => {
  assert.deepEqual(parseHostStatus('\x02014,0,0,0000,000,0,0,0,000,0,0,0\r\n'),
    { ready: true, message: '' });
  assert.equal(parseHostStatus('\x02014,1,0,0000,000,0,0,0,000,0,0,0\r\n').message,
    'The printer is out of labels.');
  assert.equal(parseHostStatus('\x02014,0,1,0000,000,0,0,0,000,0,0,0\r\n').message,
    'The printer is paused.');
  assert.equal(parseHostStatus('\x02014,1,1,0000,000,0,0,0,000,0,0,0\r\n').message,
    'The printer is out of labels and paused.');
});

test('an unreadable status is unknown, never a fault', () => {
  // Reporting a silent printer as broken would ground a working machine.
  assert.equal(parseHostStatus('nonsense'), null);
  assert.equal(parseHostStatus(''), null);
});

test('a printer that never answers does not hang the print flow', async () => {
  const silent = device({ transferIn: () => new Promise(() => {}) });
  const started = Date.now();
  const ready = await checkReady(silent);
  assert.deepEqual(ready, { known: false, ready: true });
  assert.ok(Date.now() - started < 5000, 'the read timed out rather than waiting forever');
});

test('a printer reporting no media is not printed to', async () => {
  const empty = device({
    async transferIn() {
      return { data: new TextEncoder().encode('\x02014,1,0,0000,000,0,0,0,000,0,0,0\r\n') };
    },
  });
  assert.deepEqual(await checkReady(empty), {
    known: true, ready: false, message: 'The printer is out of labels.',
  });
});

/* -- sending -------------------------------------------------------------- */

test('the ZPL reaches the bulk out endpoint byte for byte', async () => {
  const d = device();
  await sendZpl(d, '^XA^FO10,10^A0N,20,20^FDHELLO^FS^XZ');
  const label = d.sent.filter((s) => s.text.startsWith('^XA'));
  assert.equal(label.length, 1);
  assert.equal(label[0].endpoint, 1);
  assert.equal(label[0].text, '^XA^FO10,10^A0N,20,20^FDHELLO^FS^XZ');
});

test('a refused transfer is a failure, not a silent success', async () => {
  // A Zebra acknowledges nothing, so the transfer status is the only signal
  // there is that the label left the machine.
  const stalled = device({ async transferOut() { return { status: 'stall' }; } });
  await assert.rejects(() => sendZpl(stalled, '^XA^XZ'), (e) => e.code === 'WEBUSB_SEND_FAILED');
});

/* -- identity ------------------------------------------------------------- */

test('a printer is identified by its serial, so it survives a reload', () => {
  assert.equal(deviceUid(device()), 'usb:D2J184600123');
  assert.equal(describeDevice(device()), 'Zebra Technologies ZTC ZD421-203dpi ZPL');
});

test('a printer with no serial still gets a stable identity', () => {
  const anonymous = device({ serialNumber: undefined });
  assert.equal(deviceUid(anonymous), `usb:${ZEBRA_VENDOR_ID}:129`);
});
