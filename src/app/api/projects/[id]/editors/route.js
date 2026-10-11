import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { normalizeObjectId } from "@/lib/objectId";
import { applyProjectEditPermission, isEligibleEditor } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateObjectIdField } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { loadProjectAsManager as loadManagedProject, respondWithUpdatedProject, MEMBERS_POPULATE } from "@/lib/projectQueries";

// Loads the project (with its team and members populated, for the roster
// checks below) and confirms the current user is its manager. Shared by
// POST and DELETE, which otherwise differ only in which mutation they apply.
const loadProjectAsManager = (id, userId) =>
  loadManagedProject(id, userId, {
    forbiddenMessage: "Only the project manager can manage editing permissions",
    populate: ["team", MEMBERS_POPULATE],
  });

// Grants an individual member explicit edit permission — only meaningful
// while the project is in "manager_approval" mode (see
// lib/authz.js's canEditProject), but storable regardless so a manager
// can set editors up before switching the mode. Only the project manager
// can do this, and only for someone who is on the project's team AND
// already has *view* access to the project (isEligibleEditor) — granting
// edit rights to an outsider, or to someone who can't even open the
// project, must never be possible, and would bypass the separate
// view-access boundary members/route.js controls.
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
    return NextResponse.json({ error: "The project manager can always edit" }, { status: 400 });
  }
  if (!isEligibleEditor(project, targetUserId)) {
    return NextResponse.json({ error: "Only members of this project's team who have access to the project can be granted edit access" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    await applyProjectEditPermission(project, targetUserId, "add");
    return respondWithUpdatedProject(id);
  });
}

// Revokes an individual member's explicit edit permission. The project
// manager can always edit (see canEditProject), so removing them here is
// rejected rather than silently ignored — same asymmetry
// members/route.js's DELETE uses for view access.
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
    await applyProjectEditPermission(project, removeUserId, "remove");
    return respondWithUpdatedProject(id);
  });
}
