import Project from "@/models/Project";
import Task from "@/models/Task";
import Team from "@/models/Team";
import { isValidObjectId } from "@/lib/objectId";

// A project is visible to its manager and to every member of the team it
// belongs to — this is the one access rule the whole app is built on.
export function projectAccessFor(project, userId) {
  const isManager = String(project.manager?._id ?? project.manager) === userId;
  const isTeamMember = (project.team.members || []).some((m) => String(m._id ?? m) === userId);
  return { isManager, isTeamMember, allowed: isManager || isTeamMember };
}

// Loads a project (with its team populated) and checks access in one call.
// Returns null for a missing project OR denied access — callers that need
// to tell those apart (e.g. to return 404 vs 403) should call this in two
// steps instead; most routes here intentionally don't distinguish the two
// so they don't leak whether a given project id exists.
export async function getAccessibleProject(projectId, userId) {
  if (!isValidObjectId(projectId)) return null;
  const project = await Project.findById(projectId).populate("team").lean();
  if (!project) return null;
  return projectAccessFor(project, userId).allowed ? project : null;
}

// Same shape of check, but starting from a task id — walks task -> project
// -> team. Used by the task and attachment routes.
//
// `includeAttachmentData` defaults to false: attachment binary data is
// base64 and can be several MB per file, and almost every caller only
// needs the task's other fields (or, for attachment routes, just each
// attachment's metadata to check counts/sizes) — not the file contents.
// Only the single-attachment download route needs the real bytes, and it
// opts in explicitly.
export async function getTaskAccess(taskId, userId, { includeAttachmentData = false } = {}) {
  if (!isValidObjectId(taskId)) return null;
  const task = includeAttachmentData
    ? await Task.findById(taskId)
    : await Task.findById(taskId).select("-attachments.data");
  if (!task) return null;
  const project = await Project.findById(task.project).populate("team").lean();
  if (!project) return null;
  return projectAccessFor(project, userId).allowed ? { task, project } : null;
}

// Whether the given user manages a team. Accepts either a populated or a
// bare ObjectId `manager` field so it works with .lean() docs either way.
export function isTeamManager(team, userId) {
  return String(team.manager?._id ?? team.manager) === userId;
}

// A team is visible to its manager and to any of its current members —
// the manager is implicitly a member for this purpose.
export function teamAccessFor(team, userId) {
  const isManager = isTeamManager(team, userId);
  const isMember = isManager || (team.members || []).some((m) => String(m._id ?? m) === userId);
  return { isManager, isMember, allowed: isMember };
}

// Every team a user can see a project through: teams they manage, plus
// teams they're a member of. Team creation always adds the manager to
// `members` (see POST /api/teams) and membership removal blocks removing
// the manager (see DELETE /api/teams/[id]/members), so today the two sets
// are the same in practice — but callers that derive project/task
// visibility from "my teams" (the dashboard and project-list queries)
// should not bake in that assumption as their only access path. Matching
// on `members` alone here would under-count teams for a manager if that
// invariant were ever weakened elsewhere, silently hiding that manager's
// own projects from their own dashboard.
export async function accessibleTeamIds(userId) {
  const teams = await Team.find({ $or: [{ manager: userId }, { members: userId }] })
    .select("_id")
    .lean();
  return teams.map((t) => t._id);
}

// A generous ceiling on how many assignee ids a single request can carry.
// No real team using this app has anywhere near this many members, so it
// never affects a legitimate request — its only job is to reject a
// pathological payload (e.g. tens of thousands of ids) before this
// function spends time on it. Checked before mapping/deduping so a huge
// array is rejected on its length alone, not after already paying the
// cost of processing it once.
const MAX_ASSIGNEE_IDS = 200;

// Shared assignee rule for both task creation and task updates: an
// assignee must be the project's manager or a member of its team. Returns
// either `{ assignees }` (deduped, validated ids) or `{ error }` — callers
// map `error` to a 400 rather than silently dropping unauthorized ids.
export function validateAssignees(project, assigneeIds) {
  if (!Array.isArray(assigneeIds)) {
    return { error: "assigneeIds must be an array" };
  }
  if (assigneeIds.length > MAX_ASSIGNEE_IDS) {
    return { error: `assigneeIds has too many entries (max ${MAX_ASSIGNEE_IDS})` };
  }
  const uniqueIds = [...new Set(assigneeIds.map(String))];
  const invalidId = uniqueIds.find((id) => !isValidObjectId(id));
  if (invalidId !== undefined) {
    return { error: "One or more assignee IDs are invalid" };
  }
  const validAssignees = new Set([
    String(project.manager?._id ?? project.manager),
    ...(project.team.members || []).map((m) => String(m._id ?? m)),
  ]);
  const unauthorizedId = uniqueIds.find((id) => !validAssignees.has(id));
  if (unauthorizedId !== undefined) {
    return { error: "One or more assignees are not members of this project's team" };
  }
  return { assignees: uniqueIds };
}
