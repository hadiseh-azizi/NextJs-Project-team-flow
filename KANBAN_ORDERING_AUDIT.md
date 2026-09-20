# Kanban Task/Column Ordering, Drag-and-Drop & Concurrency Audit

Scope, as given: Kanban task/column ordering, drag-and-drop correctness,
and concurrency handling only. No authentication, attachment, or
unrelated UI work.

Files read in full before drawing any conclusion or making any edit:

- `src/lib/taskOrdering.js`
- `src/lib/taskOrderCompare.js`
- `src/lib/columnOrderCompare.js`
- `src/app/api/tasks/route.js`
- `src/app/api/tasks/[id]/route.js`
- `src/app/api/projects/[id]/columns/route.js`
- `src/app/api/projects/[id]/columns/[columnId]/route.js`
- `src/components/KanbanBoard.jsx`
- `src/components/TaskCard.jsx`
- `src/models/Task.js`, `src/models/Column.js`
- `src/lib/mongoTransaction.js`
- The existing `__manual_test__/*.test.cjs` files touching any of the above

## Summary

Two real bugs found and fixed, both on the client. The server-side
ordering algorithm, transaction boundaries, and concurrency handling were
already correct and are unchanged.

| # | Scenario | Finding |
|---|----------|---------|
| 1 | New task ordering | Correct — unchanged. See below. |
| 2 | Reordering within a column | Correct — unchanged. New end-to-end test added. |
| 3 | Moving between columns | Correct — unchanged. New end-to-end test added. |
| 4 | Moving to the beginning | Correct — unchanged. New test added. |
| 5 | Moving to the middle | Correct — unchanged. New test added. |
| 6 | Moving to the end | Correct — unchanged. New test added. |
| 7 | Drop immediately before/after another task | Correct — unchanged. New tests added. |
| 8 | Moving a task around itself | Correct — unchanged. New test added. |
| 9 | Rebalancing when no integer gap remains | Correct — unchanged. New end-to-end test added (was previously only tested at the pure-function level). |
| 10 | Concurrent task creation | Correct, and a documented trade-off — unchanged. Already covered by existing tests. |
| 11 | Concurrent task moves | Correct, and a documented trade-off — unchanged. New test demonstrates the tie and its safe resolution directly. |
| 12 | Concurrent move + create | Correct — unchanged. New end-to-end test added. |
| 13 | Concurrent moves into the same column | Same as #11. |
| 14 | Duplicate order values | Server-side: an accepted, documented trade-off (unchanged). **Client-side: real bug found and fixed** — see below. |
| 15 | Deterministic tie-breaking | Correct — unchanged. Already covered; new tests exercise it further. |
| 16 | Column order creation races | Correct — unchanged. Already covered. |
| 17 | Done-column concurrency | Correct — unchanged. Already covered. |
| 18 | Transaction retry behavior | Correct — unchanged. Already covered. |
| UI bug | Stale `dropTarget` when pointer moves from a card into empty column space | **Confirmed and fixed.** See below. |
| — | Client no-op detection vs. server's `targetIndex` | **Disagreement found and fixed** (same root cause as #14's client-side bug). |

## Bug 1 (UI): stale drop indicator when the pointer leaves a card for empty column space

**File:** `src/components/KanbanBoard.jsx`

### The event flow

- `TaskCard`'s draggable `Card` has an `onDragOver` that calls
  `handleCardDragOver`, which computes "before"/"after" from the pointer's
  vertical position within the card, sets `dropTarget = { columnId,
  taskId, position }`, and calls `e.stopPropagation()`.
- The column's `Paper` has its own `onDragOver` calling
  `handleColumnDragOver`. Because `stopPropagation()` is called while the
  pointer is directly over a card, this column-level handler only fires
  when the pointer is over the column's *background* — the gaps between
  cards, and the space below the last card and above the "Add task"
  button. Its own comment says exactly that: "means 'drop at the end of
  this column'".

### The bug

The implementation didn't match that comment:

```js
function handleColumnDragOver(e, columnId) {
  e.preventDefault();
  setDragOverCol(columnId);
  setDropTarget((prev) => (prev && prev.columnId === columnId && prev.taskId ? prev : { columnId, position: "end" }));
}
```

