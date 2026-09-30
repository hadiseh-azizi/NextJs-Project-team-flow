import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toProjectDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { applyProjectMembership } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateObjectIdField } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };
const MEMBERS_POPULATE = { path: "members", select: "name email" };
const EDITORS_POPULATE = { path: "editors", select: "name email" };

// Loads the project (with its team populated, for the roster checks below)
// and confirms the current user is its manager. Shared by POST and DELETE,
// which otherwise differ only in which mutation they apply.
async function loadProjectAsManager(id, userId) {
  if (!isValidObjectId(id)) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  const project = await Project.findById(id).populate("team").lean();
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  if (String(project.manager?._id ?? project.manager) !== userId) {
    return { error: NextResponse.json({ error: "Only the project manager can manage project access" }, { status: 403 }) };
  }

  return { project };
}

async function respondWithUpdatedProject(id) {
  const project = await Project.findById(id)
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .populate(MEMBERS_POPULATE)
    .populate(EDITORS_POPULATE)
    .lean();
  const [columns, tasks] = await Promise.all([
    Column.find({ project: id }).sort({ order: 1, createdAt: 1, _id: 1 }).lean(),
    Task.find({ project: id })
      .select("-attachments.data")
      .populate("assignees", "name")
      .sort({ order: 1 })
      .lean(),
  ]);
  return NextResponse.json(toProjectDTO(project, columns, tasks));
}

// Grants an individual team member access to this project. Only the
// project manager (which, since only a Team Manager can ever create a
// project — see POST /api/projects — is always that team's manager too)
// can do this, and only for someone who's actually on the team: this is
// the boundary that keeps membership from being used to pull in an
// outsider.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  await connectDB();

  const { project, error } = await loadProjectAsManager(id, userId);
  if (error) return error;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const userIdResult = validateObjectIdField(body.userId, { field: "userId" });
  if (userIdResult.error) return NextResponse.json({ error: userIdResult.error }, { status: 400 });
  const targetUserId = userIdResult.value;

  if (targetUserId === String(project.manager?._id ?? project.manager)) {
    return NextResponse.json({ error: "The project manager already has access" }, { status: 400 });
  }
  const isOnTeam = (project.team.members || []).some((m) => String(m._id ?? m) === targetUserId);
  if (!isOnTeam) {
    return NextResponse.json({ error: "Only members of this project's team can be added" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    await applyProjectMembership(project, targetUserId, "add");
    return respondWithUpdatedProject(id);
  });
}

// Revokes an individual member's access to this project. The project
// manager always keeps access (see projectAccessFor in lib/authz.js), so
// removing them here is rejected rather than silently ignored.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const removeUserId = searchParams.get("userId");
  if (!isValidObjectId(removeUserId)) {
    return NextResponse.json({ error: "A valid userId query parameter is required" }, { status: 400 });
  }

  await connectDB();

  const { project, error } = await loadProjectAsManager(id, userId);
  if (error) return error;

  if (removeUserId === String(project.manager?._id ?? project.manager)) {
    return NextResponse.json({ error: "The project manager cannot be removed" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    await applyProjectMembership(project, removeUserId, "remove");
    return respondWithUpdatedProject(id);
  });
}
