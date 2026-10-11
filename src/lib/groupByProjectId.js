// One pass over a flat list of documents that each carry a `project`
// reference, producing Map<projectId, docs[]>. List endpoints and the
// dashboard used to do `allTasks.filter((t) => t.project === p._id)` once
// per project — P projects x T tasks comparisons, each with two String()
// conversions. Building the index once makes the per-project lookup O(1)
// and the whole job O(P + T). Order within a project is the input order, so
// a query's own sort is preserved.
export function groupByProjectId(docs) {
  const byProject = new Map();
  for (const doc of docs) {
    const key = String(doc.project);
    const bucket = byProject.get(key);
    if (bucket) bucket.push(doc);
    else byProject.set(key, [doc]);
  }
  return byProject;
}

// Map<projectId, { total, done }> from a flat list of tasks, in one pass.
// This is all the project list needs from tasks (a card shows "3 of 8
// done"), so the list never has to carry the tasks themselves.
export function countTasksByProject(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    const key = String(task.project);
    let entry = counts.get(key);
    if (!entry) {
      entry = { total: 0, done: 0 };
      counts.set(key, entry);
    }
    entry.total += 1;
    if (task.completed) entry.done += 1;
  }
  return counts;
}
