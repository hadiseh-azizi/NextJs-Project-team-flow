// Project loading/query helpers that several routes (and the dashboard page)
// previously each carried their own copy of. Behavior is unchanged: these
// are the same queries, in the same shape, moved to one place.

import { NextResponse } from "next/server";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toProjectAccessDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { accessibleTeamIds, filterAccessibleProjects } from "@/lib/authz";

export const TEAM_POPULATE = {
  path: "team",
  populate: [
    { path: "manager", select: "name email" },
    { path: "members", select: "name email" },
  ],
};
export const MEMBERS_POPULATE = { path: "members", select: "name email" };
export const EDITORS_POPULATE = { path: "editors", select: "name email" };

// A project's columns and tasks as the board needs them. Tasks carry
// attachment metadata only, never the base64 `data`.
export function loadColumnsAndTasks(projectId) {
  return Promise.all([
    // Tie-broken by createdAt/_id in case any column ever shares an `order`
    // value (see lib/columnOrderCompare.js).
    Column.find({ project: projectId }).sort({ order: 1, createdAt: 1, _id: 1 }).lean(),
    Task.find({ project: projectId })
      .select("-attachments.data")
      .populate("assignees", "name")
      .sort({ order: 1 })
      .lean(),
  ]);
}

// Re-reads a project's access settings (name, editing mode, members,
// editors) and returns them as the JSON response. Used by the members and
// editors routes after a change, and by PATCH /api/projects/[id].
//
// This used to re-read the whole project — team, manager, every column and
// every task — and return all of it, although none of those can have
// changed. It is now one query for the four fields that can (see
// toProjectAccessDTO), with no team, manager, column or task queries.
// Callers have already checked that the requester is
// the project's manager before they get here.
export async function respondWithUpdatedProject(id) {
  const project = await Project.findById(id)
    .populate(MEMBERS_POPULATE)
    .populate(EDITORS_POPULATE)
    .lean();
  // Deleted between the permission check and this read.
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(toProjectAccessDTO(project));
}

// Loads a project and confirms the caller is its manager. Returns
// `{ project }` or `{ error: NextResponse }`.
//
// A missing project and one the caller doesn't manage get the SAME 403
// (L4), so ids can't be probed; a malformed id stays a 404. Each caller
// keeps its own message and the populate steps it needs:
//   forbiddenMessage — the 403 text for that route
//   populate         — populate arguments applied in order (default: none)
export async function loadProjectAsManager(id, userId, { forbiddenMessage, populate = [] }) {
  if (!isValidObjectId(id)) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  let query = Project.findById(id);
  for (const p of populate) query = query.populate(p);
  const project = await query.lean();
  if (!project || String(project.manager?._id ?? project.manager) !== userId) {
    return { error: NextResponse.json({ error: forbiddenMessage }, { status: 403 }) };
  }
  return { project };
}

// Projects a user may see: the candidate set (manager of it, or on its
// team) narrowed with the same per-project access check every project route
// uses, newest first. `populate` is a list of populate arguments, so the
// API list and the dashboard can ask for different fields from one query.
export async function findAccessibleProjects(userId, populate = []) {
  const teamIds = await accessibleTeamIds(userId);
  let query = Project.find({ $or: [{ manager: userId }, { team: { $in: teamIds } }] });
  for (const p of populate) query = query.populate(p);
  const candidates = await query.sort({ createdAt: -1 }).lean();
  return filterAccessibleProjects(candidates, userId);
}
