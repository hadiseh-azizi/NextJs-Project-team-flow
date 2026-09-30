// Splits a flat, already-ordered list of items — each carrying a
// `projectId`/`projectName` — into per-project groups. Item order within a
// project is preserved, and groups are ordered by each project's first
// appearance in the input list. A project that has no items in the input
// simply produces no group, which is how "this project has no open tasks"
// / "no closed tasks" is handled: by omission, not as a special case the
// caller has to branch on.
//
// Used by OverviewStats to keep "My open tasks" and "Tasks completed"
// visually scoped to one project at a time instead of blending tasks from
// different projects into a single list.
export function groupByProject(items) {
  const order = [];
  const byProject = new Map();
  for (const item of items) {
    if (!byProject.has(item.projectId)) {
      byProject.set(item.projectId, []);
      order.push(item.projectId);
    }
    byProject.get(item.projectId).push(item);
  }
  return order.map((projectId) => ({
    projectId,
    projectName: byProject.get(projectId)[0].projectName,
    items: byProject.get(projectId),
  }));
}
