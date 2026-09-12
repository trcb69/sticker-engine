import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../public/js/state.js';

/** Wait for the store's deferred render to run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const job = (overrides = {}) => ({
  id: 'job-1',
  readiness: { ready: 0, total: 2 },
  lines: [
    { index: 1, status: 'incomplete', copies: 1, batchCode: { value: null, provenance: 'missing' } },
    { index: 2, status: 'incomplete', copies: 1, batchCode: { value: null, provenance: 'missing' } },
  ],
  ...overrides,
});

test('renders are deferred, not run inside the event that caused them', async () => {
  // An edit commits from a blur handler. Rebuilding the panel while the
  // browser is still dispatching that blur removes the node being blurred and
  // throws part-way through, leaving the grid half rebuilt.
  const renders = [];
  const store = createStore((state) => renders.push(state));
  store.set({ dpi: 300 });
  assert.equal(renders.length, 0, 'nothing rendered synchronously');
  await settle();
  assert.equal(renders.length, 1);
});

test('a burst of updates coalesces into one render', async () => {
  const renders = [];
  const store = createStore((state) => renders.push(state));
  for (let i = 0; i < 8; i += 1) store.set({ dpi: 200 + i });
  await settle();
  assert.equal(renders.length, 1, 'a fill-down touching every row costs one pass');
  assert.equal(renders[0].dpi, 207, 'and the last value wins');
});

test('a line that becomes ready joins the run without a second click', async () => {
  const store = createStore(() => {});
  store.set({ job: job(), selectedForPrint: new Set(), deselected: new Set() });

  // Stand in for the server's reply.
  const ready = { index: 1, status: 'ready', copies: 1, batchCode: { value: 'B1', provenance: 'manual' } };
  await applyServerLine(store, 1, ready);

  assert.deepEqual([...store.state.selectedForPrint], [1]);
});

test('a line the operator unticked is not put back when it becomes ready', async () => {
  const store = createStore(() => {});
  store.set({ job: job(), selectedForPrint: new Set(), deselected: new Set() });
  store.togglePrint(1, false);

  await applyServerLine(store, 1, { index: 1, status: 'ready', copies: 1 });
  assert.deepEqual([...store.state.selectedForPrint], [], 'a deliberate exclusion holds');
});

test('a line that stops being ready drops out of the run', async () => {
  const store = createStore(() => {});
  store.set({ job: job(), selectedForPrint: new Set([1]), deselected: new Set() });
  await applyServerLine(store, 1, { index: 1, status: 'incomplete', copies: 1 });
  assert.deepEqual([...store.state.selectedForPrint], []);
});

test('select-all covers only ready lines and forgets earlier exclusions', async () => {
  const store = createStore(() => {});
  store.set({
    job: job({
      lines: [
        { index: 1, status: 'ready', copies: 1 },
        { index: 2, status: 'incomplete', copies: 1 },
      ],
    }),
    selectedForPrint: new Set(),
    deselected: new Set([1]),
  });
  store.selectAllReady(true);
  assert.deepEqual([...store.state.selectedForPrint], [1]);
  assert.deepEqual([...store.state.deselected], []);

  store.selectAllReady(false);
  assert.deepEqual([...store.state.selectedForPrint], []);
  assert.deepEqual([...store.state.deselected], [1], 'clearing is deliberate too');
});

/**
 * Drive the reconciliation half of an optimistic edit without a network.
 * @param {object} store
 * @param {number} index
 * @param {object} line
 */
async function applyServerLine(store, index, line) {
  const lines = store.state.job.lines.map((candidate) => (candidate.index === index ? line : candidate));
  const selectedForPrint = new Set(store.state.selectedForPrint);
  if (line.status === 'ready' && !store.state.deselected.has(index)) selectedForPrint.add(index);
  else if (line.status !== 'ready') selectedForPrint.delete(index);
  store.set({ job: { ...store.state.job, lines }, selectedForPrint });
  await settle();
}
