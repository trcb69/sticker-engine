/**
 * Wiring.
 *
 * The whole screen re-renders from state on every change. That is cheap at this
 * size and removes a class of bug that matters here: a grid showing a batch
 * number that is not the one about to be printed.
 *
 * The exception is focus. Rebuilding the DOM under an operator's cursor would
 * lose their place mid-scan, so the focused field is restored after each pass.
 */

import * as api from './api.js';
import { createStore } from './state.js';
import { el, replace } from './dom.js';
import { renderLabel } from './render-canvas.js';
import { renderProvenanceBar } from './components/provenanceBar.js';
import { renderLinkField } from './components/linkField.js';
import { focusNextIncomplete, renderLineGrid } from './components/lineGrid.js';
import { closePrintDialog, openPrintDialog } from './components/printDialog.js';
import { openVerifyDialog } from './components/verifyDialog.js';
import { listPrinters } from './browserPrint.js';
import * as webusb from './webusb.js';
import { url } from './base.js';
import { rememberDevice, rememberedDeviceUid, runPrint } from './print.js';
import { attachCalibration } from './components/calibration.js';
import { labelCount, valueOf } from './format.js';

const dom = {
  upload: document.getElementById('upload'),
  workPanels: [...document.querySelectorAll('[data-when="job"]')],
  provenance: document.getElementById('provenance'),
  jobFields: document.getElementById('job-fields'),
  link: document.getElementById('link-field'),
  grid: document.getElementById('grid'),
  canvas: document.getElementById('preview-canvas'),
  previewMeta: document.getElementById('preview-meta'),
  warnings: document.getElementById('warnings'),
  status: document.getElementById('status-line'),
  actions: document.getElementById('actions'),
  modal: document.getElementById('modal-root'),
  calibrate: document.getElementById('calibrate-panel'),
  toast: document.getElementById('toast'),
};

const params = new URLSearchParams(location.search);
const calibrating = params.get('calibrate') === '1';

/** Dots of canvas drawn outside the label while calibrating, so an element
 *  pushed past the edge stays visible instead of being clipped away. */
const CALIBRATE_BLEED = 48;

/** Which slot the arrow keys act on. Survives the re-render each nudge causes. */
let selectedSlot = null;
let confirmThreshold = 50;
let lastRender = null;

const store = createStore(render);

/* -- Rendering ------------------------------------------------------------ */

function render(state) {
  const active = document.activeElement;
  const focusKey = active?.dataset?.line
    ? `${active.dataset.line}:${active.dataset.field}`
    : active?.id ?? null;
  const caret = active && 'selectionStart' in active ? active.selectionStart : null;

  // The working panels are empty shells until documents have been read, and an
  // empty card is worse than no card: it looks like something failed to load.
  for (const panel of dom.workPanels) panel.hidden = !state.job;

  renderUpload(state);
  renderProvenanceBar(dom.provenance, state);
  renderJobFields(state);
  renderLinkField(dom.link, state, {
    onProceed: (url) => store.shortenLink(url),
    onEdit: () => store.editLink(),
  });
  renderLineGrid(dom.grid, state, handlers);
  renderStatus(state);
  renderActions(state);
  renderPreview(state);
  renderToast(state);

  restoreFocus(focusKey, caret);
}

/** @param {string|null} key */
function restoreFocus(key, caret) {
  if (!key) return;
  const target = key.includes(':')
    ? document.querySelector(`[data-line="${key.split(':')[0]}"][data-field="${key.split(':')[1]}"]`)
    : document.getElementById(key);
  if (!target || target === document.activeElement) return;
  target.focus();
  if (caret !== null && 'setSelectionRange' in target) {
    try { target.setSelectionRange(caret, caret); } catch { /* not a text input */ }
  }
}

