/**
 * Token binding.
 *
 * A bind string contains `{token}` placeholders resolved against a flat
 * context of Fields or bare values. An unknown token is a template bug and
 * throws; a known token whose Field is absent yields the empty string, which
 * callers treat as "this part is not present".
 */

import { TemplateBindError } from '../errors.js';
import { isPresent, textOf } from '../model/types.js';

const TOKEN = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * @param {string} bind
 * @returns {string[]} token names, in order of appearance
 */
export function tokensIn(bind) {
  return [...bind.matchAll(TOKEN)].map((match) => match[1]);
}

/**
 * Resolve a bind string.
 *
 * `present` is false when the string contains at least one token and every
 * token resolved to an absent value — that is the signal to drop the slot. A
 * bind string with no tokens at all is literal text and always present.
 *
 * @param {string} bind
 * @param {Record<string, unknown>} context
 * @param {{ slotId?: string }} [options]
 * @returns {{ text: string, present: boolean }}
 */
export function resolveBind(bind, context, options = {}) {
  const names = tokensIn(bind);
  if (names.length === 0) return { text: bind, present: bind.length > 0 };

  let anyPresent = false;
  const text = bind.replace(TOKEN, (_match, name) => {
    if (!(name in context)) {
      throw new TemplateBindError(
        `Label template refers to an unknown value "${name}".`,
        { detail: `slot=${options.slotId ?? '(unknown)'} token=${name}` },
      );
    }
    const value = context[name];
    if (!isPresent(value)) return '';
    anyPresent = true;
    return textOf(value);
  });

  return { text: anyPresent ? text.trim() : '', present: anyPresent };
}

/**
 * Resolve a list of bind strings, dropping absent ones.
 *
 * This is how requirement D2 is met structurally: an absent document number
 * removes its own part from the list before any separator is inserted, so the
 * separator can never be left stranded. There is no post-hoc cleanup pass to
 * get wrong.
 *
 * @param {string[]} parts
 * @param {Record<string, unknown>} context
 * @param {{ slotId?: string }} [options]
 * @returns {string[]} present parts only, in order
 */
export function resolveParts(parts, context, options = {}) {
  const resolved = [];
  for (const part of parts) {
    const { text, present } = resolveBind(part, context, options);
    if (present && text.length > 0) resolved.push(text);
  }
  return resolved;
}
