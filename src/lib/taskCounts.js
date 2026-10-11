// H2: per-project task counts computed by MongoDB instead of by loading
// every task into Node just to count them.
//
// Semantics are those of countTasksByProject() in lib/groupByProjectId.js,
// which this replaces on the hot path: `total` is every task in the project
// and `done` is every task whose own `completed` flag is true (no column is
// special — see lib/taskCompletion.js). A project with no tasks has no group
// in the result; callers already treat a missing entry as { total: 0, done: 0 }
// (toProjectSummaryDTO). `completed` is a Boolean in the schema, so "equals
// true" is the same test the old JS truthiness check applied to stored data.
//
// The $match on `project` is served by the Task { project: 1 } index (H6).
// Only the grouped numbers leave the database.

import Task from "@/models/Task";

export function projectCountsPipeline(projectIds) {
  return [
    { $match: { project: { $in: projectIds } } },
    {
      $group: {
        _id: "$project",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$completed", true] }, 1, 0] } },
      },
    },
  ];
}

// Map<projectId (string), { total, done }> — same shape as countTasksByProject.
export async function countTasksByProjectIds(projectIds) {
  const counts = new Map();
  if (!projectIds || projectIds.length === 0) return counts;
  const rows = await Task.aggregate(projectCountsPipeline(projectIds));
  for (const row of rows) counts.set(String(row._id), { total: row.total, done: row.done });
  return counts;
}

// H4: the same counts, split by column, for ONE project. The public shared
// board uses this to report each column's true task count (and the board's
// true progress) even when it only sends a bounded slice of the tasks.
// `_id` is the column id; a task whose column no longer exists still forms a
// group, which keeps the project's overall total identical to
// projectCountsPipeline's. Served by the Task { project: 1 } index.
export function projectColumnCountsPipeline(projectId) {
  return [
    { $match: { project: projectId } },
    {
      $group: {
        _id: "$column",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$completed", true] }, 1, 0] } },
      },
    },
  ];
}

// Map<columnId (string), { total, done }>
export async function countTasksByColumn(projectId) {
  const rows = await Task.aggregate(projectColumnCountsPipeline(projectId));
  const counts = new Map();
  for (const row of rows) counts.set(String(row._id), { total: row.total, done: row.done });
  return counts;
}
