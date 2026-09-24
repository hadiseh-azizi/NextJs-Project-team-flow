import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { toTeamDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { teamAccessFor, isTeamManager } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

const MAX_TEAM_NAME_LENGTH = 100;

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
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const { isManager, allowed } = teamAccessFor(team, userId);
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
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (!isTeamManager(team, userId)) {
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
