import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import { toColumnDTO } from "@/lib/serialize";

async function assertAccess(projectId, userId) {
  const project = await Project.findById(projectId).populate("team").lean();
  if (!project) return null;
  const isManager = String(project.manager) === userId;
  const isTeamMember = project.team.members.some((m) => String(m) === userId);
  return isManager || isTeamMember ? project : null;
}

// Anyone who can see the project can add a column — deciding the board's
// shape isn't a manager-only privilege, it's a team thing.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "Column name is required" }, { status: 400 });

  await connectDB();

  const project = await assertAccess(params.id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const maxOrder = await Column.findOne({ project: params.id }).sort({ order: -1 }).lean();
  const column = await Column.create({
    name,
    project: params.id,
    order: maxOrder ? maxOrder.order + 1 : 0,
  });

  return NextResponse.json(toColumnDTO(column), { status: 201 });
}
