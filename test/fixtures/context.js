/**
 * Canonical render contexts. The golden ZPL is generated from `referenceContext`.
 */

import { field, missing } from '../../src/model/types.js';
import { formatQuantity } from '../../src/model/qty.js';

/** The label reproduced in the build plan. */
export const referenceContext = Object.freeze({
  customer: field('Hi Fashion Holdings Pvt Ltd', 'extracted'),
  docNo: field('RSMINV26091080', 'extracted'),
  manufacturer: field('Miscellaneous Supplier', 'manual'),
  displayName: field('Win-Poly Blue 7007', 'extracted'),
  qtyText: field(formatQuantity('310', 'ml'), 'extracted'),
  mnfDate: field('05/2026', 'manual'),
  expDate: field('05/2028', 'manual'),
  batchCode: field('JUR260725', 'manual'),
  qrPayload: field('HTTPS://X.GD/HFH7K2', 'derived'),
  qrEcc: field('M', 'derived'),
});

/**
 * @param {Partial<Record<string, unknown>>} overrides
 * @returns {Record<string, unknown>}
 */
export function contextWith(overrides) {
  return { ...referenceContext, ...overrides };
}

/** A long product name and a mass quantity. */
export const longNameContext = contextWith({
  displayName: field('FW-777-Hybrid White Reactant Compound', 'extracted'),
  qtyText: field(formatQuantity('0.30', 'kg'), 'extracted'),
});

/** Document number not extracted - the D2 case. */
export const noDocNoContext = contextWith({
  docNo: missing('Sample Note was not uploaded'),
  displayName: field('8700T Clear Paste', 'extracted'),
  qtyText: field(formatQuantity('1.000', 'kg'), 'extracted'),
});
