import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { projectId, columnId, title, description, assigneeIds, dueDate } = await req.json();
  if (!title) return NextResponse.json({ error: "Task title is required" }, { status: 400 });

  await connectDB();

  const project = await Project.findById(projectId).populate("team").lean();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const isManager = String(project.manager) === userId;
  const isTeamMember = project.team.members.some((m) => String(m) === userId);
  if (!isManager && !isTeamMember) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const column = await Column.findOne({ _id: columnId, project: projectId }).lean();
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  // A task can only be assigned to people who actually belong to this
  // project's team (or its manager) — silently drop anything else.
  const validAssignees = new Set([String(project.manager), ...project.team.members.map(String)]);
  const assignees = (assigneeIds || []).filter((id) => validAssignees.has(id));

  const order = await Task.countDocuments({ column: columnId });

  const task = await Task.create({
    project: projectId,
    column: columnId,
    title,
    description,
    assignees,
    dueDate: dueDate ? new Date(dueDate) : null,
    order,
  });

  const populated = await Task.findById(task._id).populate("assignees", "name").lean();
  return NextResponse.json(toTaskDTO(populated), { status: 201 });
}
