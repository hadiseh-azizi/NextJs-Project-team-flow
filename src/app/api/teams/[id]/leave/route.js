import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import { isValidObjectId } from "@/lib/objectId";
import { teamAccessFor } from "@/lib/authz";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { removeUserFromTeams } from "@/lib/teamMembership";

// A member leaves a team. This is the same removal the manager can do to a
// member (DELETE /api/teams/[id]/members), applied to yourself: you leave the
// roster and lose access to the team's projects and task assignments.
//
// The manager cannot leave. A team must always have a manager, and there is no
// ownership-transfer flow in this app, so the only way for a manager to be
// done with a team is to delete it. Refusing here (rather than letting the
// request through) is what prevents a team whose `manager` is a user who is no
// longer on it.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  await connectDB();

  const team = await Team.findById(id).lean();
  const access = team ? teamAccessFor(team, userId) : { isManager: false, isMember: false };
  // L4: a missing team and one you aren't on are the same response.
  if (!access.isMember) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (access.isManager) {
    return NextResponse.json(
      { error: "The team manager can't leave the team. Delete the team instead." },
      { status: 400 }
    );
  }

  return withMongoErrorHandling(async () => {
    await withOptionalTransaction((dbSession) => removeUserFromTeams([team._id], userId, dbSession));
    return NextResponse.json({ ok: true });
  });
}