If the previous `dropTarget` was a card-based target (`prev.taskId`
truthy) in the *same* column, this returns `prev` unchanged instead of
`"end"`. Since a card's own `onDragOver` always stops propagation, the
column handler is never reached while hovering a card in the first
place — so this guard doesn't protect against any real re-entrant call.
What it actually does: once the pointer has been over any card in a
column, moving it off that card into empty space (a gap, or the area
below the last card) leaves the stale card-based `dropTarget` in place.
The drop indicator keeps pointing at the last-hovered card, and dropping
there sends `targetIndex` for that card's position instead of "end" —
even though the pointer is now over empty background space.

### The fix

```js
function handleColumnDragOver(e, columnId) {
  e.preventDefault();
  setDragOverCol(columnId);
  setDropTarget((prev) =>
    prev && prev.columnId === columnId && prev.position === "end" && !prev.taskId
      ? prev
      : { columnId, position: "end" }
  );
}
```

Background hovers now always resolve to `"end"`. The functional update
is kept (rather than unconditionally calling `setDropTarget`) purely to
avoid a re-render on every pixel of continuous pointer movement once the
target is already `"end"` for this column — it no longer confuses
"already resolved to end" with "was previously over some card".

## Bug 2 (logic): client no-op detection didn't use the same tie-break as the render order

**Files:** `src/components/KanbanBoard.jsx`, `src/lib/taskOrderCompare.js`

### Background

`order` is an integer, and by design two tasks in the same column *can*
end up with the same `order` value under concurrent writes (documented
at the top of `lib/taskOrdering.js` as an accepted trade-off — a
distributed lock to prevent it isn't worth the complexity for a small
team's board). Every place that actually renders or sorts a column's
tasks — `KanbanBoard.jsx`'s `colTasks`, and the server's sibling reads in
`planTaskMove` — uses `compareTasks()`, which breaks an `order` tie by
`createdAt`, then by `_id`, so the rendered order is always well-defined
even when `order` alone is ambiguous.

### The bug

`handleDrop`'s check for "is the user dropping the task back where it
already is" did not use that comparator:

```js
if (task.columnId === columnId) {
  const currentIndex = siblings.findIndex((t) => t.order > task.order);
  const effectiveCurrentIndex = currentIndex === -1 ? siblings.length : currentIndex;
  if (effectiveCurrentIndex === targetIndex) return;
}
```

`t.order > task.order` can't distinguish siblings that tie with the task
on `order` — every tied sibling counts as "before" it regardless of
where `compareTasks` would actually place it. Concretely: two siblings
`D` and `E` tie with the moving task `T` on `order`, but `compareTasks`
(via `createdAt`) would render them as `D, T, E` — `T` sits at index 1.
The old check instead computes `effectiveCurrentIndex = 2` (past both,
i.e. "already at the end"), because neither `D.order` nor `E.order` is
`> T.order`. Two concrete failure modes follow directly from that:

- Drop `T` back visually between `D` and `E` (the true no-op,
  `targetIndex = 1`) → old check compares `2 === 1`, doesn't recognize
  the no-op, fires an unnecessary `PATCH`.
- Drag `T` to the actual end of the column (`targetIndex = 2`, a real
  move from its current position between `D` and `E`) → old check
  compares `2 === 2`, wrongly treats it as a no-op, and **silently drops
  a move the user actually asked for.**

The second case is the more serious one: this reproduces as a Kanban
board that appears to ignore a drag entirely, with no error, whenever
the destination and the dragged task's current position happen to tie on
`order`.

### The fix

Added a small shared helper to `lib/taskOrderCompare.js` — the same file
`compareTasks` already lives in, and already imported by both
`KanbanBoard.jsx` and `lib/taskOrdering.js`:

```js
export function currentSiblingIndex(task, siblingsAsc) {
  const idx = siblingsAsc.findIndex((sibling) => compareTasks(sibling, task) > 0);
  return idx === -1 ? siblingsAsc.length : idx;
}
```

`handleDrop` now calls `currentSiblingIndex(task, siblings)` instead of
the bare `order` scan. This doesn't touch `computeMovePlan`, `ORDER_STEP`,
or any server-side ordering logic — it only fixes what the *client*
considers "already there" before deciding whether to send a `PATCH` at
all.

## Server/client agreement on `targetIndex`

Traced explicitly, since it was called out as a specific thing to check:

- The server's `planTaskMove` (via `computeMovePlan`) treats
  `targetIndex` as a 0-based index into the destination column's
  *other* tasks, sorted ascending by `compareTasks`, with `undefined`
  meaning "append at the end". Siblings are read fresh from the
  database and always exclude the moving task itself
  (`_id: { $ne: task._id }`).
- The client computes the same thing from its own in-memory `tasks`
  array: `siblings = tasks.filter(t => t.columnId === columnId && t.id
  !== taskId).sort(compareTasks)`, then derives `targetIndex` from
  either the drop position within that array (before/after a specific
  card) or `siblings.length` for a background/"end" drop.
- Both sides use the exact same comparator (`compareTasks`, imported
  from the same `lib/taskOrderCompare.js` on both the client and
  server) to establish the ordering `targetIndex` is relative to, and
  both exclude the moving task from that ordering. Once Bug 2 above is
  fixed, the client's *no-op* decision uses that same comparator too, so
  there's no longer a path where the client's notion of "already there"
  disagrees with the index it would otherwise compute and send.

## What was intentionally left alone

- `computeMovePlan` / `ORDER_STEP` / the rebalance strategy — asked not
  to rewrite this without a demonstrated correctness issue, and none was
  found. It's well-reasoned (see the comment block at the top of
  `lib/taskOrdering.js`) and is exercised by both the pre-existing
  `01-pure-ordering.test.cjs` and new end-to-end tests in this phase.
