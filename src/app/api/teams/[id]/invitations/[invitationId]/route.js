import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";

// Lets the team manager retract an invitation before the person signs up.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const team = await Team.findById(params.id).lean();
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (String(team.manager) !== userId) {
    return NextResponse.json({ error: "Only the team manager can cancel invitations" }, { status: 403 });
  }

  await Invitation.deleteOne({ _id: params.invitationId, team: params.id });
  return NextResponse.json({ ok: true });
}