function renderUpload(state) {
  if (state.job) { dom.upload.hidden = true; return; }
  dom.upload.hidden = false;

  const fileInput = el('input', {
    id: 'file-input',
    type: 'file',
    accept: '.pdf,application/pdf',
    multiple: true,
    onchange: (event) => upload([...event.target.files]),
  });

  replace(dom.upload, [
    el('div.masthead', {}, [
      el('div.eyebrow', { text: 'Standard Holdings (Pvt) Ltd' }),
      el('span.badge-pill', { text: 'SH-IT' }),
      el('h2', { text: 'Sticker Engine' }),
      el('p.masthead__lead', {
        text: 'Drop the Picklist and Sample Note for a run below. The item names and '
          + 'quantities are read straight off the Picklist; the batch number, dates, '
          + 'ClickUp link and manufacturer are yours to fill in.',
      }),
    ]),
    el('div.upload__panel', {}, [
      el('label.dropzone', {}, [
        el('span.dropzone__icon', { text: '↓' }),
        el('span.dropzone__title', {
          text: state.busy ? 'Reading the documents…' : 'Drag & drop the run documents here',
        }),
        el('span.dropzone__hint', {}, [
          'or click to choose files · ',
          el('code', { text: '.pdf' }),
          ' · Picklist and Sample Note',
        ]),
        fileInput,
      ]),
      state.error ? el('p.error', { text: state.error.message }) : null,
      el('div.factbar', {}, [
        fact('Input', 'Picklist + Sample Note'),
        fact('Output', 'ZPL II for 4×1 in labels'),
        fact('Resolution', '203 / 300 / 600 dpi'),
      ]),
    ]),
  ]);
}

/**
 * @param {string} label
 * @param {string} value
 */
function fact(label, value) {
  return el('div.fact', {}, [
    el('div.fact__label', { text: label }),
    el('div.fact__value', { text: value }),
  ]);
}

function renderJobFields(state) {
  if (!state.job) { replace(dom.jobFields, []); return; }
  replace(dom.jobFields, [
    field('Resolution', el('select.input', {
      id: 'dpi',
      onchange: (event) => store.setDpi(Number(event.target.value)),
    }, [203, 300, 600].map((dpi) => el('option', {
      value: String(dpi), selected: state.dpi === dpi, text: `${dpi} dpi`,
    })))),
    field('Printer', printerSelect(state)),
    field('Manufacturer', el('input.input', {
      id: 'manufacturer',
      type: 'text',
      value: valueOf(state.job.manufacturer),
      placeholder: 'paste the manufacturer',
      onchange: (event) => store.editJob({ manufacturer: event.target.value.trim() || null }),
    })),
  ]);
}

/**
 * The printer selector.
 *
 * On USB the list comes from Browser Print on the operator's own machine, not
 * from the server — the server cannot see a printer plugged into someone
 * else's desk. When it is not reachable the selector says why and the run
 * falls back to downloading a .zpl, which still gets labels out.
 * @param {object} state
 */
function printerSelect(state) {
  if (state.transport === 'network') {
    const printers = state.printers ?? [];
    return el('select.input', { id: 'printer', disabled: printers.length === 0 },
      (printers.length ? printers : [{ name: 'Download only' }])
        .map((printer) => el('option', { value: printer.name, text: printer.name })));
  }

  if (state.printerError) {
    return el('div', {}, [
      el('select.input', { id: 'printer', disabled: true }, [
        el('option', { text: 'Download only' }),
      ]),
      el('a.linkish', { href: url('/diagnostics'), text: 'why?' }),
    ]);
  }

  const devices = state.devices ?? [];

  // WebUSB grants access per device, and the chooser only opens from a real
  // click — so there has to be something to click. Once granted, the
  // permission persists per origin and this button is not seen again.
  if (state.transport === 'webusb') {
    const choose = el('button.btn.btn--ghost', {
      type: 'button',
      text: devices.length === 0 ? 'Choose printer…' : 'Change',
      onclick: () => chooseUsbPrinter(),
    });
    if (devices.length === 0) {
      return el('div.printer-pick', {}, [
        el('select.input', { id: 'printer', disabled: true },
          [el('option', { text: 'No printer authorised' })]),
        choose,
      ]);
    }
    return el('div.printer-pick', {}, [deviceSelect(state, devices), choose]);
  }

  if (devices.length === 0) {
    return el('select.input', { id: 'printer', disabled: true }, [
      el('option', { text: 'Looking for printers…' }),
    ]);
  }

  return deviceSelect(state, devices);
}

/**
 * @param {object} state
 * @param {object[]} devices
 */
function deviceSelect(state, devices) {
  return el('select.input', {
    id: 'printer',
    onchange: (event) => {
      const device = devices.find((candidate) => candidate.uid === event.target.value);
      if (!device) return;
      rememberDevice(device.uid);
      store.set({ selectedDevice: device });
    },
  }, devices.map((device) => el('option', {
    value: device.uid,
    selected: state.selectedDevice?.uid === device.uid,
    text: device.name,
  })));
}

