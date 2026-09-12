import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The wrapper is exercised against a stubbed `window.BrowserPrint`, because the
 * real one only exists on a workstation with Zebra's application installed.
 * What matters here is that every failure mode a warehouse actually produces
 * comes out as a distinct, explainable error rather than an opaque string.
 */
async function withBrowserPrint(stub, run, { https = false, library = true } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: https ? 'https://labels.example.com/' : 'http://labels.example.com/',
  });
  const previous = { window: global.window, document: global.document, location: global.location };
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;

  // Stand in for the <script> load of Zebra's vendored library.
  const originalAppend = dom.window.document.head.append.bind(dom.window.document.head);
  dom.window.document.head.append = (node) => {
    originalAppend(node);
    setTimeout(() => {
      if (library) { dom.window.BrowserPrint = stub; node.onload?.(); }
      else node.onerror?.();
    }, 0);
  };

  const module = await import(`../public/js/browserPrint.js?t=${Math.random()}`);
  try {
    await run(module, dom.window);
  } finally {
    Object.assign(global, previous);
  }
}

/** A device that behaves. */
const device = (overrides = {}) => ({
  uid: 'usb-1',
  name: 'ZD421-203dpi ZPL',
  deviceType: 'printer',
  connection: 'usb',
  send: (_zpl, ok) => ok(),
  readAllAvailable: (ok) => ok('ready'),
  ...overrides,
});

/* -- Availability --------------------------------------------------------- */

test('a running Browser Print reports its version', async () => {
  await withBrowserPrint({
    getApplicationConfiguration: (ok) => ok({ application: { version: '1.3.1' } }),
  }, async (bp) => {
    const result = await bp.isAvailable();
    assert.equal(result.ok, true);
    assert.equal(result.version, '1.3.1');
  });
});

test('a missing vendored library names the file rather than throwing', async () => {
  // The repo does not redistribute Zebra's library, so this is the state a
  // fresh checkout is in until someone drops the file in.
  await withBrowserPrint({}, async (bp) => {
    const result = await bp.isAvailable();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BROWSER_PRINT_UNAVAILABLE');
    assert.match(result.message, /\/vendor\/BrowserPrint\.js/);
    assert.match(result.message, /public\/vendor/);
  }, { library: false });
});

test('an application that is not running says to check the tray', async () => {
  await withBrowserPrint({
    getApplicationConfiguration: (_ok, fail) => fail('Could not connect'),
  }, async (bp) => {
    const result = await bp.isAvailable();
    assert.equal(result.ok, false);
    assert.match(result.message, /tray application/);
    assert.equal(result.detail, 'Could not connect');
  });
});

test('an application that never answers times out instead of hanging', async () => {
  // A workstation without the agent must not present as a frozen page.
  await withBrowserPrint({
    getApplicationConfiguration: () => {},
  }, async (bp) => {
    const started = Date.now();
    const result = await bp.isAvailable({ timeoutMs: 40 });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 2000);
  });
});

test('on HTTPS the message names mixed content, not a missing install', async () => {
  // The two look identical from the outside, and guessing wrong costs an
  // afternoon.
  await withBrowserPrint({
    getApplicationConfiguration: (_ok, fail) => fail('blocked'),
  }, async (bp) => {
    assert.equal(bp.isMixedContentBlocked(), true);
    const result = await bp.isAvailable();
    assert.match(result.message, /served over HTTPS/);
    assert.match(result.message, /http:\/\/ on the local network/);
  }, { https: true });
});

/* -- Discovery ------------------------------------------------------------ */

test('the default printer is listed first, then anything else discovered', async () => {
  const usb = device();
  const network = device({ uid: 'net-1', name: 'ZT411', connection: 'network' });
  await withBrowserPrint({
    getApplicationConfiguration: (ok) => ok({}),
    getDefaultDevice: (_type, ok) => ok(usb),
    getLocalDevices: (ok) => ok([network, usb]),
  }, async (bp) => {
    const { devices, defaultUid } = await bp.listPrinters();
    assert.deepEqual(devices.map((d) => d.uid), ['usb-1', 'net-1']);
    assert.equal(defaultUid, 'usb-1');
  });
});

