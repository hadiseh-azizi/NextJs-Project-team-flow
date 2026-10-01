// Whether a task counts as "done" is its own persisted `completed` flag —
// never derived from which column it's sitting in (no column is a "done"
// column). See models/Task.js and the completion confirmation in
// KanbanBoard.jsx.
//
// Progress is counted from this flag alone, centralized here rather than
// re-derived in each view (project detail page, ProjectCard,
// OverviewStats, ProgressChart).

export function isTaskCompleted(task) {
  return !!task?.completed;
}

// { total, done, pct } for a project's task list. `pct` is rounded, and
// 0 for an empty list (matches the app's existing convention rather than
// dividing by zero).
export function projectProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;
  const done = list.filter(isTaskCompleted).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { total, done, pct };
}
