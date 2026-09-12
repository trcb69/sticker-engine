/**
 * Client state and the optimistic edit queue.
 *
 * An edit shows immediately and is sent in the background, because a warehouse
 * operator typing a batch code should never wait on a round trip. The server's
 * reply then replaces the optimistic value, since only the server knows the
 * recomputed status, provenance and warnings.
 *
 * Edits to one line are queued rather than fired in parallel. Two PATCHes in
 * flight for the same line can land out of order, and the loser silently
 * overwrites the winner — with a batch number, that is a wrong label nobody
 * can see is wrong.
 */

import * as api from './api.js';

/**
 * @param {(state: object) => void} onChange
 */
export function createStore(onChange) {
  /** @type {object} */
  let state = {
    job: null,
    dpi: 203,
    selectedLine: null,
    selectedForPrint: new Set(),
    // Lines the operator has deliberately excluded, so auto-selection does not
    // quietly put them back.
    deselected: new Set(),
    template: null,
    previews: new Map(),
    link: { stage: 'empty', url: '', result: null, error: null },
    busy: false,
    error: null,
    pending: new Map(),
  };

  /** @type {Map<number|'job', Promise<unknown>>} */
  const queues = new Map();

  // Renders are scheduled rather than run inline.
  //
  // An edit commits from a blur handler, and rebuilding the panel while the
  // browser is still dispatching that blur means removing the very node it is
  // dispatching on — which throws part-way through and leaves the grid half
  // rebuilt. Deferring to the next frame also coalesces a burst of updates
  // into a single pass, which matters when a fill-down touches every row.
  let scheduled = false;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 0);

  const emit = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => { scheduled = false; onChange(state); });
  };

  const set = (patch) => { state = { ...state, ...patch }; emit(); };

  /**
   * Run work serially per key, so edits to one line cannot land out of order.
   * @param {number|'job'} key
   * @param {() => Promise<unknown>} work
   */
  function enqueue(key, work) {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    queues.set(key, next.catch(() => {}));
    return next;
  }

  return {
    get state() { return state; },
    set,

    async loadTemplate(dpi) {
      set({ template: await api.getTemplate(dpi), dpi });
    },

    async upload(files) {
      set({ busy: true, error: null });
      try {
        const job = await api.createJob(files);
        set({
          job,
          busy: false,
          selectedLine: job.lines.find((line) => line.status !== 'ready')?.index ?? job.lines[0]?.index ?? null,
          selectedForPrint: new Set(job.lines.filter((l) => l.status === 'ready').map((l) => l.index)),
        });
        return job;
      } catch (error) {
        set({ busy: false, error });
        throw error;
      }
    },

    async setDpi(dpi) {
      await this.loadTemplate(dpi);
    },

    selectLine(index) {
      set({ selectedLine: index });
    },

    togglePrint(index, on) {
      const next = new Set(state.selectedForPrint);
      const deselected = new Set(state.deselected);
      if (on) { next.add(index); deselected.delete(index); }
      else { next.delete(index); deselected.add(index); }
      set({ selectedForPrint: next, deselected });
    },

    selectAllReady(on) {
      const ready = state.job.lines.filter((line) => line.status === 'ready').map((l) => l.index);
      set({
        selectedForPrint: on ? new Set(ready) : new Set(),
        deselected: on ? new Set() : new Set(ready),
      });
    },

    /**
     * Apply a line edit optimistically, then reconcile.
     * @param {number} index
     * @param {Record<string, unknown>} patch
     */
    editLine(index, patch) {
      const optimistic = state.job.lines.map((line) => (line.index === index
        ? { ...line, ...optimisticFields(patch, line) }
        : line));
      const pending = new Map(state.pending);
      pending.set(index, (pending.get(index) ?? 0) + 1);
      set({ job: { ...state.job, lines: optimistic }, pending });

      return enqueue(index, async () => {
        try {
          const result = await api.patchLine(state.job.id, index, patch);
          const lines = state.job.lines.map((line) => (line.index === index ? result.line : line));
          const nextPending = new Map(state.pending);
          const count = (nextPending.get(index) ?? 1) - 1;
          if (count > 0) nextPending.set(index, count); else nextPending.delete(index);

          // A line that has just become ready joins the run. Finishing a row
          // and then having to tick it as well is a step nobody would thank us
          // for, and forgetting it means the label silently does not print.
          // Unticking still holds: `deselected` remembers a deliberate choice.
          const selectedForPrint = new Set(state.selectedForPrint);
          if (result.line.status === 'ready' && !state.deselected.has(index)) {
            selectedForPrint.add(index);
          } else if (result.line.status !== 'ready') {
            selectedForPrint.delete(index);
          }

          set({
            job: { ...state.job, lines, readiness: result.readiness },
            selectedForPrint,
            pending: nextPending,
            error: null,
          });
          return result;
        } catch (error) {
          // Put the server's truth back. An edit that did not stick must not
          // keep looking as though it did.
          const fresh = await api.getJob(state.job.id).catch(() => null);
          const nextPending = new Map(state.pending);
          nextPending.delete(index);
          set({ job: fresh ?? state.job, pending: nextPending, error });
          throw error;
        }
      });
    },

    /**
     * @param {Record<string, unknown>} patch
     */
    editJob(patch) {
      return enqueue('job', async () => {
        try {
          const job = await api.patchJob(state.job.id, patch);
          set({ job, error: null });
          return job;
        } catch (error) {
          set({ error });
          throw error;
        }
      });
    },

    async shortenLink(url) {
      set({ link: { ...state.link, stage: 'working', url, error: null } });
      try {
        const job = await api.patchJob(state.job.id, { qrUrl: url });
        set({
          job,
          link: {
            stage: 'done',
            url,
            result: {
              code: job.qrShortCode.value,
              shortUrl: `https://x.gd/${job.qrShortCode.value}`,
              payload: job.qrPayload?.value ?? null,
              plan: job.qrPlan,
            },
            error: null,
          },
        });
      } catch (error) {
        set({ link: { ...state.link, stage: 'error', url, error } });
      }
    },

    editLink() {
      set({ link: { ...state.link, stage: 'editing' } });
    },

    clearError() {
      set({ error: null });
    },
  };

  /**
   * Guess what the server will make of an edit, so the field looks committed
   * straight away. Only the shape is guessed; status and warnings wait for the
   * real answer.
   * @param {Record<string, unknown>} patch
   * @param {object} line
   */
  function optimisticFields(patch, line) {
    const out = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'copies') { out.copies = value; continue; }
      out[key] = value === null || value === ''
        ? { value: null, provenance: 'missing' }
        : { value, provenance: 'manual' };
    }
    return out;
  }
}
