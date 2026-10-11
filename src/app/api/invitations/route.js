import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import Invitation from "@/models/Invitation";

// Pending team invitations addressed to the signed-in user's own email —
// the other half of M4: an existing account joins a team only by finding
// the invitation here and accepting it. Matching is by the account's own
// stored (verified-to-sign-in) email, never by anything the client sends,
// so nobody can list or act on invitations addressed to someone else.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  await connectDB();

  const me = await User.findById(session.user.id).select("email").lean();
  if (!me) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const invitations = await Invitation.find({ email: me.email, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .populate("team", "name")
    .populate("invitedBy", "name")
    .lean();

  return NextResponse.json(
    invitations
      .filter((inv) => inv.team)
      .map((inv) => ({
        id: String(inv._id),
        teamName: inv.team.name,
        inviterName: inv.invitedBy?.name || "A team manager",
        createdAt: inv.createdAt,
      }))
  );
}
