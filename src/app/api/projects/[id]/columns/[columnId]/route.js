import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toColumnDTO } from "@/lib/serialize";

async function assertAccess(projectId, userId) {
  const project = await Project.findById(projectId).populate("team").lean();
  if (!project) return null;
  const isManager = String(project.manager) === userId;
  const isTeamMember = project.team.members.some((m) => String(m) === userId);
  return isManager || isTeamMember ? project : null;
}

// Rename, reorder, or flag a column as the "done" column.
export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const project = await assertAccess(params.id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const column = await Column.findOne({ _id: params.columnId, project: params.id });
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const body = await req.json();
  if (body.name !== undefined) column.name = body.name;
  if (body.order !== undefined) column.order = body.order;
  if (body.isDoneColumn !== undefined) column.isDoneColumn = body.isDoneColumn;
  await column.save();

  return NextResponse.json(toColumnDTO(column));
}

// A column can only be deleted while it's empty — this avoids silently
// losing tasks or having to guess which column they should move to.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const project = await assertAccess(params.id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const column = await Column.findOne({ _id: params.columnId, project: params.id });
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const taskCount = await Task.countDocuments({ column: params.columnId });
  if (taskCount > 0) {
    return NextResponse.json(
      { error: "Move or delete this column's tasks first" },
      { status: 409 }
    );
  }

  await column.deleteOne();
  return NextResponse.json({ ok: true });
}
