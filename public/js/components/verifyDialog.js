/**
 * Scan-back verification.
 *
 * The run is not finished when the bytes reach the printer; it is finished when
 * someone has read a printed label back. Darkness drift, a dying printhead
 * element and a change of label stock all produce labels that look perfectly
 * fine to a person and fail at the customer. Five seconds with a scanner
 * catches all three before the pallet moves.
 *
 * So this opens by itself after every run, with the field already focused. It
 * can be skipped — an operator with no scanner to hand should not be trapped —
 * but skipping is a deliberate act and the run stays unverified.
 */

import { el, replace } from '../dom.js';

/**
 * @param {HTMLElement} root
 * @param {{ run: object, onVerify: (scanned: string) => Promise<object>,
 *           onSkip: () => void, onDone: () => void }} options
 */
export function openVerifyDialog(root, options) {
  const expected = options.run.lines.map((line) => line.batchCode).filter(Boolean);
  const status = el('div');

  const input = el('input.input.input--batch', {
    id: 'verify-scan',
    type: 'text',
    placeholder: 'scan a printed label',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Scan one printed label',
    onkeydown: (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    },
  });

  const submit = async () => {
    const scanned = input.value.trim();
    if (!scanned) return;
    replace(status, [el('p.hint', { text: 'Checking…' })]);
    try {
      await options.onVerify(scanned);
      replace(status, [
        el('div.verdict.verdict--good', {}, [
          el('span.verdict__dot'),
          el('span', { text: 'Verified. These labels are good to release.' }),
        ]),
      ]);
      setTimeout(options.onDone, 900);
    } catch (error) {
      replace(status, [
        el('div.verdict.verdict--bad', {}, [
          el('span.verdict__dot'),
          el('span', { text: error.message }),
        ]),
        el('p.hint', {
          text: 'Do not release these labels. Check the darkness setting and the printhead, '
            + 'then reprint and scan again.',
        }),
      ]);
      input.select();
    }
  };

  const dialog = el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [
    el('div.modal__panel', {}, [
      el('h2.modal__title', { text: 'Scan one label back' }),
      el('p.modal__total', {}, [
        el('strong', { text: `${options.run.labels} label${options.run.labels === 1 ? '' : 's'}` }),
        ` printed on ${options.run.printer}. Scan one of them to confirm it reads.`,
      ]),
      el('p.hint', {
        text: 'This catches a printer that is drifting light, a failing printhead element, or the '
          + 'wrong stock — none of which look wrong to the eye.',
      }),
      el('div.modal__gate', {}, [
        el('label', { for: 'verify-scan', text: `Expecting ${expected.join(' or ')}` }),
        input,
      ]),
      status,
      el('div.modal__actions', {}, [
        el('button.btn.btn--ghost.btn--large', {
          type: 'button', text: 'Skip — no scanner', onclick: options.onSkip,
        }),
        el('button.btn.btn--primary.btn--large', {
          type: 'button', text: 'Check', onclick: submit,
        }),
      ]),
    ]),
  ]);

  replace(root, [dialog]);
  root.hidden = false;
  input.focus();
}
