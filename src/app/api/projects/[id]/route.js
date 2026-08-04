import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Column from "@/models/Column";
import { toProjectDTO } from "@/lib/serialize";

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };

function hasAccess(project, userId) {
  const isManager = String(project.manager._id) === userId;
  const isTeamMember = project.team.members.some((m) => String(m._id) === userId);
  return isManager || isTeamMember;
}

export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const project = await Project.findById(params.id)
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .lean();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!hasAccess(project, userId)) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const [columns, tasks] = await Promise.all([
    Column.find({ project: params.id }).sort({ order: 1 }).lean(),
    Task.find({ project: params.id }).populate("assignees", "name").sort({ order: 1 }).lean(),
  ]);

  return NextResponse.json(toProjectDTO(project, columns, tasks));
}

// Only the project manager (its creator) can delete the whole project.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const project = await Project.findById(params.id).lean();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (String(project.manager) !== userId) {
    return NextResponse.json({ error: "Only the project manager can delete it" }, { status: 403 });
  }

  await Project.findByIdAndDelete(params.id);
  await Task.deleteMany({ project: params.id });
  await Column.deleteMany({ project: params.id });

  return NextResponse.json({ ok: true });
}