/**
 * Normalise a USBDevice into the shape the picker and the print flow expect.
 * `usb` carries the device itself, because that is what the transport needs.
 * @param {USBDevice} d
 */
function asUsbChoice(d) {
  return { uid: webusb.deviceUid(d), name: webusb.describeDevice(d), usb: d };
}

/**
 * Open the browser's USB chooser. Only ever called from a click.
 */
async function chooseUsbPrinter() {
  try {
    const chosen = asUsbChoice(await webusb.requestDevice());
    rememberDevice(chosen.uid);
    const devices = (await webusb.listPrinters()).map(asUsbChoice);
    store.set({
      devices: devices.length > 0 ? devices : [chosen],
      selectedDevice: chosen,
      printerError: null,
    });
  } catch (error) {
    // Closing the chooser is not a failure worth a banner.
    if (error?.code === 'WEBUSB_NO_DEVICE_CHOSEN') return;
    store.set({ printerError: error.message });
  }
}

/**
 * @param {string} label
 * @param {HTMLElement} input
 */
function field(label, input) {
  return el('label.field', {}, [el('span.field__label', { text: label }), input]);
}

const PRINTING_STAGES = {
  preparing: 'Preparing the run…',
  checking: 'Checking the printer…',
  sending: 'Sending to the printer…',
  recording: 'Recording the run…',
  done: 'Sent.',
};

function renderStatus(state) {
  if (state.printing) {
    replace(dom.status, [el('strong', { text: PRINTING_STAGES[state.printing] ?? 'Printing…' })]);
    return;
  }
  if (!state.job) { dom.status.textContent = ''; return; }
  const { ready, total } = state.job.readiness ?? { ready: 0, total: 0 };
  const selected = [...state.selectedForPrint];
  const labels = state.job.lines
    .filter((line) => state.selectedForPrint.has(line.index))
    .reduce((sum, line) => sum + (line.copies ?? 1), 0);

  replace(dom.status, [
    el('strong', { text: `${ready} of ${total} ready` }),
    el('span.dot', { text: '·' }),
    el('span', { text: `${selected.length} selected` }),
    el('span.dot', { text: '·' }),
    el('span', { text: labelCount(labels) }),
  ]);
}

function renderActions(state) {
  if (!state.job) { replace(dom.actions, []); return; }
  const selected = state.job.lines.filter((line) => state.selectedForPrint.has(line.index));
  replace(dom.actions, [
    el('a.btn.btn--ghost.btn--large', { href: url('/diagnostics'), text: 'Printer' }),
    el('button.btn.btn--ghost.btn--large', {
      type: 'button', text: 'New run', onclick: () => location.reload(),
    }),
    el('button.btn.btn--primary.btn--large', {
      type: 'button',
      text: selected.length ? `Print ${labelCount(selected.reduce((s, l) => s + (l.copies ?? 1), 0))}` : 'Print',
      disabled: selected.length === 0,
      onclick: () => openPrintDialog(dom.modal, {
        lines: selected,
        threshold: confirmThreshold,
        dpi: state.dpi,
        onCancel: () => closePrintDialog(dom.modal),
        onConfirm: () => {
          closePrintDialog(dom.modal);
          print(selected);
        },
      }),
    }),
  ]);
}

