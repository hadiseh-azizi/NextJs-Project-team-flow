import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";

async function assertAccess(taskId, userId) {
  const task = await Task.findById(taskId);
  if (!task) return null;
  const project = await Project.findById(task.project).populate("team").lean();
  if (!project) return null;
  const isManager = String(project.manager) === userId;
  const isTeamMember = project.team.members.some((m) => String(m) === userId);
  return isManager || isTeamMember ? { task, project } : null;
}

export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const access = await assertAccess(params.id, userId);
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const { task, project } = access;

  const body = await req.json();

  if (body.columnId !== undefined) {
    const column = await Column.findOne({ _id: body.columnId, project: project._id }).lean();
    if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });
    task.column = body.columnId;
  }
  if (body.order !== undefined) task.order = body.order;
  if (body.title !== undefined) task.title = body.title;
  if (body.description !== undefined) task.description = body.description;
  if (body.assigneeIds !== undefined) task.assignees = body.assigneeIds;
  if (body.dueDate !== undefined) task.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  await task.save();

  const populated = await Task.findById(task._id).populate("assignees", "name").lean();
  return NextResponse.json(toTaskDTO(populated));
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const access = await assertAccess(params.id, userId);
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  await Task.findByIdAndDelete(params.id);
  return NextResponse.json({ ok: true });
}
