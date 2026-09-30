import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Team from "@/models/Team";
import Column from "@/models/Column";
import { toProjectDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { isTeamManager, accessibleTeamIds, filterAccessibleProjects } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateOptionalString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

const MAX_PROJECT_NAME_LENGTH = 150;
const MAX_PROJECT_DESCRIPTION_LENGTH = 2000;

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };
const MEMBERS_POPULATE = { path: "members", select: "name email" };
const EDITORS_POPULATE = { path: "editors", select: "name email" };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  await connectDB();

  const teamIds = await accessibleTeamIds(userId);

  // This query is only a candidate set — every project belonging to a team
  // the user is on. Team membership alone no longer guarantees access to
  // a given project (see lib/authz.js), so the list is narrowed below with
  // the same per-project check every other project route uses.
  const candidateProjects = await Project.find({ $or: [{ manager: userId }, { team: { $in: teamIds } }] })
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .populate(MEMBERS_POPULATE)
    .populate(EDITORS_POPULATE)
    .sort({ createdAt: -1 })
    .lean();

  const projects = filterAccessibleProjects(candidateProjects, userId);

  const projectIds = projects.map((p) => p._id);
  const [allColumns, allTasks] = await Promise.all([
    Column.find({ project: { $in: projectIds } }).lean(),
    // "-attachments.data" excludes the base64 file contents — toTaskDTO()
    // never includes it in the response, so loading it here would just
    // be several potentially-MB-sized reads per task thrown away before
    // the response is built.
    Task.find({ project: { $in: projectIds } })
      .select("-attachments.data")
      .populate("assignees", "name")
      .sort({ order: 1 })
      .lean(),
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
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (!isTeamManager(team, userId)) {
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
