/**
 * Printer diagnostics.
 *
 * This page exists because the alternative is debugging a printer over the
 * phone. It answers, in order, the four questions that matter when labels are
 * not coming out: is the local application running, can it see the printer,
 * will the printer take a label, and does that label scan.
 *
 * Every failure is explained in a sentence saying what to do. An error string
 * copied from a library is not a diagnosis.
 */

import { el, replace } from './dom.js';
import {
  isAvailable, isMixedContentBlocked, listPrinters, readBack, sendZpl, checkReady,
} from './browserPrint.js';
import { rememberDevice, rememberedDeviceUid } from './print.js';

const dom = {
  availability: document.getElementById('availability'),
  devices: document.getElementById('devices'),
  send: document.getElementById('send'),
  readback: document.getElementById('readback'),
};

/** @type {object[]} */
let devices = [];
/** @type {object|null} */
let selected = null;

/**
 * A small self-contained label: a border, the device name, and a Code 128 that
 * can be scanned without setting up a whole job.
 * @param {string} deviceName
 */
function testLabel(deviceName) {
  const name = String(deviceName).slice(0, 28).replace(/[\^~\\]/g, ' ');
  return '^XA\n^PW812\n^LL203\n^LH0,0\n^CI28\n'
    + '^FO4,4^GB804,195,3^FS\n'
    + '^FO30,24^A0N,28,28^FDSticker Engine test label^FS\n'
    + `^FO30,58^A0N,22,22^FD${name}^FS\n`
    + '^BY2,3,60\n'
    + '^FO30,96^BCN,60,Y,N,N^FDTEST12345^FS\n'
    + '^PQ1\n^XZ\n';
}

/* -- Availability --------------------------------------------------------- */

async function renderAvailability() {
  replace(dom.availability, [el('p.hint', { text: 'Checking…' })]);
  const result = await isAvailable();

  if (result.ok) {
    replace(dom.availability, [
      el('div.verdict.verdict--good', {}, [
        el('span.verdict__dot'),
        el('span', { text: `Running — version ${result.version}` }),
      ]),
    ]);
    return true;
  }

  replace(dom.availability, [
    el('div.verdict.verdict--bad', {}, [
      el('span.verdict__dot'),
      el('span', { text: 'Not reachable' }),
    ]),
    el('p', { text: result.message }),
    result.detail ? el('p.hint', { text: result.detail }) : null,
    isMixedContentBlocked()
      ? el('p.hint', {
        text: 'This page is on HTTPS. Browser Print listens on plain HTTP, so the browser '
          + 'blocks the connection and the symptom looks identical to the application '
          + 'not being installed.',
      })
      : null,
    el('button.btn.btn--ghost', { type: 'button', text: 'Check again', onclick: boot }),
  ]);
  return false;
}

/* -- Devices -------------------------------------------------------------- */

async function renderDevices() {
  replace(dom.devices, [el('p.hint', { text: 'Looking for printers…' })]);
  let result;
  try {
    result = await listPrinters();
  } catch (error) {
    replace(dom.devices, [
      el('div.verdict.verdict--bad', {}, [el('span.verdict__dot'), el('span', { text: error.message })]),
      el('button.btn.btn--ghost', { type: 'button', text: 'Look again', onclick: renderDevices }),
    ]);
    return;
  }

  devices = result.devices;
  const remembered = rememberedDeviceUid();
  selected = devices.find((device) => device.uid === remembered)
    ?? devices.find((device) => device.uid === result.defaultUid)
    ?? devices[0];

  replace(dom.devices, [
    el('div.grid__head', { style: 'grid-template-columns: 3rem 2fr 1fr 1fr 6rem' }, [
      el('div.cell', { text: '' }),
      el('div.cell', { text: 'Name' }),
      el('div.cell', { text: 'Connection' }),
      el('div.cell', { text: 'UID' }),
      el('div.cell', { text: '' }),
    ]),
    ...devices.map((device) => el('div.row', {
      style: 'grid-template-columns: 3rem 2fr 1fr 1fr 6rem',
      class: device.uid === selected?.uid ? 'row--selected' : '',
    }, [
      el('div.cell', {}, [el('input', {
        type: 'radio',
        name: 'device',
        checked: device.uid === selected?.uid,
        'aria-label': `Use ${device.name}`,
        onchange: () => { selected = device; rememberDevice(device.uid); renderDevices(); },
      })]),
      el('div.cell', {}, [
        el('span.item__name', { text: device.name }),
        device.uid === result.defaultUid ? el('span.badge.badge--warn', { text: 'default' }) : null,
      ]),
      el('div.cell', { text: device.connection ?? device.deviceType ?? '—' }),
      el('div.cell', {}, [el('code', { text: String(device.uid).slice(0, 18) })]),
      el('div.cell', { text: '' }),
    ])),
  ]);
  renderSend();
}

/* -- Sending -------------------------------------------------------------- */

function renderSend() {
  const raw = el('textarea.calibrate__json', {
    id: 'raw-zpl',
    placeholder: '^XA\n^FO50,50^A0N,40,40^FDHello^FS\n^XZ',
  });
  const status = el('div');

  const send = async (zpl, what) => {
    if (!selected) {
      replace(status, [el('p.error', { text: 'Choose a printer first.' })]);
      return;
    }
    replace(status, [el('p.hint', { text: `Sending ${what}…` })]);
    try {
      const ready = await checkReady(selected);
      if (ready.known && !ready.ready) {
        replace(status, [el('div.verdict.verdict--bad', {}, [
          el('span.verdict__dot'), el('span', { text: ready.message }),
        ])]);
        return;
      }
      await sendZpl(selected, zpl);
      replace(status, [
        el('div.verdict.verdict--good', {}, [
          el('span.verdict__dot'),
          el('span', { text: `Sent ${what} to ${selected.name}.` }),
        ]),
        el('p.hint', {
          text: 'If nothing came out, the connection is wrong. If a blank label came out, '
            + 'the connection is fine and the ZPL is wrong.',
        }),
      ]);
      dom.readback.textContent = (await readBack(selected)) || '(nothing)';
    } catch (error) {
      replace(status, [
        el('div.verdict.verdict--bad', {}, [
          el('span.verdict__dot'), el('span', { text: error.message }),
        ]),
        error.detail ? el('p.hint', { text: `Printer said: ${error.detail}` }) : null,
      ]);
    }
  };

  replace(dom.send, [
    el('div.link__row', {}, [
      el('button.btn.btn--primary.btn--large', {
        type: 'button',
        text: 'Send test label',
        onclick: () => send(testLabel(selected?.name ?? 'unknown'), 'the test label'),
      }),
      el('span.hint', { text: 'Prints a border, the printer name, and a Code 128 of TEST12345.' }),
    ]),
    status,
    el('p.field__label', { text: 'Or send raw ZPL' }),
    raw,
    el('button.btn.btn--ghost', {
      type: 'button',
      text: 'Send raw ZPL',
      onclick: () => {
        const zpl = raw.value.trim();
        if (zpl) send(zpl, 'your ZPL');
      },
    }),
  ]);
}

/* -- Boot ----------------------------------------------------------------- */

async function boot() {
  dom.readback.textContent = '(nothing yet)';
  if (await renderAvailability()) {
    await renderDevices();
  } else {
    replace(dom.devices, [el('p.hint', { text: 'Cannot look for printers until Browser Print is reachable.' })]);
    replace(dom.send, [el('p.hint', { text: '—' })]);
  }
}

boot();
