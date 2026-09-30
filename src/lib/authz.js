import Project from "@/models/Project";
import Task from "@/models/Task";
import Team from "@/models/Team";
import { isValidObjectId } from "@/lib/objectId";

// Who's allowed into a project, independent of *why*. Every id in the
// returned set (plus the manager) has access; membership in the team
// alone is only one possible source of that set — see the comment below.
function projectRoster(project) {
  const managerId = String(project.manager?._id ?? project.manager);
  const hasProjectMembersList = Array.isArray(project.members);
  // A project with no `members` key at all is a legacy project — one
  // saved before per-project membership existed (see models/Project.js).
  // For those, fall back to the original rule (every team member has
  // access) so nothing that worked yesterday breaks today. A project
  // that *has* the field, even as an empty array, is access-restricted:
  // only the manager and whoever is explicitly listed can get in.
  const memberIds = hasProjectMembersList
    ? project.members.map((m) => String(m._id ?? m))
    : (project.team.members || []).map((m) => String(m._id ?? m));
  return { managerId, hasProjectMembersList, memberIds };
}

// A project is visible to its manager, and otherwise only to the
// individual users who have been granted access to it — see projectRoster()
// above for how that set is determined for legacy vs. access-restricted
// projects. `isTeamMember` is kept separate from `allowed`/`isProjectMember`
// because some callers (e.g. the project-membership UI, which needs to
// offer only this team's people as candidates) care about team membership
// on its own, not just whether the project is currently open to them.
export function projectAccessFor(project, userId) {
  const { managerId, hasProjectMembersList, memberIds } = projectRoster(project);
  const isManager = managerId === userId;
  const isTeamMember = (project.team.members || []).some((m) => String(m._id ?? m) === userId);
  const isProjectMember = isManager || memberIds.includes(userId);
  return { isManager, isTeamMember, isProjectMember, hasProjectMembersList, allowed: isProjectMember };
}

// The two values `Project.editingMode` can hold — see models/Project.js.
// Exported so the PATCH route can validate against the same list rather
// than duplicating it.
export const EDITING_MODES = ["everyone", "manager_approval"];

// Whether `project.editingMode` currently requires manager approval for
// direct edits. Read defensively rather than relying on the schema
// default (`"everyone"` — see models/Project.js): a `.lean()` query never
// applies Mongoose defaults, so a project saved before this field existed
// comes back with `editingMode` simply `undefined`, and that has to mean
// the same thing the schema default means — anything other than the
// literal `"manager_approval"` is treated as `"everyone"`.
export function isManagerApprovalMode(project) {
  return project.editingMode === "manager_approval";
}

// Whether `userId` may directly perform an edit (task/column mutation,
// project setting change) on this project — as opposed to merely being
// able to see it. Callers are expected to have already confirmed view
// access via projectAccessFor()/getAccessibleProject()/getTaskAccess();
// this is the second, narrower gate that only applies once that's true.
// The manager can always edit; everyone else can edit only when the
// project is in "everyone" mode, or when they're individually listed in
// `editors` while it's in "manager_approval" mode.
export function canEditProject(project, userId) {
  const managerId = String(project.manager?._id ?? project.manager);
  if (managerId === userId) return true;
  if (!isManagerApprovalMode(project)) return true;
  const editorIds = (project.editors || []).map((e) => String(e._id ?? e));
  return editorIds.includes(userId);
}

// Adds or removes one user from a project's membership list. Legacy
// projects (see models/Project.js) have no `members` array yet — the
// first time a Team Manager touches membership on one of these, it's
// seeded with the project's full current team roster (preserving
// everyone's existing implicit access) before the requested add/remove is
// applied on top; from that point the project is access-restricted. The
// seed write is guarded by a `members: { $exists: false }` filter so two
// concurrent "first touches" on the same legacy project can't each
// clobber the other's seed — whichever lands first wins, and the second
// becomes a no-op (the field already exists), falling through to the
// plain $addToSet/$pull below, same as it would for an already-restricted
// project.
export async function applyProjectMembership(project, targetUserId, action) {
  if (!Array.isArray(project.members)) {
    const seed = (project.team.members || []).map((m) => String(m._id ?? m));
    await Project.updateOne({ _id: project._id, members: { $exists: false } }, { $set: { members: seed } });
  }
  const update = action === "add" ? { $addToSet: { members: targetUserId } } : { $pull: { members: targetUserId } };
  await Project.updateOne({ _id: project._id }, update);
}

// Grants or revokes one user's explicit edit permission — meaningful only
// while the project is in "manager_approval" mode (see
// isManagerApprovalMode/canEditProject above), but stored regardless so a
// manager can set editors up before flipping the mode. Unlike
// applyProjectMembership(), there's no legacy/seeding concept here:
// `editors` simply starts absent (nobody explicitly granted yet) on every
// project, old or new, and this is a plain $addToSet/$pull.
export async function applyProjectEditPermission(project, targetUserId, action) {
  const update = action === "add" ? { $addToSet: { editors: targetUserId } } : { $pull: { editors: targetUserId } };
  await Project.updateOne({ _id: project._id }, update);
}

// Narrows a list of projects (as returned by a broad "every team I'm on"
// query — see GET /api/projects and dashboard/page.jsx) down to the ones
// this user can actually access. Needed because that broad query is only
// a candidate set: team membership alone no longer guarantees access to
// every project a team owns.
export function filterAccessibleProjects(projects, userId) {
  return projects.filter((project) => projectAccessFor(project, userId).allowed);
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
// assignee must be someone who can actually access this project (its
// manager, or — same rule projectAccessFor uses — a member of its
// restricted membership list, or of the whole team for a legacy,
// unrestricted project). Returns either `{ assignees }` (deduped,
// validated ids) or `{ error }` — callers map `error` to a 400 rather
// than silently dropping unauthorized ids. Keeping this in step with
// projectAccessFor matters: assigning a task to someone who can't open
// the project would leave them a task they can never see.
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
  const { managerId, memberIds } = projectRoster(project);
  const validAssignees = new Set([managerId, ...memberIds]);
  const unauthorizedId = uniqueIds.find((id) => !validAssignees.has(id));
  if (unauthorizedId !== undefined) {
    return { error: "One or more assignees don't have access to this project" };
  }
  return { assignees: uniqueIds };
}
