/**
 * Provenance bar (requirement D2).
 *
 * One chip per job-level value, showing where it came from and, when it is
 * absent, what it is waiting for. Missing is drawn differently from
 * empty-but-optional because those mean different things to an operator: one
 * blocks a print run, the other does not.
 */

import { el, replace } from '../dom.js';
import { provenanceOf, valueOf } from '../format.js';

const FIELDS = [
  { key: 'customer', label: 'Customer', focus: null },
  { key: 'docNo', label: 'Document no', focus: null },
  { key: 'manufacturer', label: 'Manufacturer', focus: 'manufacturer' },
  { key: 'qrUrl', label: 'ClickUp link', focus: 'clickup-url' },
];

const WORDING = {
  extracted: 'read from the document',
  derived: 'worked out by the system',
  manual: 'entered by you',
  missing: 'not set',
};

/**
 * @param {HTMLElement} root
 * @param {object} state
 */
export function renderProvenanceBar(root, state) {
  const job = state.job;
  if (!job) { replace(root, []); return; }

  const chips = FIELDS.map((spec) => {
    const field = job[spec.key];
    const provenance = provenanceOf(field);
    const value = valueOf(field);
    const optional = spec.key === 'qrUrl';

    return el(
      'button.chip',
      {
        class: `chip--${provenance}${provenance === 'missing' && optional ? ' chip--optional' : ''}`,
        type: 'button',
        title: `${spec.label}: ${WORDING[provenance]}`,
        'aria-label': `${spec.label}, ${WORDING[provenance]}. ${value || field?.note || ''}`,
        onclick: () => {
          if (!spec.focus) return;
          const target = document.getElementById(spec.focus);
          target?.focus();
          target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        },
      },
      [
        el('span.chip__label', { text: spec.label }),
        el('span.chip__value', {
          text: value || (provenance === 'missing' ? (optional ? 'optional' : 'needed') : '—'),
        }),
      ],
    );
  });

  const counts = job.provenance?.counts ?? {};
  const total = job.provenance?.total ?? 0;
  const known = total - (counts.missing ?? 0);

  replace(root, [
    el('div.provenance__chips', {}, chips),
    el('div.provenance__count', {}, [
      el('strong', { text: `${known} of ${total}` }),
      ' values read or set',
      counts.missing
        ? el('span.provenance__missing', { text: ` · ${counts.missing} still needed` })
        : null,
    ]),
  ]);
}
