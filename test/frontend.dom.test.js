import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The components are plain DOM builders, so they can be exercised against a
 * jsdom document. That is worth doing for the grid in particular: its keyboard
 * behaviour is the feature, and a broken Enter key would otherwise only be
 * found by someone standing at a printer.
 */
async function withDom(run) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  const previous = { document: global.document, window: global.window, Node: global.Node };
  global.document = dom.window.document;
  global.window = dom.window;
  global.Node = dom.window.Node;
  try {
    await run(dom.window.document);
  } finally {
    Object.assign(global, previous);
  }
}

const job = () => ({
  id: 'job-1',
  customer: { value: 'Jay Jay Mills Lanka (PVT) Ltd', provenance: 'extracted' },
  docNo: { value: 'RSMINV26091087', provenance: 'extracted' },
  manufacturer: { value: 'Miscellaneous Supplier', provenance: 'derived' },
  qrUrl: { value: null, provenance: 'missing' },
  provenance: { total: 5, counts: { extracted: 2, derived: 1, manual: 0, missing: 2 } },
  readiness: { ready: 1, total: 2 },
  enrichWarnings: [],
  lines: [
    {
      index: 1,
      displayName: { value: 'FW-777-Hybrid White', provenance: 'extracted' },
      qtyAmount: { value: '0.30', provenance: 'extracted' },
      qtyUom: { value: 'kg', provenance: 'extracted' },
      qtyText: '0.30KG',
      mnfDate: { value: '05/2026', provenance: 'manual' },
      expDate: { value: '05/2028', provenance: 'manual' },
      batchCode: { value: 'JUR260725', provenance: 'manual' },
      copies: 1,
      status: 'ready',
    },
    {
      index: 2,
      displayName: { value: 'FC-777 Hybrid Clear', provenance: 'extracted' },
      qtyAmount: { value: '0.30', provenance: 'extracted' },
      qtyUom: { value: null, provenance: 'missing' },
      qtyText: '0.30',
      mnfDate: { value: null, provenance: 'missing' },
      expDate: { value: null, provenance: 'missing' },
      batchCode: { value: null, provenance: 'missing' },
      copies: 1,
      status: 'incomplete',
    },
  ],
});

const state = (overrides = {}) => ({
  job: job(),
  selectedLine: 1,
  selectedForPrint: new Set([1]),
  pending: new Map(),
  link: { stage: 'empty', url: '', result: null, error: null },
  ...overrides,
});

/* -- Provenance bar ------------------------------------------------------- */

test('each job field gets a chip carrying its provenance', async () => {
  await withDom(async (document) => {
    const { renderProvenanceBar } = await import('../public/js/components/provenanceBar.js');
    const root = document.createElement('div');
    renderProvenanceBar(root, state());

    const chips = [...root.querySelectorAll('.chip')];
    assert.equal(chips.length, 4);
    assert.ok(chips[0].className.includes('chip--extracted'));
    assert.ok(chips[2].className.includes('chip--derived'));
    assert.match(root.querySelector('.provenance__count').textContent, /3 of 5/);
  });
});

test('an absent optional field is drawn differently from an absent required one', async () => {
  await withDom(async (document) => {
    const { renderProvenanceBar } = await import('../public/js/components/provenanceBar.js');
    const root = document.createElement('div');
    const current = state();
    current.job.manufacturer = { value: null, provenance: 'missing' };
    renderProvenanceBar(root, current);

    const manufacturer = [...root.querySelectorAll('.chip')][2];
    const clickup = [...root.querySelectorAll('.chip')][3];
    assert.ok(manufacturer.className.includes('chip--missing'));
    assert.ok(!manufacturer.className.includes('chip--optional'));
    assert.ok(clickup.className.includes('chip--optional'), 'the link is not required to print');
    assert.match(manufacturer.textContent, /needed/);
    assert.match(clickup.textContent, /optional/);
  });
});

/* -- Line grid ------------------------------------------------------------ */

