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
import { isTeamManager, accessibleTeamIds } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateOptionalString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";

const MAX_PROJECT_NAME_LENGTH = 150;
const MAX_PROJECT_DESCRIPTION_LENGTH = 2000;

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

  const teamIds = await accessibleTeamIds(userId);

  const projects = await Project.find({ $or: [{ manager: userId }, { team: { $in: teamIds } }] })
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .sort({ createdAt: -1 })
    .lean();

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
    // A project without its default columns (or vice versa) would leave the
    // board unusable, so both writes happen inside one transaction: either
    // the project and its starter columns are created together, or neither
    // is. Uses withOptionalTransaction (see lib/mongoTransaction.js)
    // rather than a raw mongoose.startSession()/session.withTransaction()
    // pair — the raw form throws outright on a standalone (non-replica-set)
    // MongoDB instead of falling back to an unsessioned write, which this
    // app's fallback story (see README.md) otherwise promises for every
    // sensitive multi-document operation. The fallback here is safe: both
    // inserts are brand-new documents (never previously written), so a
    // driver-level retry of this callback, or the no-session fallback path
    // running the two inserts without isolation, can at worst create a
    // project without its default columns if the process crashes between
    // the two writes — annoying but not corrupting, and equivalent to the
    // trade-off already accepted for local, single-developer usage.
    const { project, columns } = await withOptionalTransaction(async (session) => {
      const created = await Project.create(
        [{ name: nameResult.value, description: descriptionResult.value ?? null, manager: userId, team: teamId }],
        { session: session ?? undefined }
      );
      const newProject = created[0];
      const newColumns = await Column.insertMany(
        DEFAULT_COLUMNS.map((c) => ({ ...c, project: newProject._id })),
        { session: session ?? undefined }
      );
      return { project: newProject, columns: newColumns };
    });

    const populated = await Project.findById(project._id)
      .populate("manager", "name email")
      .populate(TEAM_POPULATE)
      .lean();

    return NextResponse.json(toProjectDTO(populated, columns, []), { status: 201 });
  });
}
