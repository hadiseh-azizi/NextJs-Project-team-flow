// Shared by both the API routes (lib/taskOrdering.js) and the Kanban board
// component. Kept dependency-free (no mongoose, no server-only imports) so
// it's safe to import from client components.
//
// Two tasks can end up sharing the same `order` value under concurrent
// writes — `order` isn't a uniqueness constraint, by design (see
// lib/taskOrdering.js for why). Every place that sorts tasks by order
// should use this comparator instead of a bare `a.order - b.order`, so a
// tie resolves the same way everywhere rather than flapping between
// renders/requests.
export function compareTasks(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  const aTime = new Date(a.createdAt ?? 0).getTime();
  const bTime = new Date(b.createdAt ?? 0).getTime();
  if (aTime !== bTime) return aTime - bTime;
  return String(a._id ?? a.id).localeCompare(String(b._id ?? b.id));
}

// Given a task and the *other* tasks already in its column (any order —
// this sorts its own copy), returns the 0-based index the task currently
// occupies among them under the exact same ordering `colTasks` is
// rendered with. Used to tell a genuine drag-and-drop reorder apart from
// a drop back onto the task's own current slot.
//
// A bare `order` comparison isn't suffient for this: `order` is
// deliberately not unique (see lib/taskOrdering.js), so a sibling can tie
// with the task on `order` alone while still resolving to a definite side
// of it once the full tie-break (createdAt, then id) is applied — the
// same tie-break `compareTasks` already applies everywhere a column's
// tasks are sorted for display. Comparing only `order` here would let
// this "current position" silently disagree with the position the task
// actually renders at, which either suppresses a real move (client thinks
// it's already there) or fires an unnecessary one (client thinks it isn't).
export function currentSiblingIndex(task, siblingsAsc) {
  const idx = siblingsAsc.findIndex((sibling) => compareTasks(sibling, task) > 0);
  return idx === -1 ? siblingsAsc.length : idx;
}