- The `PATCH /api/projects/[id]/columns/[columnId]` route's unretried
  `order` field (see "Observation" below) — no demonstrated correctness
  issue reachable from the current UI, so left as-is per scope.
- Column deletion's empty-check-inside-transaction — already correct
  (see `13-column-task-race.test.cjs`), not part of the ordering
  algorithm itself, and not touched.

## Observation (not fixed — outside this phase's scope)

`PATCH /api/projects/[id]/columns/[columnId]` accepts a `body.order`
field and writes it directly, with no retry-on-collision, unlike column
*creation* (`POST /api/projects/[id]/columns`), which retries against the
`{project, order}` unique index. In principle, two concurrent PATCHes
setting the same target order would hit that unique-index violation and
one would 500 instead of retrying to a distinct value.

In practice this isn't reachable today: grepping the components in scope
turns up no column drag-and-drop UI at all — `KanbanBoard.jsx` and
`TaskCard.jsx` only implement *task* dragging, and no component calls
this route with an `order` field. Flagging it here for whoever adds
column reordering later; not fixed in this phase since there's no
demonstrated correctness issue today and building out retry logic for an
unreachable code path would be scope creep.

## Manual verification that cannot be run in this sandbox

Same category of gap as prior phases (see CHANGELOG.md): everything
above is verified against real, unmodified route/lib code with in-memory
Mongoose/Next.js fakes, proving the application logic is correct — not
that a live MongoDB Atlas replica set serializes two truly concurrent
transactions the way `withTransaction`'s driver-level retry assumes. To
verify against a live cluster:

1. Two browser tabs open to the same board, same column: drag two
   different tasks to the same drop position at effectively the same
   instant (or throttle network to widen the window). Confirm the board
   settles into a single, consistent order after both requests resolve
   and a reload, per `compareTasks`'s tie-break — not a crash, a lost
   task, or two tasks stuck permanently overlapping.
2. Two tabs: one creates a new task in a column while the other
   simultaneously drags an existing task into that same column. Confirm
   the new task and the moved-in task don't collide on `order` in a way
   that visibly reorders unrelated tasks, and that a subsequent
   rebalance (triggered by any further move in that column) cleans up
   any transient tie.
3. Repeated moves that intentionally exhaust integer room between two
   neighbors (e.g. rapid inserts at the same spot) — confirm the
   rebalance actually fires against live Atlas and the column's visible
   order doesn't change as a result (only the underlying `order` values
   do).
4. Drag-and-drop smoke test across two real devices/browsers (not just
   two tabs in one browser) to rule out any browser-specific HTML5 drag
   event quirks the manual test harness can't reproduce (it tests the
   `handleColumnDragOver`/`handleCardDragOver` *logic*, not real
   `dragover` event dispatch).
5. Multi-tab drag test specifically for the fixed UI bug: drag a card
   partway, move the pointer off it into the empty space below the last
   card in the same column, and confirm the drop indicator now shows
   "end" (a line at the bottom of the column) rather than sticking to
   the last card you hovered.
