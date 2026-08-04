// Converts populated, .lean()'d Mongoose documents into the plain DTOs the
// frontend components expect.

function idStr(id) {
  return String(id);
}

export function toUserDTO(user) {
  if (!user) return null;
  return { id: idStr(user._id), name: user.name, email: user.email };
}

export function toTeamDTO(team) {
  return {
    id: idStr(team._id),
    name: team.name,
    manager: toUserDTO(team.manager),
    members: (team.members || []).map(toUserDTO),
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
  };
}

export function toTaskDTO(task) {
  return {
    id: idStr(task._id),
    title: task.title,
    description: task.description ?? null,
    columnId: idStr(task.column),
    order: task.order,
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
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
    columns: columns.map(toColumnDTO).sort((a, b) => a.order - b.order),
    tasks: tasks.map(toTaskDTO),
  };
}
