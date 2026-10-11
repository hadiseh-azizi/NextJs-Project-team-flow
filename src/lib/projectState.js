// Applying one changed entity to the project the board page already holds.
//
// After a successful mutation the server returns the entity that changed
// (a task, a column, or the project's access settings). The page merges it
// into its copy of the project with these functions instead of fetching
// the whole project again — columns, every task, the team roster and the
// editor list — to learn about one change.
//
// Every function here is pure and returns a new project object (or the
// same one when there is nothing to do). They are written so applying the
// same result twice, or applying it after a reload that already contains
// it, is harmless:
//   - creates skip an id that is already present;
//   - patches replace only the fields the action changed, so a response
//     that arrives late can't overwrite a newer value of an unrelated
//     field;
//   - removals of something already gone are no-ops.

import { compareColumns } from "@/lib/columnOrderCompare";

// --- tasks -----------------------------------------------------------------

export function hasColumn(project, columnId) {
  return !!project && project.columns.some((c) => c.id === columnId);
}

export function addTask(project, task) {
  if (!project || project.tasks.some((t) => t.id === task.id)) return project;
  return { ...project, tasks: [...project.tasks, task] };
}

export function removeTask(project, taskId) {
  if (!project || !project.tasks.some((t) => t.id === taskId)) return project;
  return { ...project, tasks: project.tasks.filter((t) => t.id !== taskId) };
}

export function patchTask(project, taskId, fields) {
  if (!project) return project;
  return { ...project, tasks: project.tasks.map((t) => (t.id === taskId ? { ...t, ...fields } : t)) };
}

// A move changes the moved task's column and order, and — only when the
// server had to renumber the destination column — the order of some other
// tasks (`reorderedSiblings`, see PATCH /api/tasks/[id]). Nothing else on
// any task is touched, so a title or assignee change that landed in the
// meantime survives.
export function applyTaskMove(project, moved) {
  if (!project) return project;
  const siblingOrders = new Map((moved.reorderedSiblings || []).map((s) => [s.id, s.order]));
  return {
    ...project,
    tasks: project.tasks.map((t) => {
      if (t.id === moved.id) return { ...t, columnId: moved.columnId, order: moved.order };
      if (siblingOrders.has(t.id)) return { ...t, order: siblingOrders.get(t.id) };
      return t;
    }),
  };
}

// --- columns ---------------------------------------------------------------

export function addColumn(project, column) {
  if (!project || project.columns.some((c) => c.id === column.id)) return project;
  return { ...project, columns: [...project.columns, column].sort(compareColumns) };
}

export function patchColumn(project, columnId, fields) {
  if (!project) return project;
  return { ...project, columns: project.columns.map((c) => (c.id === columnId ? { ...c, ...fields } : c)) };
}

export function removeColumn(project, columnId) {
  if (!project || !project.columns.some((c) => c.id === columnId)) return project;
  return { ...project, columns: project.columns.filter((c) => c.id !== columnId) };
}

// `columns` is the server's confirmed full order (PATCH .../columns/order).
// Only `order` is taken; a column the response doesn't list is kept.
export function applyColumnOrder(project, columns) {
  if (!project) return project;
  const orders = new Map(columns.map((c) => [c.id, c.order]));
  return {
    ...project,
    columns: project.columns.map((c) => (orders.has(c.id) ? { ...c, order: orders.get(c.id) } : c)).sort(compareColumns),
  };
}

// --- project name and access settings ---------------------------------------

// What each kind of change replaces. A response carries all four settings
// (see toProjectAccessDTO), but an action only changed some of them, and
// taking only those keeps a late response from reverting a setting some
// other, newer action just changed.
//
// Removing a member also drops their edit permission and their task
// assignments on the server (applyProjectMembership in lib/authz.js), so
// that scope takes `editors` too and clears the person from every task
// here — the same change, without reading every task back.
export const ACCESS_SCOPES = {
  rename: ["name"],
  editingMode: ["editingMode"],
  editors: ["editors"],
  memberAdded: ["members"],
  memberRemoved: ["members", "editors"],
};

export function applyAccessResult(project, data, scope, { removedUserId } = {}) {
  const keys = ACCESS_SCOPES[scope];
  if (!project || !keys) return project;
  const next = { ...project };
  for (const key of keys) next[key] = data[key];
  if (scope === "memberRemoved" && removedUserId) {
    next.tasks = project.tasks.map((t) =>
      t.assignees.some((a) => a.id === removedUserId)
        ? { ...t, assignees: t.assignees.filter((a) => a.id !== removedUserId) }
        : t
    );
  }
  return next;
}
