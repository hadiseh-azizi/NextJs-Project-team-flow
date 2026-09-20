// Mirrors lib/taskOrderCompare.js. Columns now have a unique (project,
// order) index going forward (see models/Column.js), so freshly created
// columns can't collide — but this is still worth having as a defensive
// tie-break: it makes column order deterministic even against any row
// that predates the index, and it costs nothing when orders are already
// distinct (the first comparison decides it). Every place that sorts
// columns by order should use this instead of a bare `a.order - b.order`.
export function compareColumns(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  const aTime = new Date(a.createdAt ?? 0).getTime();
  const bTime = new Date(b.createdAt ?? 0).getTime();
  if (aTime !== bTime) return aTime - bTime;
  return String(a._id ?? a.id).localeCompare(String(b._id ?? b.id));
}
