import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Column from "@/models/Column";
import { toTeamDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { teamAccessFor, isTeamManager } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { MAX_TEAM_NAME_LENGTH } from "@/lib/fieldLimits";


export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  await connectDB();

  const team = await Team.findById(id)
    .populate("manager", "name email")
    .populate("members", "name email")
    .lean();
  // L4: a missing team and one the caller isn't on are the same response.
  const { isManager, allowed } = team ? teamAccessFor(team, userId) : { isManager: false, allowed: false };
  if (!allowed) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  // Pending (not-yet-registered) invitations are only shown to the manager
  // — the same person who's allowed to send them in the first place. An
  // expired invitation is no longer honored at registration (see
  // register/route.js), so it's excluded here too rather than shown as
  // "pending" when it can't actually be accepted anymore; the TTL index
  // on Invitation removes the document itself shortly after.
  const pendingInvitations = isManager
    ? await Invitation.find({ team: id, expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .lean()
    : null;

  return NextResponse.json(toTeamDTO(team, pendingInvitations));
}

// Only the team manager can rename it — the same permission that already
// governs adding/removing members and creating projects for the team.
export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  await connectDB();

  const team = await Team.findById(id).lean();
  // L4: same response whether the team is missing or just not yours.
  if (!team || !isTeamManager(team, userId)) {
    return NextResponse.json({ error: "Only the team manager can rename it" }, { status: 403 });
  }

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const nameResult = validateRequiredString(body.name, { field: "Team name", maxLength: MAX_TEAM_NAME_LENGTH });
  if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });

  return withMongoErrorHandling(async () => {
    await Team.updateOne({ _id: id }, { $set: { name: nameResult.value } });

    const updated = await Team.findById(id)
      .populate("manager", "name email")
      .populate("members", "name email")
      .lean();

    // Same visibility rule GET uses: only the manager sees pending
    // invitations included in the response.
    const pendingInvitations = await Invitation.find({ team: id, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(toTeamDTO(updated, pendingInvitations));
  });
}

// Only the team manager can delete the team, and only by sending the team's
// exact name as `confirmName` (the UI makes them type it). The name check is
// enforced here, not just in the dialog, so a stray or scripted DELETE can't
// wipe a team and everything in it.
//
// What goes: the team's projects, each project's columns and tasks (their
// attachments live inside the task documents), the team's pending
// invitations, and the team itself. What stays: every user account. Members
// simply stop having this team. Nothing outside the team references its
// projects, tasks or columns (see the models), so there is nothing else to
// clean up.
//
// Children are deleted first and the team last. On a replica set it is all
// one transaction anyway; on a standalone MongoDB (no transactions) an
// interrupted run leaves the team still present, so the manager can simply
// try again, instead of leaving projects and tasks that no one can reach.
// Every step is a deleteMany/deleteOne, so re-running is harmless.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  await connectDB();

  const team = await Team.findById(id).lean();
  // L4: same response whether the team is missing or just not yours.
  if (!team || !isTeamManager(team, userId)) {
    return NextResponse.json({ error: "Only the team manager can delete it" }, { status: 403 });
  }

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  if (typeof body.confirmName !== "string" || body.confirmName.trim() !== team.name.trim()) {
    return NextResponse.json({ error: "Type the team's name exactly to confirm deletion" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    await withOptionalTransaction(async (dbSession) => {
      const options = dbSession ? { session: dbSession } : undefined;
      const projects = await Project.find({ team: team._id }, { _id: 1 })
        .session(dbSession ?? null)
        .lean();
      const projectIds = projects.map((p) => p._id);

      if (projectIds.length > 0) {
        await Task.deleteMany({ project: { $in: projectIds } }, options);
        await Column.deleteMany({ project: { $in: projectIds } }, options);
        await Project.deleteMany({ _id: { $in: projectIds } }, options);
      }
      await Invitation.deleteMany({ team: team._id }, options);
      await Team.deleteOne({ _id: team._id }, options);
    });

    return NextResponse.json({ ok: true });
  });
}