test('the grid renders a row per line with its status in words', async () => {
  await withDom(async (document) => {
    const { renderLineGrid } = await import('../public/js/components/lineGrid.js');
    const root = document.createElement('div');
    renderLineGrid(root, state(), noopHandlers());

    const rows = [...root.querySelectorAll('.row')];
    assert.equal(rows.length, 2);
    assert.ok(rows[0].className.includes('row--ready'));
    assert.ok(rows[1].className.includes('row--incomplete'));
    // Status is never carried by colour alone.
    assert.match(rows[0].querySelector('.status').textContent, /Ready/);
    assert.match(rows[1].querySelector('.status').textContent, /Needs batch, MNF, EXP/);
  });
});

test('a line that is not ready cannot be ticked for printing', async () => {
  await withDom(async (document) => {
    const { renderLineGrid } = await import('../public/js/components/lineGrid.js');
    const root = document.createElement('div');
    renderLineGrid(root, state(), noopHandlers());

    const checks = [...root.querySelectorAll('.row .cell--check input')];
    assert.equal(checks[0].disabled, false);
    assert.equal(checks[1].disabled, true, 'ticking it would do nothing at print time');
  });
});

test('a missing unit is badged on the row rather than hidden', async () => {
  await withDom(async (document) => {
    const { renderLineGrid } = await import('../public/js/components/lineGrid.js');
    const root = document.createElement('div');
    renderLineGrid(root, state(), noopHandlers());
    const badges = [...root.querySelectorAll('.row')][1].querySelectorAll('.badge--warn');
    assert.equal(badges.length, 1);
    assert.match(badges[0].textContent, /no unit/);
  });
});

test('a date normalises on blur and commits the normalised value', async () => {
  await withDom(async (document) => {
    const { renderLineGrid } = await import('../public/js/components/lineGrid.js');
    const edits = [];
    const root = document.createElement('div');
    document.body.append(root);
    renderLineGrid(root, state(), noopHandlers({ onEdit: (index, patch) => edits.push([index, patch]) }));

    const input = root.querySelector('[data-line="2"][data-field="mnfDate"]');
    input.value = '052026';
    input.dispatchEvent(new window.Event('blur'));

    assert.equal(input.value, '05/2026', 'rewritten only once the operator has finished');
    assert.deepEqual(edits, [[2, { mnfDate: '05/2026' }]]);
  });
});

test('Enter in the batch field commits and moves to the next incomplete row', async () => {
  await withDom(async (document) => {
    const { renderLineGrid } = await import('../public/js/components/lineGrid.js');
    const edits = [];
    const advanced = [];
    const root = document.createElement('div');
    document.body.append(root);
    renderLineGrid(root, state(), noopHandlers({
      onEdit: (index, patch) => edits.push([index, patch]),
      onAdvance: (index) => advanced.push(index),
    }));

    const input = root.querySelector('.input--batch[data-line="1"]');
    input.value = 'JUR260726';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // A scanner sends its payload then a carriage return, so this is the
    // whole interaction: scan, Enter, next row.
    assert.deepEqual(edits, [[1, { batchCode: 'JUR260726' }]]);
    assert.deepEqual(advanced, [1]);
  });
});

test('an out-of-range copy count is rejected and the field reverts', async () => {
  await withDom(async (document) => {
    const { renderLineGrid } = await import('../public/js/components/lineGrid.js');
    const edits = [];
    const root = document.createElement('div');
    document.body.append(root);
    renderLineGrid(root, state(), noopHandlers({ onEdit: (i, p) => edits.push([i, p]) }));

    const input = root.querySelector('.row .input--copies');
    input.value = '0';
    input.dispatchEvent(new window.Event('change'));
    assert.deepEqual(edits, []);
    assert.equal(input.value, '1', 'put back rather than left showing a value that was refused');

    input.value = '4';
    input.dispatchEvent(new window.Event('change'));
    assert.deepEqual(edits, [[1, { copies: 4 }]]);
  });
});

