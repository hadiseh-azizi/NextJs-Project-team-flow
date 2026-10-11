// Converts populated, .lean()'d Mongoose documents into the plain DTOs the
// frontend components expect.

import { compareColumns } from "@/lib/columnOrderCompare";
import { projectProgress } from "@/lib/taskCompletion";
import {
  SHARED_BOARD_MAX_ASSIGNEES_PER_TASK,
  SHARED_BOARD_MAX_ATTACHMENTS_PER_TASK,
  SHARED_BOARD_MAX_DESCRIPTION_CHARS,
  SHARED_BOARD_MAX_TASK_BYTES,
  takeWithinByteBudget,
  truncateText,
} from "@/lib/sharedBoardLimits";

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

// `members` is `null` for a legacy project that predates per-project
// membership (see models/Project.js) — every team member currently has
// access to it, and the frontend uses this `null` to show that state
// rather than an empty roster. Any other project (even one with an
// empty list) is access-restricted, and `members` is exactly who, besides
// the manager, can get in.
function projectMembersDTO(project) {
  return Array.isArray(project.members) ? project.members.map(toUserDTO) : null;
}

// Defaults mirror lib/authz.js's isManagerApprovalMode/canEditProject:
// anything other than the literal "manager_approval" reads as "everyone"
// (the schema default a .lean() read never applies), and `editors` (only
// meaningful in "manager_approval" mode) is `[]` when nobody's been
// explicitly granted yet, not `null` — unlike `members`, there's no
// separate "legacy" meaning to preserve here.
function projectEditingModeDTO(project) {
  return project.editingMode === "manager_approval" ? "manager_approval" : "everyone";
}

export function toProjectDTO(project, columns, tasks) {
  return {
    id: idStr(project._id),
    name: project.name,
    description: project.description ?? null,
    createdAt: new Date(project.createdAt).toISOString(),
    manager: toUserDTO(project.manager),
    team: toTeamDTO(project.team),
    members: projectMembersDTO(project),
    editingMode: projectEditingModeDTO(project),
    editors: (project.editors || []).map(toUserDTO),
    columns: columns.map(toColumnDTO).sort(compareColumns),
    tasks: tasks.map(toTaskDTO),
  };
}

// What changes when a project's name, editing mode, member list or editor
// list is changed — and nothing else. The members, editors and project
// PATCH routes return this instead of the whole project: those actions
// never touch columns or tasks, and the client already holds the team,
// manager and board. Every field has the same name, type and meaning as
// the same field of toProjectDTO(), so the page merges it into the project
// it already has (see lib/projectState.js). A client takes only the fields
// the action it just performed changed, so a response that arrives late
// can't overwrite a newer value of an unrelated field.
export function toProjectAccessDTO(project) {
  return {
    id: idStr(project._id),
    name: project.name,
    members: projectMembersDTO(project),
    editingMode: projectEditingModeDTO(project),
    editors: (project.editors || []).map(toUserDTO),
  };
}

// One row of the project list (GET /api/projects, the Projects page). A
// card shows a name, a description, its team's name and "N of M done" — so
// that is all this carries. The full DTO above also ships every column,
// every task (with assignees and attachment metadata), the whole team
// roster and the editor list for *each* project, which the list never
// renders. Progress arrives as counts instead of as the tasks they were
// counted from; the project's own page still loads the full DTO.
export function toProjectSummaryDTO(project, counts) {
  const { total, done } = counts || { total: 0, done: 0 };
  return {
    id: idStr(project._id),
    name: project.name,
    description: project.description ?? null,
    createdAt: new Date(project.createdAt).toISOString(),
    manager: toUserDTO(project.manager),
    team: { id: idStr(project.team?._id ?? project.team), name: project.team?.name ?? "" },
    progress: { total, done, pct: total ? Math.round((done / total) * 100) : 0 },
  };
}

