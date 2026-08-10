import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { toTeamDTO } from "@/lib/serialize";

export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const team = await Team.findById(params.id)
    .populate("manager", "name email")
    .populate("members", "name email")
    .lean();
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const isManager = String(team.manager._id) === userId;
  const isMember = isManager || team.members.some((m) => String(m._id) === userId);
  if (!isMember) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  // Pending (not-yet-registered) invitations are only shown to the manager
  // — the same person who's allowed to send them in the first place.
  const pendingInvitations = isManager ? await Invitation.find({ team: params.id }).sort({ createdAt: -1 }).lean() : null;

  return NextResponse.json(toTeamDTO(team, pendingInvitations));
}
