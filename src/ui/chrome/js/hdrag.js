// Drag-to-reorder along one axis (tabs and favorites: left/right; vertical tabs: up/down).
// The item follows only the mouse's left/right position, never leaves its row (it stops at the edge when the
// mouse goes past), and the others make room as it passes them. A plain click (no movement) is still a click.
const THRESHOLD = 5; // px of movement before a press becomes a drag

/**
 * @param container  element holding the items
 * @param opts.item  selector for draggable items
 * @param opts.group (el) => key; items only swap with others of the same group (pinned / normal tabs)
 * @param opts.drop  (el, orderedItems) => void, called once when the drag ends with a changed order
 * @param opts.axis  () => 'x' | 'y' (default 'x'); read when a drag starts
 */
export function horizontalDrag(container, { item, group = () => 0, drop, axis = () => 'x' }) {
  let drag = null;
  let swallowClick = false;

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest(item);
    if (!el || !container.contains(el) || e.target.closest('button.close')) return;
    const y = axis() === 'y';
    const A = y ? { pos: 'clientY', lo: 'top', hi: 'bottom', size: 'height', t: 'translateY' } : { pos: 'clientX', lo: 'left', hi: 'right', size: 'width', t: 'translateX' };
    drag = { el, pointerId: e.pointerId, A, startX: e[A.pos], started: false, startOrder: [...container.children] };
  });

  // While dragging, follow the mouse anywhere in the window (not just over the row).
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!(e.buttons & 1)) return finish(e);            // button was released somewhere we didn't hear about
    if (!drag.started) {
      if (Math.abs(e[drag.A.pos] - drag.startX) < THRESHOLD) return;
      drag.started = true;
      try { drag.el.setPointerCapture(e.pointerId); } catch {} // keep following even outside the window
      const r = drag.el.getBoundingClientRect();
      drag.grab = drag.startX - r[drag.A.lo];           // where on the item you grabbed it
      drag.el.classList.add('hdragging');
      container.classList.add('hdrag-active');
    }
    move(e[drag.A.pos]);
  });

  const finish = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    try { d.el.releasePointerCapture(d.pointerId); } catch {}
    d.el.style.transform = '';
    d.el.classList.remove('hdragging');
    container.classList.remove('hdrag-active');
    swallowClick = true;                                // the mouseup after a drag isn't a click
    setTimeout(() => { swallowClick = false; }, 0);
    const order = [...container.children];
    if (order.some((x, i) => x !== d.startOrder[i])) drop(d.el, order.filter((x) => x.matches(item)));
  };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  // No "end on blur": clicking a tab activates it and focuses the page, which blurs this view mid-press.
  // Pages' images / links must never start the browser's own drag-and-drop instead of ours.
  container.addEventListener('dragstart', (e) => { if (e.target.closest?.(item) || e.target.parentElement?.closest(item)) e.preventDefault(); });
  container.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  function move(pos) {
    const el = drag.el, { lo, hi, size, t } = drag.A;
    const peers = [...container.querySelectorAll(item)].filter((x) => group(x) === group(el));
    // Limits: the row (and the item's own group) — the item stops at the edge.
    el.style.transform = '';
    const box = container.getBoundingClientRect();
    const first = peers[0].getBoundingClientRect(), last = peers[peers.length - 1].getBoundingClientRect();
    const minLeft = Math.max(box[lo], first[lo]);
    const maxRight = Math.min(box[hi], last[hi]);
    const width = el.getBoundingClientRect()[size];
    const left = Math.max(minLeft, Math.min(pos - drag.grab, maxRight - width));
    const right = left + width;

    // Make room: swap with a neighbour once the item's leading edge crosses that neighbour's middle
    // (edges, not centres, so a wide item can still pass a narrow one at the end of the row).
    for (const other of peers) {
      if (other === el) continue;
      const r = other.getBoundingClientRect();
      const mid = r[lo] + r[size] / 2;
      const before = el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING;
      if (before && left < mid) { container.insertBefore(el, other); break; }
      if (!before && right > mid) { container.insertBefore(el, other.nextSibling); }
    }
    // Moving the element drops the mouse capture; take it back so we keep following outside the window.
    try { if (!el.hasPointerCapture(drag.pointerId)) el.setPointerCapture(drag.pointerId); } catch {}
    // Draw it exactly under the mouse (horizontally only).
    const natural = el.getBoundingClientRect()[lo];
    el.style.transform = `${t}(${left - natural}px)`;
  }

  return { get dragging() { return !!drag?.started; } };
}
