import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { normalizeObjectId } from "@/lib/objectId";
import { applyProjectMembership } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateObjectIdField } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { loadProjectAsManager as loadManagedProject, respondWithUpdatedProject } from "@/lib/projectQueries";

// Loads the project (with its team populated, for the roster checks below)
// and confirms the current user is its manager. Shared by POST and DELETE,
// which otherwise differ only in which mutation they apply.
const loadProjectAsManager = (id, userId) =>
  loadManagedProject(id, userId, {
    forbiddenMessage: "Only the project manager can manage project access",
    populate: ["team"],
  });

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
  const removeUserId = normalizeObjectId(searchParams.get("userId"));
  if (!removeUserId) {
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
