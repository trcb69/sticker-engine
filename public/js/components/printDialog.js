/**
 * Print confirmation.
 *
 * The failure this exists to prevent is a run of four hundred labels nobody
 * meant to send. So the dialog states the exact total in words before anything
 * leaves, and above a threshold it will not proceed until the number has been
 * typed — which cannot be done by muscle memory.
 */

import { el, replace } from '../dom.js';
import { labelCount } from '../format.js';

/**
 * @param {HTMLElement} root
 * @param {{ lines: object[], threshold: number, dpi: number,
 *           onConfirm: () => void, onCancel: () => void }} options
 */
export function openPrintDialog(root, options) {
  const total = options.lines.reduce((sum, line) => sum + (line.copies ?? 1), 0);
  const needsTyping = total >= options.threshold;

  const confirmInput = el('input.input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-label': `Type ${total} to confirm`,
    placeholder: String(total),
    oninput: () => { confirmButton.disabled = confirmInput.value.trim() !== String(total); },
    onkeydown: (event) => {
      if (event.key === 'Enter' && !confirmButton.disabled) options.onConfirm();
    },
  });

  const confirmButton = el('button.btn.btn--primary.btn--large', {
    type: 'button',
    text: `Print ${labelCount(total)}`,
    disabled: needsTyping,
    onclick: options.onConfirm,
  });

  const dialog = el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [
    el('div.modal__panel', {}, [
      el('h2.modal__title', { text: 'Confirm the run' }),
      el('p.modal__total', {}, [
        'This will send ',
        el('strong', { text: labelCount(total) }),
        ` across ${options.lines.length} item${options.lines.length === 1 ? '' : 's'}, at ${options.dpi} dpi.`,
      ]),
      el('ul.modal__lines', {}, options.lines.map((line) => el('li', {}, [
        el('span', { text: line.displayName?.value ?? `Line ${line.index}` }),
        el('span.modal__copies', { text: `× ${line.copies ?? 1}` }),
      ]))),
      needsTyping
        ? el('div.modal__gate', {}, [
          el('label', { for: 'confirm-total', text: `That is a large run. Type ${total} to continue.` }),
          confirmInput,
        ])
        : null,
      el('div.modal__actions', {}, [
        el('button.btn.btn--ghost.btn--large', {
          type: 'button', text: 'Cancel', onclick: options.onCancel,
        }),
        confirmButton,
      ]),
    ]),
  ]);

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') options.onCancel();
  });

  replace(root, [dialog]);
  root.hidden = false;
  (needsTyping ? confirmInput : confirmButton).focus();
}

/** @param {HTMLElement} root */
export function closePrintDialog(root) {
  replace(root, []);
  root.hidden = true;
}
