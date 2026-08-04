import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
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

  const isMember = String(team.manager._id) === userId || team.members.some((m) => String(m._id) === userId);
  if (!isMember) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  return NextResponse.json(toTeamDTO(team));
}
