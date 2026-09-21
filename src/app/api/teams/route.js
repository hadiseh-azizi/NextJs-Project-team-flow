import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import { toTeamDTO } from "@/lib/serialize";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

const MAX_TEAM_NAME_LENGTH = 100;

// Teams the current user manages or is a member of.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const teams = await Team.find({ $or: [{ manager: userId }, { members: userId }] })
    .populate("manager", "name email")
    .populate("members", "name email")
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json(teams.map((team) => toTeamDTO(team)));
}

// Creating a team makes the current user its manager. The manager is also
// added as a member so they can be assigned tasks like anyone else.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const nameResult = validateRequiredString(body.name, { field: "Team name", maxLength: MAX_TEAM_NAME_LENGTH });
  if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });

  await connectDB();

  return withMongoErrorHandling(async () => {
    const team = await Team.create({ name: nameResult.value, manager: userId, members: [userId] });
    const populated = await Team.findById(team._id)
      .populate("manager", "name email")
      .populate("members", "name email")
      .lean();

    return NextResponse.json(toTeamDTO(populated), { status: 201 });
  });
}
