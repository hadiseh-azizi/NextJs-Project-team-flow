import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Team from "@/models/Team";
import Column from "@/models/Column";
import { toProjectDTO } from "@/lib/serialize";

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };

// A new project starts with three ready-made columns so the board isn't
// empty on day one — but from here on, people can rename, delete, and add
// as many columns as they want. The last one is flagged as the "done"
// column, which is what the progress stats key off of.
const DEFAULT_COLUMNS = [
  { name: "To Do", order: 0, isDoneColumn: false },
  { name: "In Progress", order: 1, isDoneColumn: false },
  { name: "Done", order: 2, isDoneColumn: true },
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const myTeams = await Team.find({ members: userId }).select("_id").lean();
  const teamIds = myTeams.map((t) => t._id);

  const projects = await Project.find({ $or: [{ manager: userId }, { team: { $in: teamIds } }] })
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .sort({ createdAt: -1 })
    .lean();

  const projectIds = projects.map((p) => p._id);
  const [allColumns, allTasks] = await Promise.all([
    Column.find({ project: { $in: projectIds } }).lean(),
    Task.find({ project: { $in: projectIds } }).populate("assignees", "name").sort({ order: 1 }).lean(),
  ]);

  const dtos = projects.map((p) =>
    toProjectDTO(
      p,
      allColumns.filter((c) => String(c.project) === String(p._id)),
      allTasks.filter((t) => String(t.project) === String(p._id))
    )
  );

  return NextResponse.json(dtos);
}

// Only a team's manager can create projects for that team.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { name, description, teamId } = await req.json();
  if (!name) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  if (!teamId) return NextResponse.json({ error: "You must select a team" }, { status: 400 });

  await connectDB();

  const team = await Team.findById(teamId).lean();
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (String(team.manager) !== userId) {
    return NextResponse.json({ error: "Only the team manager can create projects for it" }, { status: 403 });
  }

  const project = await Project.create({ name, description, manager: userId, team: teamId });
  const columns = await Column.insertMany(DEFAULT_COLUMNS.map((c) => ({ ...c, project: project._id })));

  const populated = await Project.findById(project._id)
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .lean();

  return NextResponse.json(toProjectDTO(populated, columns, []), { status: 201 });
}
