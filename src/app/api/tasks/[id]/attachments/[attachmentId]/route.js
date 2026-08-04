import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";

async function assertAccess(taskId, userId) {
  const task = await Task.findById(taskId);
  if (!task) return null;
  const project = await Project.findById(task.project).populate("team").lean();
  if (!project) return null;
  const isManager = String(project.manager) === userId;
  const isTeamMember = project.team.members.some((m) => String(m) === userId);
  return isManager || isTeamMember ? task : null;
}

// Streams the raw file back with the right headers so the browser downloads
// it (or opens it inline for things like PDFs/images).
export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const task = await assertAccess(params.id, userId);
  if (!task) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const attachment = task.attachments.id(params.attachmentId);
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const buffer = Buffer.from(attachment.data, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const task = await assertAccess(params.id, userId);
  if (!task) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const attachment = task.attachments.id(params.attachmentId);
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });

  attachment.deleteOne();
  await task.save();

  const populated = await Task.findById(task._id).populate("assignees", "name").lean();
  return NextResponse.json(toTaskDTO(populated));
}
