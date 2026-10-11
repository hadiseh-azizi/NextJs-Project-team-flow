// H2: what the dashboard overview needs, computed in the database.
//
// The overview shows (see components/OverviewStats.jsx and ProgressChart.jsx):
//   - per project: name and "done of total" (the progress chart, the
//     "Tasks completed x/y" stat and the "Active projects" list);
//   - "My open tasks": a count and, when opened, the tasks assigned to this
//     user that are not completed, soonest due date first;
//   - "Tasks completed": a count and, when opened, the completed tasks'
//     titles grouped by project.
// Previously every task of every accessible project (title, due date,
// assignee ids) was loaded and serialized into the page, so the work and the
// payload grew with the whole dataset. Now the counts are aggregated and the
// two lists are bounded; the stats still show the true totals.
//
// Bounds (a list shorter than its count says so in the UI):
//   OPEN_TASKS_LIMIT  — the user's open tasks, soonest due first. This is a
//                       true top-N: nothing earlier than the cut is dropped.
//   DONE_TASKS_LIMIT  — completed tasks, most recently updated first. Tasks
//                       have no completion timestamp, so `updatedAt` is the
//                       closest signal; tasks saved before that field existed
//                       sort last.
//
// Access control is unchanged: `projects` is the caller's already-filtered
// list (findAccessibleProjects), and every query here is scoped to those ids.

import mongoose from "mongoose";
import Task from "@/models/Task";
import { isValidObjectId } from "@/lib/objectId";
import { toDashboardProjectDTO } from "@/lib/serialize";

export const OPEN_TASKS_LIMIT = 100;
export const DONE_TASKS_LIMIT = 50;

// Sorts "no due date" after every real date, matching the old client sort
// (undated tasks last). Mongo would otherwise put null first ascending.
const NO_DUE_DATE = new Date(8640000000000000);

export function dashboardCountsPipeline(projectIds, userOid) {
  const isOpen = { $ne: ["$completed", true] };
  // No valid user id means nothing can be "assigned to" them.
  const mine = userOid ? { $in: [userOid, { $ifNull: ["$assignees", []] }] } : { $literal: false };
  return [
    { $match: { project: { $in: projectIds } } },
    {
      $group: {
        _id: "$project",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$completed", true] }, 1, 0] } },
        myOpen: { $sum: { $cond: [{ $and: [isOpen, mine] }, 1, 0] } },
      },
    },
  ];
}

export function myOpenTasksPipeline(projectIds, userOid, limit = OPEN_TASKS_LIMIT) {
  return [
    { $match: { project: { $in: projectIds }, assignees: userOid, completed: { $ne: true } } },
    { $addFields: { _dueKey: { $ifNull: ["$dueDate", NO_DUE_DATE] } } },
    { $sort: { _dueKey: 1, _id: 1 } },
    { $limit: limit },
    { $project: { project: 1, title: 1, dueDate: 1 } },
  ];
}

// Keeps each project's own order but lists projects in the order the page
// shows them (newest project first), so the grouped lists keep their layout.
export function orderByProjects(items, projectIds) {
  const rank = new Map(projectIds.map((id, i) => [String(id), i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank.get(String(a.item.project)) - rank.get(String(b.item.project)) || a.i - b.i)
    .map(({ item }) => item);
}

export async function loadDashboardData(projects, userId) {
  const empty = {
    projects: [],
    counts: { total: 0, done: 0, open: 0 },
    openTasks: [],
    completedTasks: [],
  };
  if (!projects.length) return empty;

  const projectIds = projects.map((p) => p._id);
  const userOid = isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null;

  const [rows, openRows, doneRows] = await Promise.all([
    Task.aggregate(dashboardCountsPipeline(projectIds, userOid)),
    userOid ? Task.aggregate(myOpenTasksPipeline(projectIds, userOid)) : Promise.resolve([]),
    Task.find({ project: { $in: projectIds }, completed: true })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(DONE_TASKS_LIMIT)
      .select("project title")
      .lean(),
  ]);

  const byProject = new Map(rows.map((r) => [String(r._id), r]));
  const nameOf = new Map(projects.map((p) => [String(p._id), p.name]));

  let total = 0;
  let done = 0;
  let open = 0;
  const projectSummaries = projects.map((p) => {
    const r = byProject.get(String(p._id)) || { total: 0, done: 0, myOpen: 0 };
    total += r.total;
    done += r.done;
    open += r.myOpen;
    return toDashboardProjectDTO(p, { total: r.total, done: r.done });
  });

  const toItem = (t) => ({
    id: String(t._id),
    title: t.title,
    projectId: String(t.project),
    projectName: nameOf.get(String(t.project)) ?? "",
  });

  return {
    projects: projectSummaries,
    counts: { total, done, open },
    // Open tasks keep their global soonest-due order (the UI groups by
    // first appearance); completed ones are laid out project by project.
    openTasks: openRows.map((t) => ({ ...toItem(t), dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null })),
    completedTasks: orderByProjects(doneRows, projectIds).map(toItem),
  };
}
