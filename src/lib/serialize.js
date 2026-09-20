// Converts populated, .lean()'d Mongoose documents into the plain DTOs the
// frontend components expect.

import { compareColumns } from "@/lib/columnOrderCompare";

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
    ...(pendingInvitations ? { pendingInvitations: pendingInvitations.map(toInvitationDTO) } : {}),
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
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
    color: task.color ?? null,
    assignees: (task.assignees || []).map(toUserDTO),
    attachments: (task.attachments || []).map(toAttachmentDTO),
    projectId: idStr(task.project),
  };
}

export function toProjectDTO(project, columns, tasks) {
  return {
    id: idStr(project._id),
    name: project.name,
    description: project.description ?? null,
    createdAt: new Date(project.createdAt).toISOString(),
    manager: toUserDTO(project.manager),
    team: toTeamDTO(project.team),
    columns: columns.map(toColumnDTO).sort(compareColumns),
    tasks: tasks.map(toTaskDTO),
  };
}
