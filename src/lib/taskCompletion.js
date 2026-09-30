// Whether a task counts as "done" is its own persisted `completed` flag —
// never derived from which column it's sitting in. See models/Task.js and
// the two-step completion flow in KanbanBoard.jsx.
//
// This used to be computed ad hoc in four places (project detail page,
// ProjectCard, OverviewStats, ProgressChart) as "is this task's column
// flagged isDoneColumn" — that logic is gone now that completion is
// independent of column, so it's centralized here instead of copied a
// fifth time.

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
