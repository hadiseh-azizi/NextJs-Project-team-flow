import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Team from "@/models/Team";
import { toProjectDTO, toProjectSummaryDTO } from "@/lib/serialize";
import { countTasksByProjectIds } from "@/lib/taskCounts";
import { isValidObjectId } from "@/lib/objectId";
import { isTeamManager } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateOptionalString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { MAX_PROJECT_NAME_LENGTH, MAX_PROJECT_DESCRIPTION_LENGTH } from "@/lib/fieldLimits";
import { TEAM_POPULATE, MEMBERS_POPULATE, findAccessibleProjects } from "@/lib/projectQueries";


// The Projects page lists one card per project: name, description, team
// name and "N of M done". So the list returns exactly that — see
// toProjectSummaryDTO(). It deliberately does not carry columns, tasks, the
// team roster or the editor list; GET /api/projects/[id] is where a
// project's full board comes from.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  // Candidate set narrowed to the projects this user can actually access —
  // team membership alone doesn't guarantee access (see lib/authz.js). That
  // check reads ids only (manager, members, team.members), so the team's
  // members come back unpopulated and `members`/`editors` are not populated.
  const projects = await findAccessibleProjects(userId, [
    { path: "manager", select: "name email" },
    { path: "team", select: "name members" },
  ]);

  // H2: a card needs "N of M done", so the database counts per project
  // ($match + $group) and only those numbers come back — no task documents
  // are loaded. A project with no tasks has no row; toProjectSummaryDTO
  // reads that as 0 of 0.
  const counts = await countTasksByProjectIds(projects.map((p) => p._id));

  const dtos = projects.map((p) => toProjectSummaryDTO(p, counts.get(String(p._id))));

  return NextResponse.json(dtos);
}

// Only a team's manager can create projects for that team.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { teamId } = body;

  const nameResult = validateRequiredString(body.name, { field: "Project name", maxLength: MAX_PROJECT_NAME_LENGTH });
  if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });

  const descriptionResult = validateOptionalString(body.description, {
    field: "Description",
    maxLength: MAX_PROJECT_DESCRIPTION_LENGTH,
  });
  if (descriptionResult.error) return NextResponse.json({ error: descriptionResult.error }, { status: 400 });

  if (!teamId) return NextResponse.json({ error: "You must select a team" }, { status: 400 });
  if (!isValidObjectId(teamId)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  await connectDB();

  const team = await Team.findById(teamId).lean();
  // L4: same response whether the team is missing or just not yours.
  if (!team || !isTeamManager(team, userId)) {
    return NextResponse.json({ error: "Only the team manager can create projects for it" }, { status: 403 });
  }

  return withMongoErrorHandling(async () => {
    // A project starts with no board at all — not even an empty one.
    // Kanban is an opt-in feature of a project, not something every
    // project is forced into: the user adds a board (i.e. its first
    // column) explicitly from the project page whenever they want one.
    // See the "Add board" empty state in KanbanBoard.jsx.
    // `members` starts as an explicit empty array (not left unset), so a
    // brand-new project is access-restricted from the moment it's
    // created — only its manager has access until they add people. This
    // is what makes a *new* project's default the opposite of a legacy
    // project's: see models/Project.js and lib/authz.js's projectAccessFor
    // for how the two are told apart.
    const project = await Project.create({
      name: nameResult.value,
      description: descriptionResult.value ?? null,
      manager: userId,
      team: teamId,
      members: [],
    });

    const populated = await Project.findById(project._id)
      .populate("manager", "name email")
      .populate(TEAM_POPULATE)
      .populate(MEMBERS_POPULATE)
      .lean();

    return NextResponse.json(toProjectDTO(populated, [], []), { status: 201 });
  });
}
