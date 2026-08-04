import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — attachments are stored inline in MongoDB

async function assertAccess(taskId, userId) {
  const task = await Task.findById(taskId);
  if (!task) return null;
  const project = await Project.findById(task.project).populate("team").lean();
  if (!project) return null;
  const isManager = String(project.manager) === userId;
  const isTeamMember = project.team.members.some((m) => String(m) === userId);
  return isManager || isTeamMember ? task : null;
}

export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const task = await assertAccess(params.id, userId);
  if (!task) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file was uploaded" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File size must not exceed 5MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  task.attachments.push({
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    data: buffer.toString("base64"),
  });
  await task.save();

  const populated = await Task.findById(task._id).populate("assignees", "name").lean();
  return NextResponse.json(toTaskDTO(populated), { status: 201 });
}