/* -- Link field ----------------------------------------------------------- */

test('the link field collapses to the short URL with its symbol verdict', async () => {
  await withDom(async (document) => {
    const { renderLinkField } = await import('../public/js/components/linkField.js');
    const root = document.createElement('div');
    renderLinkField(root, state({
      link: {
        stage: 'done',
        url: 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC',
        result: {
          code: 'HFH7K2',
          shortUrl: 'https://x.gd/HFH7K2',
          payload: 'HTTPS://X.GD/HFH7K2',
          plan: { modules: 29, magnification: 3, ecc: 'Q' },
        },
        error: null,
      },
    }), { onProceed() {}, onEdit() {} });

    assert.match(root.querySelector('.link__short').textContent, /x\.gd\/HFH7K2/);
    assert.match(root.querySelector('.link__meta').textContent, /19 characters/);
    assert.match(root.querySelector('.link__meta').textContent, /29 modules/);
    assert.match(root.querySelector('.link__meta').textContent, /correction Q/);
    assert.ok(root.querySelector('.verdict--tight'), 'three dots per module is the floor');
  });
});

test('Proceed submits on Enter as well as on the button', async () => {
  await withDom(async (document) => {
    const { renderLinkField } = await import('../public/js/components/linkField.js');
    const submitted = [];
    const root = document.createElement('div');
    document.body.append(root);
    renderLinkField(root, state(), { onProceed: (url) => submitted.push(url), onEdit() {} });

    const input = root.querySelector('#clickup-url');
    input.value = 'https://forms.clickup.com/x';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(submitted, ['https://forms.clickup.com/x']);
  });
});

/* -- Print dialog --------------------------------------------------------- */

test('the dialog states the exact total before anything is sent', async () => {
  await withDom(async (document) => {
    const { openPrintDialog } = await import('../public/js/components/printDialog.js');
    const root = document.createElement('div');
    document.body.append(root);
    openPrintDialog(root, {
      lines: [{ index: 1, displayName: { value: 'A' }, copies: 3 },
        { index: 2, displayName: { value: 'B' }, copies: 2 }],
      threshold: 50,
      dpi: 203,
      onConfirm() {}, onCancel() {},
    });

    assert.match(root.querySelector('.modal__total').textContent, /5 labels across 2 items/);
    assert.equal(root.querySelector('.modal__actions .btn--primary').disabled, false);
    assert.equal(root.querySelector('.modal__gate'), null, 'a small run needs no gate');
  });
});

test('a large run will not send until the number has been typed', async () => {
  await withDom(async (document) => {
    const { openPrintDialog } = await import('../public/js/components/printDialog.js');
    const confirmed = [];
    const root = document.createElement('div');
    document.body.append(root);
    openPrintDialog(root, {
      lines: [{ index: 1, displayName: { value: 'A' }, copies: 400 }],
      threshold: 50,
      dpi: 203,
      onConfirm: () => confirmed.push(true),
      onCancel() {},
    });

    const button = root.querySelector('.modal__actions .btn--primary');
    const gate = root.querySelector('.modal__gate .input');
    assert.equal(button.disabled, true);
    assert.match(root.querySelector('.modal__gate').textContent, /Type 400 to continue/);

    gate.value = '40';
    gate.dispatchEvent(new window.Event('input'));
    assert.equal(button.disabled, true, 'a near miss is still refused');

    gate.value = '400';
    gate.dispatchEvent(new window.Event('input'));
    assert.equal(button.disabled, false);
    button.dispatchEvent(new window.MouseEvent('click'));
    assert.equal(confirmed.length, 1);
  });
});

/** @param {object} [overrides] */
function noopHandlers(overrides = {}) {
  return {
    onSelect() {}, onTogglePrint() {}, onSelectAll() {},
    onEdit() {}, onAdvance() {}, onFillDown() {},
    ...overrides,
  };
}