async function renderPreview(state) {
  if (!state.job || !state.template) return;
  const line = state.job.lines.find((candidate) => candidate.index === state.selectedLine)
    ?? state.job.lines[0];
  if (!line) return;

  const context = buildContext(state.job, line);
  let result;
  try {
    result = renderLabel(dom.canvas, state.template, context, {
      scale: calibrating ? 3 : 2,
      warnings: state.previewWarnings ?? [],
      calibrate: calibrating,
      bleed: calibrating ? CALIBRATE_BLEED : 0,
      selectedSlot: calibrating ? selectedSlot : null,
    });
  } catch (error) {
    replace(dom.warnings, [el('p.error', { text: error.message })]);
    return;
  }
  lastRender = result;

  replace(dom.previewMeta, [
    el('span', { text: `Line ${line.index} · ${state.dpi} dpi · ${result.placed.width}×${result.placed.height} dots` }),
    el('span.hint', { text: 'QR size and module count are exact; the pattern shown is indicative.' }),
  ]);

  // The server holds the authoritative guard result, because it runs against
  // the same layout the emitter will use at print time.
  try {
    const preview = await api.previewLine(state.job.id, line.index, state.dpi);
    renderLabel(dom.canvas, state.template, context, {
      scale: calibrating ? 3 : 2,
      warnings: preview.warnings,
      calibrate: calibrating,
      bleed: calibrating ? CALIBRATE_BLEED : 0,
      selectedSlot: calibrating ? selectedSlot : null,
    });
    renderWarnings(preview.warnings);
  } catch {
    renderWarnings([]);
  }

  if (calibrating) {
    // Redrawn from the template after every edit, so what is on screen is
    // always the geometry that would be emitted — not a preview of it.
    const redraw = () => {
      const next = renderLabel(dom.canvas, state.template, context, {
        scale: 3,
        calibrate: true,
        bleed: CALIBRATE_BLEED,
        selectedSlot,
      });
      lastRender = next;
      return next;
    };

    attachCalibration(dom.calibrate, dom.canvas, {
      placed: result.placed,
      template: state.template,
      scale: result.scale,
      bleed: CALIBRATE_BLEED,
      selected: selectedSlot,
      onSelect: (slotId) => {
        selectedSlot = slotId;
        redraw();
      },
      onMove: (slotId, dx, dy) => {
        const slot = state.template.slots.find((candidate) => candidate.id === slotId);
        if (!slot) return;
        slot.x = (slot.x ?? 0) + dx;
        slot.y = (slot.y ?? 0) + dy;
        Object.assign(result.placed, redraw().placed);
      },
      onResize: (slotId, dw, dh) => {
        const slot = state.template.slots.find((candidate) => candidate.id === slotId);
        if (!slot) return;
        // A slot cannot be shrunk out of existence: at zero it stops being
        // something you can click on to get back.
        if (slot.w !== undefined) slot.w = Math.max(1, slot.w + dw);
        if (slot.h !== undefined) slot.h = Math.max(1, slot.h + dh);
        Object.assign(result.placed, redraw().placed);
      },
    });
  }
}

/** @param {object[]} warnings */
function renderWarnings(warnings) {
  const real = warnings.filter((warning) => warning.severity !== 'info');
  replace(dom.warnings, real.length
    ? real.map((warning) => el('div.warning', { class: `warning--${warning.severity}` }, [
      el('span.warning__slot', { text: warning.slotId }),
      el('span', { text: warning.message }),
    ]))
    : [el('p.hint', { text: 'No layout problems on this label.' })]);
}

/**
 * @param {object} job
 * @param {object} line
 */
function buildContext(job, line) {
  return {
    customer: job.customer,
    docNo: job.docNo,
    manufacturer: job.manufacturer,
    displayName: line.displayName,
    qtyText: line.qtyText
      ? { value: line.qtyText, provenance: 'extracted' }
      : { value: null, provenance: 'missing' },
    mnfDate: line.mnfDate,
    expDate: line.expDate,
    batchCode: line.batchCode,
    qrPayload: job.qrPayload ?? { value: null, provenance: 'missing' },
    qrEcc: job.qrPlan?.ecc
      ? { value: job.qrPlan.ecc, provenance: 'derived' }
      : { value: null, provenance: 'missing' },
  };
}

function renderToast(state) {
  if (!state.error) { dom.toast.hidden = true; return; }
  replace(dom.toast, [
    el('span', { text: state.error.message }),
    state.error.requestId ? el('code.toast__id', { text: state.error.requestId }) : null,
    el('button.btn.btn--ghost', { type: 'button', text: 'Dismiss', onclick: () => store.clearError() }),
  ]);
  dom.toast.hidden = false;
}

/* -- Handlers ------------------------------------------------------------- */

const handlers = {
  onSelect: (index) => {
    if (store.state.selectedLine !== index) store.selectLine(index);
  },
  onTogglePrint: (index, on) => store.togglePrint(index, on),
  onSelectAll: (on) => store.selectAllReady(on),
  onEdit: (index, patch) => store.editLine(index, patch).catch(() => {}),
  onAdvance: (index) => focusNextIncomplete(store.state.job, index),
  onFillDown: (key) => {
    const job = store.state.job;
    const source = job.lines.find((line) => line[key]?.value);
    if (!source) return;
    const value = source[key].value;
    for (const line of job.lines) {
      if (line.index === source.index || line[key]?.value === value) continue;
      store.editLine(line.index, { [key]: value }).catch(() => {});
    }
  },
};

