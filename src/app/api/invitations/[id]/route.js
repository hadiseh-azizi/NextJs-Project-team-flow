import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { isValidObjectId } from "@/lib/objectId";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";

// Same answer for "no such invitation", "addressed to someone else" and
// "expired" — the caller learns nothing about invitations that aren't theirs.
function notFound() {
  return NextResponse.json({ error: "Invitation not found or has expired" }, { status: 404 });
}

async function findMyInvitation(userId, invitationId) {
  const me = await User.findById(userId).select("email").lean();
  if (!me) return null;
  return Invitation.findOne({ _id: invitationId, email: me.email, expiresAt: { $gt: new Date() } }).lean();
}

// Accept: the only way an existing account is added to a team by invitation.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  if (!isValidObjectId(id)) return notFound();

  await connectDB();

  const invitation = await findMyInvitation(session.user.id, id);
  if (!invitation) return notFound();

  return withMongoErrorHandling(async () => {
    const team = await Team.findById(invitation.team).select("_id").lean();
    if (!team) {
      await Invitation.deleteOne({ _id: invitation._id });
      return notFound();
    }

    // Joining the team and consuming the invitation succeed or fail
    // together. $addToSet and deleteOne are both idempotent, so a retry of
    // this callback can't double-apply anything.
    await withOptionalTransaction(async (txSession) => {
      await Team.updateOne(
        { _id: team._id },
        { $addToSet: { members: session.user.id } },
        { session: txSession ?? undefined }
      );
      await Invitation.deleteOne({ _id: invitation._id }, { session: txSession ?? undefined });
    });

    return NextResponse.json({ ok: true, teamId: String(team._id) });
  });
}

// Decline.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  if (!isValidObjectId(id)) return notFound();

  await connectDB();

  const invitation = await findMyInvitation(session.user.id, id);
  if (!invitation) return notFound();

  return withMongoErrorHandling(async () => {
    await Invitation.deleteOne({ _id: invitation._id });
    return NextResponse.json({ ok: true });
  });
}
