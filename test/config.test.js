import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, describeDateOrder, DEFAULT_DATE_ORDER } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

test('the date order defaults to MDY, matching the sample documents', () => {
  assert.equal(loadConfig({ env: {} }).dateOrder, 'MDY');
  assert.equal(DEFAULT_DATE_ORDER, 'MDY');
});

test('the environment overrides the default', () => {
  assert.equal(loadConfig({ env: { STICKER_DATE_ORDER: 'DMY' } }).dateOrder, 'DMY');
});

test('an unrecognised date order fails at boot rather than being ignored', () => {
  assert.throws(() => loadConfig({ env: { STICKER_DATE_ORDER: 'YDM' } }), ConfigError);
  assert.throws(() => loadConfig({ env: { STICKER_DATE_ORDER: 'mdy' } }), ConfigError);
});

test('the resolved order is logged at boot with a worked example', () => {
  const logged = [];
  loadConfig({ env: {}, logger: { info: (entry) => logged.push(entry) } });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].dateOrder, 'MDY');
  assert.equal(logged[0].dateOrderSource, 'default');
  assert.match(logged[0].example, /4 September 2026/);
});

test('the log distinguishes a configured order from the default', () => {
  const logged = [];
  loadConfig({
    env: { STICKER_DATE_ORDER: 'DMY' },
    logger: { info: (entry) => logged.push(entry) },
  });
  assert.equal(logged[0].dateOrderSource, 'environment');
  assert.match(logged[0].example, /9 April 2026/);
});

test('every supported order has a worked example', () => {
  for (const order of ['MDY', 'DMY', 'YMD']) {
    assert.equal(typeof describeDateOrder(order), 'string');
  }
});

test('no batch format is enforced unless one is configured', () => {
  assert.equal(loadConfig({ env: {} }).batchPattern, null);
  assert.equal(
    loadConfig({ env: { STICKER_BATCH_PATTERN: '^LOT-\\d{4}$' } }).batchPattern.source,
    '^LOT-\\d{4}$',
  );
  assert.throws(() => loadConfig({ env: { STICKER_BATCH_PATTERN: '^[unclosed' } }), ConfigError);
});

test('the manufacturer has a default and a fixed printed prefix', () => {
  const config = loadConfig({ env: {} });
  assert.equal(config.defaultManufacturer, 'Miscellaneous Supplier');
  assert.equal(config.manufacturerPrefix, 'MANUFACTURER - ');
  assert.equal(
    loadConfig({ env: { STICKER_DEFAULT_MANUFACTURER: 'Acme' } }).defaultManufacturer,
    'Acme',
  );
});
