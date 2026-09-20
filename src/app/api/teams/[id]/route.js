import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { toTeamDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { teamAccessFor } from "@/lib/authz";

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
