import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQuantity, displayUnit, unitKind, amountValue } from '../src/model/qty.js';

test('the numeral is printed exactly as the document wrote it', () => {
  // "As written" is the rule. Trailing zeros are the document's own statement
  // of precision and are not the label engine's to discard.
  assert.equal(formatQuantity('0.30', 'kg'), '0.30KG');
  assert.equal(formatQuantity('1.000', 'kg'), '1.000KG');
  assert.equal(formatQuantity('0.04', 'KG'), '0.04KG');
  assert.equal(formatQuantity('310', 'ml'), '310ML');
});

test('nothing is ever converted between units', () => {
  // 0.04 kg is 40 g and 1.5 L is 1500 ml, and the label says neither. The unit
  // on the document is the unit on the sticker.
  assert.equal(formatQuantity('0.04', 'kg'), '0.04KG');
  assert.equal(formatQuantity('1.5', 'l'), '1.5L');
  assert.equal(formatQuantity('1500', 'ml'), '1500ML');
});

test('units print uppercase however the document cased them', () => {
  for (const written of ['kg', 'KG', 'Kg']) assert.equal(displayUnit(written), 'KG');
  for (const written of ['ml', 'ML', 'mL']) assert.equal(displayUnit(written), 'ML');
  for (const written of ['l', 'L', 'ltr', 'litre']) assert.equal(displayUnit(written), 'L');
});

test('an unfamiliar unit reaches the label rather than stopping the job', () => {
  assert.equal(formatQuantity('12', 'drum'), '12DRUM');
  assert.equal(unitKind('drum'), 'unknown');
});

test('a quantity with no unit prints as a bare number', () => {
  assert.equal(formatQuantity('2'), '2');
  assert.equal(formatQuantity('2', null), '2');
  assert.equal(displayUnit(null), '');
});

test('units are classified for the checks that need it', () => {
  assert.equal(unitKind('kg'), 'mass');
  assert.equal(unitKind('g'), 'mass');
  assert.equal(unitKind('ml'), 'volume');
  assert.equal(unitKind('L'), 'volume');
  assert.equal(unitKind('pcs'), 'count');
});

test('a blank amount is refused rather than printing an empty quantity', () => {
  assert.throws(() => formatQuantity('', 'kg'), TypeError);
  assert.throws(() => formatQuantity(null, 'kg'), TypeError);
});

test('the numeric value is available for arithmetic but never for printing', () => {
  assert.equal(amountValue('0.30'), 0.3);
  assert.equal(amountValue('0,30'), 0.3, 'a comma decimal separator');
  assert.equal(amountValue('abc'), null);
});

test('a volume in litres prints as litres, not split into millilitres', () => {
  // Confirmed with the warehouse coordinator: 1.5 l prints as 1.5L. Splitting
  // it into "1L 500ML" would be a conversion, and nothing here converts.
  assert.equal(formatQuantity('1.5', 'l'), '1.5L');
  assert.equal(formatQuantity('2', 'L'), '2L');
  assert.equal(formatQuantity('0.75', 'litre'), '0.75L');
});
