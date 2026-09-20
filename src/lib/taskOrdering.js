// Kanban task ordering strategy
// ------------------------------
// Tasks are ordered within a column by an integer `order` field (see
// models/Task.js). Two tasks are never required to differ by exactly 1 —
// new/moved tasks are spaced ORDER_STEP apart so there's room to insert
// between any two neighbors without touching every other row in the
// column. This keeps the common case (drop a card between two others) a
// single-document write.
//
// When two neighbors have run out of integer room between them (their
// orders are adjacent, e.g. 4001 and 4002), the destination column is
// rebalanced: every task in it is renumbered to clean, evenly spaced
// multiples of ORDER_STEP. This is the "safe normalization" step — it
// only ever runs on the one column being written to, and only when
// needed, so it stays cheap even though it touches multiple documents.
//
// Floating-point midpoints (the previous approach) are avoided entirely:
// every order value here is a plain integer, so there's no precision to
// degrade no matter how many times a task is reordered.
//
// Concurrency: a column move is executed inside a MongoDB transaction
// (see withOptionalTransaction) so that "read siblings, decide on an
// order, write it" happens as one atomic unit against the destination
// column, and a rebalance's multi-document renumbering can't be observed
// half-applied. This app only targets MongoDB Atlas (see .env.example),
// which is always a replica set, so transactions are always available in
// production; the fallback below exists only so a standalone `mongod` in
// local dev doesn't hard-fail.
//
// This does not guarantee two truly simultaneous moves into the same
// column can never compute the same order value for two different tasks —
// doing that without a distributed lock would need a uniqueness
// constraint we deliberately don't want (see compareTasks). A tie like
// that is cosmetic, not corruption: it's resolved deterministically by
// compareTasks() below, and the next rebalance in that column cleans it
// up. For a small team's Kanban board, that's a reasonable trade-off
// against real distributed locking.

import Task from "@/models/Task";
import { compareTasks } from "@/lib/taskOrderCompare";
import { withOptionalTransaction } from "@/lib/mongoTransaction";

export const ORDER_STEP = 1000;
export { compareTasks };
// Re-exported for backwards compatibility — every existing caller imports
// this from here. The implementation now lives in lib/mongoTransaction.js
// so non-task routes (e.g. the done-column toggle) can use it too.
export { withOptionalTransaction };

// Order for a newly created task: one step past whatever is currently
// last in the column. Unlike `Task.countDocuments()`, this is correct
// even after tasks have been deleted (count-based ordering reissues a
// stale index and can collide with an existing task's order) and doesn't
// depend on every row in the column being contiguous.
export async function nextOrderForNewTask(columnId, session) {
  const last = await Task.findOne({ column: columnId })
    .sort({ order: -1 })
    .select("order")
    .session(session ?? null)
    .lean();
  return (last?.order ?? 0) + ORDER_STEP;
}

// Pure planning step — no I/O, so it can be unit-tested directly. Given
// the moving task's id, the *other* tasks currently in the destination
// column (already sorted ascending by compareTasks), and a requested
// 0-based `targetIndex` among those others (undefined = append at end),
// returns:
//   - newOrder: the order value the moving task should be saved with
//   - rebalanceOps: [{ id, order }] for any sibling tasks that need their
//     order rewritten first, because there was no integer room left
//     between the two neighbors surrounding the insertion point (empty
//     array in the common case).
export function computeMovePlan({ movingId, siblingsAsc, targetIndex }) {
  const idx =
    targetIndex === undefined
      ? siblingsAsc.length
      : Math.max(0, Math.min(targetIndex, siblingsAsc.length));
  const prev = idx > 0 ? siblingsAsc[idx - 1] : null;
  const next = idx < siblingsAsc.length ? siblingsAsc[idx] : null;

  if (!prev && !next) {
    return { newOrder: ORDER_STEP, rebalanceOps: [] };
  }
  if (!prev) {
    return { newOrder: next.order - Math.floor(ORDER_STEP / 2), rebalanceOps: [] };
  }
  if (!next) {
    return { newOrder: prev.order + ORDER_STEP, rebalanceOps: [] };
  }
  if (next.order - prev.order >= 2) {
    return { newOrder: prev.order + Math.floor((next.order - prev.order) / 2), rebalanceOps: [] };
  }

  // No integer room left between these two neighbors — rebalance the
  // whole destination column to clean, evenly spaced values, with the
  // moving task inserted at its requested position.
  const withInserted = [
    ...siblingsAsc.slice(0, idx).map((t) => ({ id: t._id })),
    { id: movingId },
    ...siblingsAsc.slice(idx).map((t) => ({ id: t._id })),
  ];
  let newOrder;
  const rebalanceOps = [];
  withInserted.forEach((t, i) => {
    const order = (i + 1) * ORDER_STEP;
    if (String(t.id) === String(movingId)) newOrder = order;
    else rebalanceOps.push({ id: t.id, order });
  });
  return { newOrder, rebalanceOps };
}

// Mutates `task.column` / `task.order` in place so it lands at
// `targetIndex` (0-based) among `destColumnId`'s *other* tasks. Does not
// save `task` itself — the caller does that (typically alongside other
// field changes) so the whole PATCH is one document write. If a
// rebalance is needed, the sibling documents involved are updated here
// directly via bulkWrite, inside `session` if one was given.
//
// `targetIndex` of `undefined` means "append to the end" — used when a
// caller changes a task's column without specifying a position (e.g. the
// column dropdown in the task detail view).
export async function planTaskMove({ task, destColumnId, targetIndex, session }) {
  const siblings = await Task.find({ column: destColumnId, _id: { $ne: task._id } })
    .select("_id order createdAt")
    .session(session ?? null)
    .lean();
  siblings.sort(compareTasks);

  const { newOrder, rebalanceOps } = computeMovePlan({ movingId: task._id, siblingsAsc: siblings, targetIndex });

  if (rebalanceOps.length) {
    const bulkOps = rebalanceOps.map(({ id, order }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order } } },
    }));
    await Task.bulkWrite(bulkOps, { session: session ?? undefined, ordered: true });
  }

  task.column = destColumnId;
  task.order = newOrder;
}
