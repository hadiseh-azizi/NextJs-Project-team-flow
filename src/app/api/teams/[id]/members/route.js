import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import User from "@/models/User";
import { toTeamDTO } from "@/lib/serialize";

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
  if (!invitedUser) {
    return NextResponse.json({ error: "No user found with this email" }, { status: 404 });
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

  return NextResponse.json(toTeamDTO(populated), { status: 201 });
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
