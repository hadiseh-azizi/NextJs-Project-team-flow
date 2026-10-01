// Converts populated, .lean()'d Mongoose documents into the plain DTOs the
// frontend components expect.

import { compareColumns } from "@/lib/columnOrderCompare";
import { projectProgress } from "@/lib/taskCompletion";

function idStr(id) {
  return String(id);
}

export function toUserDTO(user) {
  if (!user) return null;
  return { id: idStr(user._id), name: user.name, email: user.email };
}

export function toInvitationDTO(inv) {
  return {
    id: idStr(inv._id),
    email: inv.email,
    createdAt: new Date(inv.createdAt).toISOString(),
  };
}

export function toTeamDTO(team, pendingInvitations = null) {
  return {
    id: idStr(team._id),
    name: team.name,
    manager: toUserDTO(team.manager),
    members: (team.members || []).map(toUserDTO),
    ...(Array.isArray(pendingInvitations) ? { pendingInvitations: pendingInvitations.map(toInvitationDTO) } : {}),
  };
}

// Attachment metadata only — never includes the base64 `data`, which is
// fetched separately by the download route so list responses stay small.
export function toAttachmentDTO(a) {
  return {
    id: idStr(a._id),
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    uploadedAt: new Date(a.uploadedAt).toISOString(),
  };
}

export function toColumnDTO(column) {
  return {
    id: idStr(column._id),
    name: column.name,
    order: column.order,
    isDoneColumn: !!column.isDoneColumn,
    // Exposed so the board can break ties deterministically when two
    // columns ever share an `order` value — see lib/columnOrderCompare.js.
    createdAt: column.createdAt ? new Date(column.createdAt).toISOString() : null,
  };
}

export function toTaskDTO(task) {
  return {
    id: idStr(task._id),
    title: task.title,
    description: task.description ?? null,
    columnId: idStr(task.column),
    order: task.order,
    // Exposed so the board can break ties deterministically when two
    // tasks in the same column ever share an `order` value — see
    // lib/taskOrderCompare.js.
    createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : null,
    // Independent of the column it's sitting in — see models/Task.js.
    completed: !!task.completed,
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
    color: task.color ?? null,
    assignees: (task.assignees || []).map(toUserDTO),
    attachments: (task.attachments || []).map(toAttachmentDTO),
    projectId: idStr(task.project),
  };
}

export function toProjectDTO(project, columns, tasks) {
  // `members` is `null` for a legacy project that predates per-project
  // membership (see models/Project.js) — every team member currently has
  // access to it, and the frontend uses this `null` to show that state
  // rather than an empty roster. Any other project (even one with an
  // empty list) is access-restricted, and `members` is exactly who, besides
  // the manager, can get in.
  const hasProjectMembersList = Array.isArray(project.members);
  return {
    id: idStr(project._id),
    name: project.name,
    description: project.description ?? null,
    createdAt: new Date(project.createdAt).toISOString(),
    manager: toUserDTO(project.manager),
    team: toTeamDTO(project.team),
    members: hasProjectMembersList ? project.members.map(toUserDTO) : null,
    // Defaults mirror lib/authz.js's isManagerApprovalMode/canEditProject:
    // anything other than the literal "manager_approval" reads as
    // "everyone" (the schema default a .lean() read never applies), and
    // `editors` (only meaningful in "manager_approval" mode) is `[]` when
    // nobody's been explicitly granted yet, not `null` — unlike `members`,
    // there's no separate "legacy" meaning to preserve here.
    editingMode: project.editingMode === "manager_approval" ? "manager_approval" : "everyone",
    editors: (project.editors || []).map(toUserDTO),
    columns: columns.map(toColumnDTO).sort(compareColumns),
    tasks: tasks.map(toTaskDTO),
  };
}

// The public, read-only board DTO served by GET /api/shared/board/[token]
// — deliberately its own function rather than a filtered toProjectDTO()/
// toTaskDTO(), so every field it exposes is a conscious choice, not
// "whatever the authenticated shape happens to include minus a few
// fields". Anonymous viewers never see: the manager's or any assignee's
// email, the team, project membership/editing settings, the share token
// itself, or attachment ids/contents (the download route requires a
// session regardless — see tasks/[id]/attachments/[attachmentId]/route.js
// — but leaving the id out here means there's nothing to even try).
function toSharedAttachmentDTO(a) {
  return { filename: a.filename, mimeType: a.mimeType, size: a.size };
}

function toSharedAssigneeDTO(user) {
  if (!user) return null;
  return { id: idStr(user._id), name: user.name };
}

function toSharedTaskDTO(task) {
  return {
    id: idStr(task._id),
    title: task.title,
    description: task.description ?? null,
    columnId: idStr(task.column),
    order: task.order,
    // Exposed for the same tie-break reason as toTaskDTO's own
    // `createdAt` — see lib/taskOrderCompare.js's compareTasks(), reused
    // as-is by the shared board view so display order matches the
    // authenticated board exactly.
    createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : null,
    completed: !!task.completed,
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
    color: task.color ?? null,
    assignees: (task.assignees || []).map(toSharedAssigneeDTO),
    attachments: (task.attachments || []).map(toSharedAttachmentDTO),
  };
}

export function toSharedBoardDTO(project, columns, tasks) {
  const { total, done, pct } = projectProgress(tasks.map((t) => ({ completed: !!t.completed })));
  return {
    projectName: project.name,
    projectDescription: project.description ?? null,
    progress: { total, done, pct },
    columns: columns.map(toColumnDTO).sort(compareColumns),
    tasks: tasks.map(toSharedTaskDTO),
  };
}
