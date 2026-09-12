/**
 * Which slot actually carries a position.
 *
 * Only six of the eleven slots on the reference label state their own
 * coordinates. The rest are declared relative to something else: the product
 * name sits inside `nameBg` (`"box": "nameBg"`), the dates flow after `qtyBg`
 * (`"flow": {"after": "qtyBg"}`), and the QR is pinned to the right edge by a
 * margin rather than an x.
 *
 * Nudging one of those wrote an `x` the layout never reads, so the arrow keys
 * did nothing at all and said nothing either — which reads as a broken
 * feature rather than a derived slot. Resolving the reference first means
 * nudging the product name moves its bar, which is what someone pressing the
 * key meant; and where a slot is anchored by a margin, the margin is what
 * moves.
 *
 * Pure, and its own module, so it can be tested without a browser.
 */

/**
 * @typedef {object} MoveTarget
 * @property {object} slot     The slot whose geometry to change.
 * @property {string} id       That slot's id.
 * @property {string|null} via The slot the operator selected, when it differs.
 * @property {'xy'|'rightMargin'} axis How horizontal movement applies.
 */

/**
 * @param {{ slots?: object[] }} template
 * @param {string} slotId
 * @returns {MoveTarget|null} null when the slot is not in the template at all.
 */
export function resolveMoveTarget(template, slotId) {
  const slots = template?.slots ?? [];
  const selected = slots.find((slot) => slot.id === slotId);
  if (!selected) return null;

  // Anchored to an edge by a margin: there is no x to change, so horizontal
  // movement adjusts the margin instead — and in the opposite direction,
  // since a smaller right margin moves the slot right.
  if (selected.anchor === 'right' && selected.rightMargin !== undefined) {
    return { slot: selected, id: selected.id, via: null, axis: 'rightMargin' };
  }

  const reference = selected.box ?? selected.flow?.after ?? null;
  if (reference) {
    const anchor = slots.find((slot) => slot.id === reference);
    // A reference that is not in the template is a template bug, not a reason
    // to move nothing: fall back to the slot itself.
    if (anchor) return { slot: anchor, id: anchor.id, via: selected.id, axis: 'xy' };
  }

  return { slot: selected, id: selected.id, via: null, axis: 'xy' };
}

/**
 * Apply a nudge, returning what actually changed so the operator can be told.
 *
 * @param {{ slots?: object[] }} template
 * @param {string} slotId
 * @param {number} dx
 * @param {number} dy
 * @returns {{ id: string, via: string|null }|null}
 */
export function nudgeSlot(template, slotId, dx, dy) {
  const target = resolveMoveTarget(template, slotId);
  if (!target) return null;
  const { slot } = target;

  if (target.axis === 'rightMargin') {
    slot.rightMargin = Math.max(0, slot.rightMargin - dx);
  } else if (dx !== 0) {
    slot.x = (slot.x ?? 0) + dx;
  }
  if (dy !== 0) slot.y = (slot.y ?? 0) + dy;

  return { id: target.id, via: target.via };
}

/**
 * Resize, one axis at a time.
 *
 * Whether a slot can be resized has to be asked **per axis**, not per slot.
 * `qtyBg` states a height and takes its width from its content, so widening
 * it is not a thing the template can express — and reporting success for that
 * would be exactly the silent no-op that made the arrow keys look broken.
 *
 * @param {{ slots?: object[] }} template
 * @param {string} slotId
 * @param {number} dw
 * @param {number} dh
 * @returns {{ id: string, via: string|null, axis: 'w'|'h' }|null} null when
 *   the axis being changed is not one the template states.
 */
export function resizeSlot(template, slotId, dw, dh) {
  const target = resolveMoveTarget(template, slotId);
  if (!target) return null;
  const { slot } = target;

  if (dw !== 0 && slot.w === undefined) return null;
  if (dh !== 0 && slot.h === undefined) return null;
  if (dw === 0 && dh === 0) return null;

  // A slot cannot be shrunk out of existence: at zero it stops being
  // something you can click on to get back.
  if (dw !== 0) slot.w = Math.max(1, slot.w + dw);
  if (dh !== 0) slot.h = Math.max(1, slot.h + dh);

  return { id: target.id, via: target.via, axis: dw !== 0 ? 'w' : 'h' };
}

/**
 * Which axes of a slot the template actually states, for the readout.
 *
 * @param {{ slots?: object[] }} template
 * @param {string} slotId
 * @returns {{ width: boolean, height: boolean }}
 */
export function resizableAxes(template, slotId) {
  const target = resolveMoveTarget(template, slotId);
  if (!target) return { width: false, height: false };
  return { width: target.slot.w !== undefined, height: target.slot.h !== undefined };
}
