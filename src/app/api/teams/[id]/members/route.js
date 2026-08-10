import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import User from "@/models/User";
import Invitation from "@/models/Invitation";
import { toTeamDTO } from "@/lib/serialize";
import { sendTeamInviteEmail } from "@/lib/email";

// Only the team manager can add or remove members — this is the boundary
// that keeps one team's roster from being edited by outsiders.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const team = await Team.findById(params.id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (String(team.manager) !== userId) {
    return NextResponse.json({ error: "Only the team manager can add members" }, { status: 403 });
  }

  const { email } = await req.json();
  const invitedUser = await User.findOne({ email }).lean();

  // No account with this email yet — record a pending invitation and email
  // them a sign-up link. They'll be added to the team automatically the
  // moment they register with this same address.
  if (!invitedUser) {
    const existingInvite = await Invitation.findOne({ email: email.toLowerCase(), team: params.id }).lean();
    if (existingInvite) {
      return NextResponse.json({ error: "This email has already been invited" }, { status: 409 });
    }

    const manager = await User.findById(userId).select("name").lean();
    await Invitation.create({ email, team: params.id, invitedBy: userId });
    await sendTeamInviteEmail({ to: email, teamName: team.name, inviterName: manager.name });

    return NextResponse.json({ status: "invited", email }, { status: 201 });
  }

  if (team.members.some((m) => String(m) === String(invitedUser._id))) {
    return NextResponse.json({ error: "This user is already a team member" }, { status: 409 });
  }

  team.members.push(invitedUser._id);
  await team.save();

  const populated = await Team.findById(team._id)
    .populate("manager", "name email")
    .populate("members", "name email")
    .lean();

  return NextResponse.json({ status: "added", team: toTeamDTO(populated) }, { status: 201 });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const removeUserId = searchParams.get("userId");

  await connectDB();

  const team = await Team.findById(params.id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (String(team.manager) !== userId) {
    return NextResponse.json({ error: "Only the team manager can remove members" }, { status: 403 });
  }
  if (removeUserId === String(team.manager)) {
    return NextResponse.json({ error: "The team manager cannot be removed" }, { status: 400 });
  }

  team.members = team.members.filter((m) => String(m) !== removeUserId);
  await team.save();

  const populated = await Team.findById(team._id)
    .populate("manager", "name email")
    .populate("members", "name email")
    .lean();

  return NextResponse.json(toTeamDTO(populated));
}
