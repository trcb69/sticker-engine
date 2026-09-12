/**
 * The line grid.
 *
 * This is the screen an operator spends their shift on, so it is built around
 * the keyboard rather than the mouse. Every cell is reachable with Tab, the
 * batch field takes scanner input as ordinary keystrokes, and Enter commits and
 * jumps to the next row still needing work — which is the actual rhythm of the
 * job: scan, Enter, scan, Enter.
 */

import { el, replace } from '../dom.js';
import { normaliseMonthYear, provenanceOf, valueOf } from '../format.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {object} handlers
 */
export function renderLineGrid(root, state, handlers) {
  const job = state.job;
  if (!job) { replace(root, []); return; }

  const readyCount = job.lines.filter((line) => line.status === 'ready').length;
  const allReadySelected = readyCount > 0
    && job.lines.filter((l) => l.status === 'ready').every((l) => state.selectedForPrint.has(l.index));

  const head = el('div.grid__head', {}, [
    el('div.cell.cell--check', {}, [
      el('input', {
        type: 'checkbox',
        checked: allReadySelected,
        'aria-label': 'Select every ready line',
        disabled: readyCount === 0,
        onchange: (event) => handlers.onSelectAll(event.target.checked),
      }),
    ]),
    el('div.cell.cell--num', { text: '#' }),
    el('div.cell.cell--item', { text: 'Item' }),
    el('div.cell.cell--qty', { text: 'Qty' }),
    el('div.cell.cell--date', {}, [
      'MNF',
      el('button.linkish', {
        type: 'button', text: 'fill down', title: 'Copy the first manufacture date to every row',
        onclick: () => handlers.onFillDown('mnfDate'),
      }),
    ]),
    el('div.cell.cell--date', {}, [
      'EXP',
      el('button.linkish', {
        type: 'button', text: 'fill down', title: 'Copy the first expiry date to every row',
        onclick: () => handlers.onFillDown('expDate'),
      }),
    ]),
    el('div.cell.cell--batch', { text: 'Batch no' }),
    el('div.cell.cell--copies', { text: 'Copies' }),
    el('div.cell.cell--status', { text: 'Status' }),
  ]);

  const rows = job.lines.map((line) => renderRow(line, state, handlers));

  replace(root, [head, el('div.grid__body', { role: 'rowgroup' }, rows)]);
}

/**
 * @param {object} line
 * @param {object} state
 * @param {object} handlers
 */