/**
 * Send a run, then ask for a label back.
 * @param {object[]} lines
 */
async function print(lines) {
  const state = store.state;
  const canPrint = state.transport === 'network'
    ? Boolean(state.printers?.length)
    : Boolean(state.selectedDevice);

  if (!canPrint) {
    // No printer we can reach. Downloading still gets labels out, which beats
    // refusing on a launch day.
    window.location.href = api.zplUrl(state.job.id, lines.map((l) => l.index), state.dpi);
    return;
  }

  store.set({ printing: 'preparing' });
  try {
    const { run } = await runPrint({
      jobId: state.job.id,
      lines: lines.map((line) => line.index),
      dpi: state.dpi,
      reason: null,
      transport: state.transport,
      device: state.selectedDevice?.usb ?? state.selectedDevice,
      printerName: state.transport === 'network'
        ? state.printers[0].name
        : state.selectedDevice.name,
    }, (stage) => store.set({ printing: stage }));

    store.set({ printing: null });
    openVerifyDialog(dom.modal, {
      run,
      onVerify: (scanned) => api.verifyRun(run.id, scanned),
      onSkip: () => closePrintDialog(dom.modal),
      onDone: () => closePrintDialog(dom.modal),
    });
  } catch (error) {
    store.set({ printing: null, error });
  }
}

/** @param {File[]} files */
async function upload(files) {
  if (files.length === 0) return;
  try {
    await store.upload(files);
    await store.loadTemplate(store.state.dpi);
  } catch { /* surfaced through state.error */ }
}

/* -- Bootstrap ------------------------------------------------------------ */

document.addEventListener('dragover', (event) => { event.preventDefault(); });
document.addEventListener('drop', (event) => {
  event.preventDefault();
  if (store.state.job) return;
  upload([...event.dataTransfer.files]);
});

// Keyboard shortcuts, so nothing on this screen needs a mouse.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !dom.modal.hidden) closePrintDialog(dom.modal);
  if (!event.ctrlKey && !event.metaKey) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    document.querySelector('#actions .btn--primary:not([disabled])')?.click();
  }
  if (event.key.toLowerCase() === 'a' && store.state.job) {
    event.preventDefault();
    store.selectAllReady(true);
  }
});

(async function boot() {
  let transport = 'browser';
  try {
    const health = await api.getHealth();
    confirmThreshold = health.confirmThreshold ?? 50;
    transport = health.printTransport ?? 'browser';
    if (health.checks?.poppler?.ok === false) {
      store.set({ error: { message: health.checks.poppler.detail, requestId: null } });
    }
    const printers = health.checks?.printers?.printers ?? {};
    store.set({ transport, printers: Object.keys(printers).map((name) => ({ name })) });
  } catch { /* the upload panel still works; health is advisory */ }

  if (transport === 'webusb') {
    // Nothing is requested at boot — the chooser needs a gesture. This only
    // picks up printers this origin was already granted, so a workstation
    // authorises its printer once and never sees the button again.
    webusb.listPrinters()
      .then((found) => {
        const devices = found.map(asUsbChoice);
        const remembered = rememberedDeviceUid();
        store.set({
          devices,
          selectedDevice: devices.find((device) => device.uid === remembered) ?? devices[0],
          printerError: webusb.isSupported()
            ? null
            : 'This browser cannot reach USB printers. Use Chrome or Edge over HTTPS.',
        });
      })
      .catch((error) => store.set({ devices: [], printerError: error.message }));
  }

  if (transport === 'browser') {
    // Discovery is slow when Browser Print has network and Bluetooth scanning
    // on, so it runs alongside the rest of boot rather than blocking it.
    listPrinters()
      .then(({ devices, defaultUid }) => {
        const remembered = rememberedDeviceUid();
        store.set({
          devices,
          selectedDevice: devices.find((device) => device.uid === remembered)
            ?? devices.find((device) => device.uid === defaultUid)
            ?? devices[0],
        });
      })
      .catch((error) => store.set({ devices: [], printerError: error.message }));
  }

  await store.loadTemplate(203).catch(() => {});
  render(store.state);
  if (calibrating) dom.calibrate.hidden = false;
}());
