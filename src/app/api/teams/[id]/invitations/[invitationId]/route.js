import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { isValidObjectId } from "@/lib/objectId";
import { isTeamManager } from "@/lib/authz";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

// Lets the team manager retract an invitation before the person signs up.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id, invitationId } = await params;

  if (!isValidObjectId(id) || !isValidObjectId(invitationId)) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  await connectDB();

  const team = await Team.findById(id).lean();
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (!isTeamManager(team, userId)) {
    return NextResponse.json({ error: "Only the team manager can cancel invitations" }, { status: 403 });
  }

  return withMongoErrorHandling(async () => {
    await Invitation.deleteOne({ _id: invitationId, team: id });
    return NextResponse.json({ ok: true });
  });
}
