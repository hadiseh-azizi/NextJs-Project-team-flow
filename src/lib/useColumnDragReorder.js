"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { moveItem, nearestSlotIndex, shiftForColumn } from "@/lib/columnReorder";

// Pointer-based horizontal reordering for Kanban columns. Deliberately
// not the browser's native HTML5 drag-and-drop (which the task cards
// already use): native DnD can't animate the neighbouring columns
// smoothly, doesn't work on touch screens, and would share drop targets
// with the task drop zones. Pointer events on the drag handle keep the
// two interactions completely separate — a column drag never fires
// dragstart/dragover, so task drop handling can't see it.
//
// While a drag is active nothing goes through React state: the dragged
// column and its neighbours are moved with inline transforms, so moving
// the pointer never re-renders the board (and never re-creates the task
// lists inside it). React only re-renders once, on drop, when the new
// order is committed.

const MOVE_TRANSITION = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
const SETTLE_MS = 180;
const SETTLE_TRANSITION = [
  `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
  `box-shadow ${SETTLE_MS}ms ease`,
  `opacity ${SETTLE_MS}ms ease`,
].join(", ");
const LIFT_TRANSITION = ["transform 120ms ease-out", "box-shadow 120ms ease", "opacity 120ms ease"].join(", ");
const DRAG_SCALE = 1.01;
const MOUSE_THRESHOLD = 4; // px before a press on the handle becomes a drag
const TOUCH_THRESHOLD = 8;
const EDGE_SCROLL_ZONE = 56; // px from the board's edge where auto-scroll starts
const EDGE_SCROLL_MAX = 16; // px per frame at the very edge

export function useColumnDragReorder({ containerRef, placeholderRef, enabled, isBusy, orderedIds, onReorder, onAnnounce }) {
  const liftedSlot = useRef(null); // wrapper of the column being dragged (raised above its siblings)
  const columnEls = useRef(new Map()); // id -> inner column box (the thing that moves)
  const handleEls = useRef(new Map()); // id -> handle button
  const refCallbacks = useRef({ column: new Map(), handle: new Map() });
  const dragRef = useRef(null);
  const pendingFlip = useRef(null); // { rects, focusId }
  const latest = useRef({ orderedIds, onReorder, onAnnounce, enabled, isBusy });
  latest.current = { orderedIds, onReorder, onAnnounce, enabled, isBusy };

  const cachedRef = useCallback((kind, store, id) => {
    const cache = refCallbacks.current[kind];
    if (!cache.has(id)) {
      cache.set(id, (el) => {
        if (el) store.current.set(id, el);
        else store.current.delete(id);
      });
    }
    return cache.get(id);
  }, []);

  const columnRef = useCallback((id) => cachedRef("column", columnEls, id), [cachedRef]);
  const handleRef = useCallback((id) => cachedRef("handle", handleEls, id), [cachedRef]);

  const captureRects = useCallback(() => {
    const rects = new Map();
    for (const [id, el] of columnEls.current) rects.set(id, el.getBoundingClientRect());
    return rects;
  }, []);

  function resetColumnStyles(el) {
    el.style.transform = "";
    el.style.transition = "";
    el.style.zIndex = "";
    el.style.position = "";
    el.removeAttribute("data-column-drag");
  }

  // FLIP: the DOM is already in its final layout (transforms cleared);
  // slide every column that visually started somewhere else from there
  // to where it now is.
  const playFlip = useCallback((firstRects) => {
    // The dropped column keeps a "settling" marker (its lift shadow fades
    // out instead of vanishing); drop it once the slide is over, whether
    // or not that column ended up needing to move.
    setTimeout(() => {
      for (const el of columnEls.current.values()) {
        if (el.getAttribute("data-column-drag") === "settling") el.removeAttribute("data-column-drag");
      }
      if (liftedSlot.current) {
        liftedSlot.current.style.position = "";
        liftedSlot.current.style.zIndex = "";
        liftedSlot.current = null;
      }
    }, SETTLE_MS + 100);
    const moved = [];
    for (const [id, el] of columnEls.current) {
      const first = firstRects.get(id);
      if (!first) continue;
      const last = el.getBoundingClientRect();
      const dx = first.left + first.width / 2 - (last.left + last.width / 2);
      const scale = last.width > 0 ? first.width / last.width : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(scale - 1) < 0.001) continue;
      el.style.transition = "none";
      el.style.transform = `translate3d(${dx}px, 0, 0) scale(${scale})`;
      moved.push(el);
    }
    if (moved.length === 0) return;
    void moved[0].offsetWidth; // commit the inverted start position
    for (const el of moved) {
      el.style.transition = SETTLE_TRANSITION;
      el.style.transform = "translate3d(0, 0, 0) scale(1)";
      const done = () => {
        el.removeEventListener("transitionend", onEnd);
        clearTimeout(timer);
        el.style.transition = "";
        el.style.transform = "";
        el.removeAttribute("data-column-drag");
      };
      const onEnd = (e) => {
        if (e.target === el && e.propertyName === "transform") done();
      };
      const timer = setTimeout(done, SETTLE_MS + 80);
      el.addEventListener("transitionend", onEnd);
    }
  }, []);

  // Runs right after React commits a new column order (optimistic drop,
  // keyboard move, or a rolled-back failed save): clear the drag
  // transforms — the DOM now matches them — then animate from where each
  // column visually was to where it now sits.
  const orderKey = orderedIds.join(",");
  useLayoutEffect(() => {
    const pending = pendingFlip.current;
    if (!pending) return;
    pendingFlip.current = null;
    for (const el of columnEls.current.values()) {
      el.style.transform = "";
      el.style.transition = "";
      el.style.zIndex = "";
      el.style.position = "";
      // Keep the "settling" marker on the dropped column until its
      // slide finishes so its lift shadow fades rather than vanishing.
      if (el.getAttribute("data-column-drag") !== "settling") el.removeAttribute("data-column-drag");
    }
    playFlip(pending.rects);
    if (pending.focusId) {
      handleEls.current.get(pending.focusId)?.focus({ preventScroll: true });
      columnEls.current.get(pending.focusId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [orderKey, playFlip]);

  // Hands a captured "before" layout to the next order change — used by
  // the board to animate a rolled-back failed save.
  const scheduleFlip = useCallback((rects, focusId = null) => {
    pendingFlip.current = { rects, focusId };
  }, []);

  function cleanupDrag(d) {
    d.cancelAnimation?.();
    d.handle.removeEventListener("pointermove", d.onMove);
    d.handle.removeEventListener("pointerup", d.onUp);
    d.handle.removeEventListener("pointercancel", d.onCancel);
    d.handle.removeEventListener("lostpointercapture", d.onCancel);
    document.removeEventListener("keydown", d.onKey, true);
    if (d.pointerCaptured) {
      try {
        d.handle.releasePointerCapture(d.pointerId);
      } catch {
        // Already released — nothing to do.
      }
    }
    if (d.active) {
      document.body.style.userSelect = d.prevUserSelect;
      document.body.style.cursor = d.prevCursor;
      if (placeholderRef.current) placeholderRef.current.style.display = "none";
    }
    dragRef.current = null;
  }

  function beginActiveDrag(d) {
    const container = containerRef.current;
    const ids = latest.current.orderedIds;
    const from = ids.indexOf(d.id);
    if (!container || from === -1) return false;
    const cRect = container.getBoundingClientRect();
    const slots = ids.map((id) => {
      const r = columnEls.current.get(id)?.parentElement?.getBoundingClientRect();
      return r
        ? { left: r.left - cRect.left + container.scrollLeft, top: r.top - cRect.top + container.scrollTop, width: r.width, height: r.height }
        : { left: 0, top: 0, width: 0, height: 0 };
    });
    Object.assign(d, {
      active: true,
      ids,
      from,
      over: from,
      slots,
      startScroll: container.scrollLeft,
      prevUserSelect: document.body.style.userSelect,
      prevCursor: document.body.style.cursor,
    });
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    const dragged = columnEls.current.get(d.id);
    dragged.setAttribute("data-column-drag", "dragging");
    const slot = dragged.parentElement;
    if (slot) {
      slot.style.position = "relative";
      slot.style.zIndex = "3";
      liftedSlot.current = slot;
    }
    dragged.style.transition = LIFT_TRANSITION;
    for (const id of ids) {
      if (id === d.id) continue;
      columnEls.current.get(id)?.setAttribute("data-column-drag", "shifted");
    }

    const ph = placeholderRef.current;
    if (ph) {
      const s = slots[from];
      ph.style.transition = "none";
      ph.style.width = `${s.width}px`;
      ph.style.height = `${s.height}px`;
      ph.style.transform = `translate3d(${s.left}px, ${s.top}px, 0)`;
      ph.style.display = "block";
      requestAnimationFrame(() => {
        if (dragRef.current === d && ph) ph.style.transition = MOVE_TRANSITION;
      });
    }
    latest.current.onAnnounce?.(`Picked up column. Position ${from + 1} of ${ids.length}. Move the pointer to reposition.`);
    startEdgeScroll(d);
    return true;
  }

  function positionDrag(d) {
    const container = containerRef.current;
    const dx = d.clientX - d.startX + (container.scrollLeft - d.startScroll);
    const dragged = columnEls.current.get(d.id);
    dragged.style.transform = `translate3d(${dx}px, 0, 0) scale(${DRAG_SCALE})`;

    const from = d.slots[d.from];
    const over = nearestSlotIndex(d.slots, from.left + from.width / 2 + dx);
    if (over === d.over) return;
    d.over = over;
    d.ids.forEach((id, index) => {
      if (id === d.id) return;
      const el = columnEls.current.get(id);
      if (!el) return;
      const shift = shiftForColumn(d.slots, index, d.from, over);
      el.style.transition = MOVE_TRANSITION;
      el.style.transform = shift ? `translate3d(${shift}px, 0, 0)` : "";
    });
    const ph = placeholderRef.current;
    if (ph) ph.style.transform = `translate3d(${d.slots[over].left}px, ${d.slots[over].top}px, 0)`;
    latest.current.onAnnounce?.(`Position ${over + 1} of ${d.ids.length}`);
  }

  // Scrolls the board while the pointer is held near its left/right
  // edge, so a column can be carried past what's currently visible.
  function startEdgeScroll(d) {
    let frame = 0;
    const tick = () => {
      const container = containerRef.current;
      if (!container || dragRef.current !== d) return;
      const rect = container.getBoundingClientRect();
      let speed = 0;
      if (d.clientX < rect.left + EDGE_SCROLL_ZONE) {
        speed = -EDGE_SCROLL_MAX * Math.min(1, (rect.left + EDGE_SCROLL_ZONE - d.clientX) / EDGE_SCROLL_ZONE);
      } else if (d.clientX > rect.right - EDGE_SCROLL_ZONE) {
        speed = EDGE_SCROLL_MAX * Math.min(1, (d.clientX - (rect.right - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE);
      }
      if (speed !== 0) {
        const before = container.scrollLeft;
        container.scrollLeft = before + speed;
        if (container.scrollLeft !== before) positionDrag(d);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    d.cancelAnimation = () => cancelAnimationFrame(frame);
  }

  function finishDrag(d, commit) {
    const rects = captureRects();
    const from = d.from;
    const over = d.over;
    cleanupDrag(d);
    const dragged = columnEls.current.get(d.id);
    if (dragged) dragged.setAttribute("data-column-drag", "settling");
    if (commit && over !== from) {
      const newIds = moveItem(d.ids, from, over);
      pendingFlip.current = { rects, focusId: null };
      latest.current.onAnnounce?.(`Dropped. Column is now position ${over + 1} of ${newIds.length}.`);
      latest.current.onReorder(newIds);
      return;
    }
    // Cancelled, or dropped where it started: nothing changes in React
    // state; just slide everything back to its slot.
    for (const el of columnEls.current.values()) resetColumnStyles(el);
    if (dragged) dragged.setAttribute("data-column-drag", "settling");
    playFlip(rects);
    latest.current.onAnnounce?.(commit ? "Dropped in the same position." : "Reorder cancelled.");
  }

  const onHandlePointerDown = useCallback(
    (e, id) => {
      const { enabled: on, isBusy: busy } = latest.current;
      // No new drag while the previous reorder is still being saved —
      // keeps exactly one save in flight and the rollback target clear.
      if (!on || busy?.() || dragRef.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const handle = e.currentTarget;
      const d = {
        id,
        handle,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        clientX: e.clientX,
        active: false,
        pointerCaptured: false,
      };
      const threshold = e.pointerType === "mouse" ? MOUSE_THRESHOLD : TOUCH_THRESHOLD;
      d.onMove = (ev) => {
        if (ev.pointerId !== d.pointerId) return;
        d.clientX = ev.clientX;
        if (!d.active) {
          if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < threshold) return;
          if (!beginActiveDrag(d)) return cleanupDrag(d);
        }
        positionDrag(d);
      };
      d.onUp = (ev) => {
        if (ev.pointerId !== d.pointerId) return;
        if (!d.active) return cleanupDrag(d); // a plain click on the handle
        finishDrag(d, true);
      };
      d.onCancel = () => {
        if (!d.active) return cleanupDrag(d);
        finishDrag(d, false);
      };
      d.onKey = (ev) => {
        if (ev.key === "Escape" && d.active) {
          ev.preventDefault();
          ev.stopPropagation();
          finishDrag(d, false);
        }
      };
      handle.addEventListener("pointermove", d.onMove);
      handle.addEventListener("pointerup", d.onUp);
      handle.addEventListener("pointercancel", d.onCancel);
      handle.addEventListener("lostpointercapture", d.onCancel);
      document.addEventListener("keydown", d.onKey, true);
      try {
        handle.setPointerCapture(e.pointerId);
        d.pointerCaptured = true;
      } catch {
        // Capture can fail if the pointer is already gone; the drag simply won't start.
      }
      dragRef.current = d;
    },
    // beginActiveDrag/positionDrag/finishDrag only read refs; stable by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Keyboard alternative: focus the handle, press ← or → to move the
  // column one place. Same commit/animate/save path as a pointer drop.
  const onHandleKeyDown = useCallback(
    (e, id) => {
      const { enabled: on, isBusy: busy, orderedIds: ids } = latest.current;
      if (!on || busy?.() || dragRef.current) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const from = ids.indexOf(id);
      const to = from + (e.key === "ArrowLeft" ? -1 : 1);
      if (from === -1 || to < 0 || to >= ids.length) {
        latest.current.onAnnounce?.(to < 0 ? "Already the first column." : "Already the last column.");
        return;
      }
      pendingFlip.current = { rects: captureRects(), focusId: id };
      latest.current.onAnnounce?.(`Moved to position ${to + 1} of ${ids.length}.`);
      latest.current.onReorder(moveItem(ids, from, to));
    },
    [captureRects]
  );

  // If the board unmounts (or drag gets disabled) mid-drag, don't leave
  // the body stuck in "grabbing / no text selection".
  useEffect(() => {
    return () => {
      if (dragRef.current) cleanupDrag(dragRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { columnRef, handleRef, onHandlePointerDown, onHandleKeyDown, captureRects, scheduleFlip };
}
