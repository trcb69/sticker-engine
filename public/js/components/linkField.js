/**
 * ClickUp link field.
 *
 * Paste the full form URL, press Proceed, and the field collapses to the short
 * link with its character count and the resulting QR module count. The full URL
 * is never encoded: at sixty characters it needs 37 modules and drops to two
 * dots per module in the label's budget, which scans intermittently — the worst
 * failure available, because it passes on the desk and fails in the warehouse.
 */

import { el, replace } from '../dom.js';
import { qrVerdict } from '../format.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {{ onProceed: (url: string) => void, onEdit: () => void }} handlers
 */
export function renderLinkField(root, state, handlers) {
  const link = state.link;
  const done = link.stage === 'done' && link.result;

  if (done) {
    const verdict = qrVerdict(link.result.plan);
    replace(root, [
      el('div.link__done', {}, [
        el('div.link__row', {}, [
          el('code.link__short', { text: link.result.shortUrl }),
          el('button.btn.btn--ghost', {
            type: 'button', text: 'Edit', onclick: handlers.onEdit,
          }),
        ]),
        el('div.link__meta', {}, [
          el('span', { text: `${link.result.payload?.length ?? 0} characters` }),
          el('span.dot', { text: '·' }),
          el('span', { text: `${link.result.plan?.modules ?? '—'} modules` }),
          el('span.dot', { text: '·' }),
          el('span', { text: `error correction ${link.result.plan?.ecc ?? '—'}` }),
        ]),
        el('div.verdict', { class: `verdict--${verdict.level}` }, [
          el('span.verdict__dot'),
          el('span', { text: verdict.label }),
        ]),
      ]),
    ]);
    return;
  }

  const input = el('input.input', {
    id: 'clickup-url',
    type: 'url',
    placeholder: 'https://forms.clickup.com/…',
    value: link.url ?? '',
    autocomplete: 'off',
    spellcheck: 'false',
    onkeydown: (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    },
  });

  const submit = () => {
    const value = input.value.trim();
    if (value) handlers.onProceed(value);
  };

  replace(root, [
    el('div.link__row', {}, [
      input,
      el('button.btn.btn--primary', {
        type: 'button',
        text: link.stage === 'working' ? 'Shortening…' : 'Proceed',
        disabled: link.stage === 'working',
        onclick: submit,
      }),
    ]),
    link.error
      ? el('div.verdict.verdict--bad', {}, [
        el('span.verdict__dot'),
        el('span', { text: link.error.message }),
      ])
      : el('p.hint', {
        text: 'Pasted in full, then shortened. The whole URL will not fit in a QR this size.',
      }),
  ]);
}