test('no default set is normal, not an error', async () => {
  await withBrowserPrint({
    getApplicationConfiguration: (ok) => ok({}),
    getDefaultDevice: (_type, ok) => ok(null),
    getLocalDevices: (ok) => ok([device()]),
  }, async (bp) => {
    const { devices, defaultUid } = await bp.listPrinters();
    assert.equal(devices.length, 1);
    assert.equal(defaultUid, null);
  });
});

test('discovery answering with a map keyed by type is flattened', async () => {
  // Zebra's library returns a list on some versions and a map on others.
  await withBrowserPrint({
    getApplicationConfiguration: (ok) => ok({}),
    getDefaultDevice: (_type, ok) => ok(null),
    getLocalDevices: (ok) => ok({ printer: [device()], scale: [] }),
  }, async (bp) => {
    assert.equal((await bp.listPrinters()).devices.length, 1);
  });
});

test('no printer at all points at the cable, not the software', async () => {
  await withBrowserPrint({
    getApplicationConfiguration: (ok) => ok({}),
    getDefaultDevice: (_type, ok) => ok(null),
    getLocalDevices: (ok) => ok([]),
  }, async (bp) => {
    await assert.rejects(bp.listPrinters(), (error) => {
      assert.equal(error.code, 'BROWSER_PRINT_NO_DEVICE');
      assert.match(error.message, /USB cable/);
      return true;
    });
  });
});

test('a discovery failure still yields the default device', async () => {
  await withBrowserPrint({
    getApplicationConfiguration: (ok) => ok({}),
    getDefaultDevice: (_type, ok) => ok(device()),
    getLocalDevices: (_ok, fail) => fail('discovery exploded'),
  }, async (bp) => {
    const { devices } = await bp.listPrinters();
    assert.deepEqual(devices.map((d) => d.name), ['ZD421-203dpi ZPL']);
  });
});

/* -- Sending -------------------------------------------------------------- */

test('ZPL reaches the device unchanged', async () => {
  const sent = [];
  await withBrowserPrint({ getApplicationConfiguration: (ok) => ok({}) }, async (bp) => {
    await bp.sendZpl(device({ send: (zpl, ok) => { sent.push(zpl); ok(); } }), '^XA^XZ');
    assert.deepEqual(sent, ['^XA^XZ']);
  });
});

test("a send failure keeps Zebra's wording in the detail, not the message", async () => {
  await withBrowserPrint({ getApplicationConfiguration: (ok) => ok({}) }, async (bp) => {
    await assert.rejects(
      bp.sendZpl(device({ send: (_zpl, _ok, fail) => fail(new Error('Unable to establish connection')) }), '^XA^XZ'),
      (error) => {
        assert.equal(error.code, 'BROWSER_PRINT_SEND_FAILED');
        assert.match(error.message, /would not accept the labels/);
        assert.match(error.detail, /Unable to establish connection/);
        return true;
      },
    );
  });
});

test('sending with no printer selected is its own error', async () => {
  await withBrowserPrint({ getApplicationConfiguration: (ok) => ok({}) }, async (bp) => {
    await assert.rejects(bp.sendZpl(null, '^XA^XZ'), (error) => {
      assert.equal(error.code, 'BROWSER_PRINT_NO_DEVICE');
      return true;
    });
  });
});

/* -- Readiness ------------------------------------------------------------ */

test('a printer fault is named before the ZPL goes, not after', async () => {
  await withBrowserPrint({ getApplicationConfiguration: (ok) => ok({}) }, async (bp) => {
    const result = await bp.checkReady(device({
      isReadyToPrint: (cb) => cb(false),
      getStatus: (ok) => ok({ isPaperOut: true, isHeadOpen: true }),
    }));
    assert.equal(result.ready, false);
    assert.match(result.message, /out of paper/);
    assert.match(result.message, /printhead is open/);
  });
});

test('a device wrapper that is not loaded does not block printing', async () => {
  // BrowserPrint-Zebra.js is optional. Without it the printer's state simply
  // is not checked, which is worse than checking but far better than refusing.
  await withBrowserPrint({ getApplicationConfiguration: (ok) => ok({}) }, async (bp) => {
    const result = await bp.checkReady(device());
    assert.deepEqual(result, { known: false, ready: true });
  });
});

test('readBack drains what the printer said and never throws', async () => {
  await withBrowserPrint({ getApplicationConfiguration: (ok) => ok({}) }, async (bp) => {
    assert.equal(await bp.readBack(device()), 'ready');
    assert.equal(await bp.readBack({}), '');
  });
});