function renderRow(line, state, handlers) {
  const ready = line.status === 'ready';
  const selected = state.selectedLine === line.index;
  const pending = state.pending.has(line.index);
  const warnings = (state.job.enrichWarnings ?? []).filter((w) => w.line === line.index);

  const row = el('div.row', {
    class: [
      ready ? 'row--ready' : 'row--incomplete',
      selected ? 'row--selected' : '',
      pending ? 'row--pending' : '',
    ].filter(Boolean).join(' '),
    role: 'row',
    tabindex: '-1',
    dataset: { line: String(line.index) },
    onfocusin: () => handlers.onSelect(line.index),
  }, [
    el('div.cell.cell--check', {}, [
      el('input', {
        type: 'checkbox',
        checked: state.selectedForPrint.has(line.index),
        // A line that is not ready cannot be printed, so it cannot be picked.
        // Leaving it selectable would mean an operator ticking a box that
        // silently does nothing at print time.
        disabled: !ready,
        'aria-label': `Include line ${line.index} in the print run`,
        onchange: (event) => handlers.onTogglePrint(line.index, event.target.checked),
      }),
    ]),
    el('div.cell.cell--num', { text: String(line.index) }),
    el('div.cell.cell--item', {}, [
      el('span.item__name', { text: valueOf(line.displayName) }),
      warnings.length
        ? el('span.badge.badge--warn', {
          text: `${warnings.length}`,
          title: warnings.map((w) => w.message).join('\n'),
        })
        : null,
    ]),
    el('div.cell.cell--qty', {}, [
      el('span.qty', { text: line.qtyText ?? '—' }),
      provenanceOf(line.qtyUom) === 'missing'
        ? el('span.badge.badge--warn', { text: 'no unit', title: 'The Picklist stated no unit for this line' })
        : null,
    ]),
    dateCell(line, 'mnfDate', handlers),
    dateCell(line, 'expDate', handlers),
    el('div.cell.cell--batch', {}, [
      el('input.input.input--batch', {
        type: 'text',
        value: valueOf(line.batchCode),
        placeholder: 'scan or type',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': `Batch number for line ${line.index}`,
        dataset: { line: String(line.index), field: 'batchCode' },
        onfocus: () => handlers.onSelect(line.index),
        onchange: (event) => handlers.onEdit(line.index, { batchCode: event.target.value.trim() || null }),
        onkeydown: (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          // A scanner sends its payload then a carriage return, so Enter is
          // both "I have finished typing" and "the scan is complete".
          event.target.blur();
          handlers.onEdit(line.index, { batchCode: event.target.value.trim() || null });
          handlers.onAdvance(line.index);
        },
      }),
    ]),
    el('div.cell.cell--copies', {}, [
      el('input.input.input--copies', {
        type: 'number',
        min: '1',
        max: '999',
        value: String(line.copies ?? 1),
        'aria-label': `Copies of line ${line.index}`,
        // Every editable cell carries its identity so focus survives the
        // re-render that follows a commit. Without it the cursor jumps out of
        // the field mid-edit.
        dataset: { line: String(line.index), field: 'copies' },
        onchange: (event) => {
          const copies = Number(event.target.value);
          if (Number.isInteger(copies) && copies >= 1 && copies <= 999) {
            handlers.onEdit(line.index, { copies });
          } else {
            event.target.value = String(line.copies ?? 1);
          }
        },
      }),
    ]),
    el('div.cell.cell--status', {}, [
      el('span.status', {
        class: ready ? 'status--ready' : 'status--incomplete',
        text: ready ? 'Ready' : missingLabel(line),
      }),
    ]),
  ]);

  return row;
}

/**
 * @param {object} line
 * @param {'mnfDate'|'expDate'} key
 * @param {object} handlers
 */
function dateCell(line, key, handlers) {
  return el('div.cell.cell--date', {}, [
    el('input.input.input--date', {
      type: 'text',
      value: valueOf(line[key]),
      placeholder: 'MM/YYYY',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-label': `${key === 'mnfDate' ? 'Manufacture' : 'Expiry'} date for line ${line.index}`,
      dataset: { line: String(line.index), field: key },
      onfocus: () => handlers.onSelect(line.index),
      onblur: (event) => {
        // Normalising on blur rather than on every keystroke: rewriting the
        // field while someone is mid-way through typing it is maddening.
        const normalised = normaliseMonthYear(event.target.value);
        if (normalised !== valueOf(line[key])) {
          event.target.value = normalised;
          handlers.onEdit(line.index, { [key]: normalised || null });
        }
      },
      onkeydown: (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.target.blur();
      },
    }),
  ]);
}

/** @param {object} line */
function missingLabel(line) {
  const missing = [];
  if (provenanceOf(line.batchCode) === 'missing') missing.push('batch');
  if (provenanceOf(line.mnfDate) === 'missing') missing.push('MNF');
  if (provenanceOf(line.expDate) === 'missing') missing.push('EXP');
  if (provenanceOf(line.qtyAmount) === 'missing') missing.push('qty');
  return missing.length ? `Needs ${missing.join(', ')}` : 'Incomplete';
}

/**
 * Move focus to the next row that still needs something, wrapping once.
 * @param {object} job
 * @param {number} fromIndex
 */
export function focusNextIncomplete(job, fromIndex) {
  const order = job.lines.map((line) => line.index);
  const start = order.indexOf(fromIndex);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = job.lines[(start + step) % order.length];
    if (candidate.status !== 'ready') {
      const input = document.querySelector(
        `.input--batch[data-line="${candidate.index}"]`,
      );
      input?.focus();
      input?.select();
      return candidate.index;
    }
  }
  return null;
}