// What the dashboard overview needs from one project: its id and name (for
// the list and the chart) and its done/total counts. Tasks are not carried
// per project any more — the counts are aggregated in the database and the
// two task lists are separate, bounded queries (see lib/dashboardData.js).
export function toDashboardProjectDTO(project, counts) {
  const { total, done } = counts || { total: 0, done: 0 };
  return {
    id: idStr(project._id),
    name: project.name,
    progress: { total, done, pct: total ? Math.round((done / total) * 100) : 0 },
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

// Every collection and long text field here is bounded — see
// lib/sharedBoardLimits.js for the numbers and the reasoning.
function toSharedTaskDTO(task) {
  const assignees = (task.assignees || []).map(toSharedAssigneeDTO).filter(Boolean);
  const attachments = task.attachments || [];
  return {
    id: idStr(task._id),
    title: task.title,
    description: truncateText(task.description ?? null, SHARED_BOARD_MAX_DESCRIPTION_CHARS),
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
    assignees: assignees.slice(0, SHARED_BOARD_MAX_ASSIGNEES_PER_TASK),
    // The real number of assignees, so "+N" stays right when the list above
    // was cut.
    assigneeCount: assignees.length,
    attachments: attachments.slice(0, SHARED_BOARD_MAX_ATTACHMENTS_PER_TASK).map(toSharedAttachmentDTO),
  };
}

// `columns` and `tasks` are what the route chose to load (already limited in
// the database). `stats` describes the WHOLE board so the numbers a viewer
// sees stay true when that slice is partial:
//   { totalColumns, columnCounts: Map<columnId, { total, done }> }
// Without `stats` (a caller holding the complete board) everything is
// derived from the arguments, as before.
export function toSharedBoardDTO(project, columns, tasks, stats) {
  const columnDTOs = columns.map(toColumnDTO).sort(compareColumns);
  const shownColumnIds = new Set(columnDTOs.map((c) => c.id));

  // A held-back task list is always a prefix of board order, so cutting the
  // tail for size never leaves a hole in the middle of a column.
  const taskDTOs = takeWithinByteBudget(tasks.map(toSharedTaskDTO), SHARED_BOARD_MAX_TASK_BYTES);

  let progress;
  let totalColumns;
  let totalTasks;
  const countOf = new Map();
  if (stats?.columnCounts) {
    totalColumns = Math.max(stats.totalColumns ?? columnDTOs.length, columnDTOs.length);
    let all = 0;
    let done = 0;
    let onShownColumns = 0;
    for (const [columnId, c] of stats.columnCounts) {
      all += c.total;
      done += c.done;
      if (shownColumnIds.has(columnId)) onShownColumns += c.total;
    }
    const pct = all ? Math.round((done / all) * 100) : 0;
    progress = { total: all, done, pct };
    // Tasks that belong to no existing column can never be drawn, so they
    // only count as "not shown" when some columns were cut too (in which
    // case they cannot be told apart from tasks in the cut columns).
    totalTasks = totalColumns > columnDTOs.length ? all : onShownColumns;
    for (const c of columnDTOs) countOf.set(c.id, stats.columnCounts.get(c.id)?.total ?? 0);
  } else {
    progress = projectProgress(tasks.map((t) => ({ completed: !!t.completed })));
    totalColumns = columnDTOs.length;
    totalTasks = tasks.length;
    for (const c of columnDTOs) countOf.set(c.id, tasks.filter((t) => idStr(t.column) === c.id).length);
  }

  const columnsOut = columnDTOs.map((c) => ({ ...c, taskCount: countOf.get(c.id) }));
  const truncated = totalColumns > columnDTOs.length || totalTasks > taskDTOs.length;

  return {
    projectName: project.name,
    projectDescription: project.description ?? null,
    progress,
    columns: columnsOut,
    tasks: taskDTOs,
    limits: {
      truncated,
      columns: { total: totalColumns, shown: columnDTOs.length },
      tasks: { total: totalTasks, shown: taskDTOs.length },
    },
  };
}
