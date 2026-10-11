import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Column from "@/models/Column";
import { toProjectDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { projectAccessFor } from "@/lib/authz";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateEnumValue } from "@/lib/validation";
import { EDITING_MODES } from "@/lib/authz";
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/fieldLimits";
import { TEAM_POPULATE, MEMBERS_POPULATE, EDITORS_POPULATE, loadColumnsAndTasks, respondWithUpdatedProject } from "@/lib/projectQueries";


export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await connectDB();

  const project = await Project.findById(id)
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .populate(MEMBERS_POPULATE)
    .populate(EDITORS_POPULATE)
    .lean();
  // L4: missing and not-accessible are one response (see authz.js: most
  // routes deliberately don't distinguish them), so ids can't be probed.
  if (!project || !projectAccessFor(project, userId).allowed) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const [columns, tasks] = await loadColumnsAndTasks(id);

  return NextResponse.json(toProjectDTO(project, columns, tasks));
}

// Only the project manager (its creator) can rename it or change its
// editing-permission mode — same bar for both: each changes something
// about the project for everyone who has access, not just a personal
// setting.
export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await connectDB();

  const project = await Project.findById(id).lean();
  // L4: same response whether the project is missing or just not yours.
  if (!project || String(project.manager) !== userId) {
    return NextResponse.json({ error: "Only the project manager can rename it" }, { status: 403 });
  }

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  // Two independent, optional fields: a rename (`name`) and/or an
  // editing-mode change (`editingMode`) — either can be sent alone,
  // matching the same "undefined means unchanged" convention used
  // everywhere else in this route set (see lib/validation.js).
  const updateFields = {};
  if (body.name !== undefined) {
    const nameResult = validateRequiredString(body.name, { field: "Project name", maxLength: MAX_PROJECT_NAME_LENGTH });
    if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });
    updateFields.name = nameResult.value;
  }
  if (body.editingMode !== undefined) {
    const modeResult = validateEnumValue(body.editingMode, { field: "Editing mode", allowed: EDITING_MODES });
    if (modeResult.error) return NextResponse.json({ error: modeResult.error }, { status: 400 });
    updateFields.editingMode = modeResult.value;
  }
  if (Object.keys(updateFields).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    await Project.updateOne({ _id: id }, { $set: updateFields });

    // A rename or editing-mode change touches one project document, so the
    // response is the access summary ({ id, name, members, editingMode,
    // editors }), not the whole project with every column and task. The
    // project page merges it into the copy it already holds.
    return respondWithUpdatedProject(id);
  });
}

// Only the project manager (its creator) can delete the whole project.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await connectDB();

  const project = await Project.findById(id).lean();
  // L4: same response whether the project is missing or just not yours.
  if (!project || String(project.manager) !== userId) {
    return NextResponse.json({ error: "Only the project manager can delete it" }, { status: 403 });
  }

  return withMongoErrorHandling(async () => {
    // Deleting a project without also deleting its tasks/columns (or
    // partially deleting them, if one step failed) would leave orphaned
    // documents pointing at a project that no longer exists. All three
    // deletes happen inside one transaction so the project either
    // disappears completely or not at all. Uses withOptionalTransaction
    // (see lib/mongoTransaction.js) rather than a raw
    // mongoose.startSession()/session.withTransaction() pair so this
    // degrades to three plain sequential deletes — instead of throwing —
    // against a standalone (non-replica-set) MongoDB, matching what
    // README.md documents for this operation. All three deletes are
    // individually idempotent (deleting an already-deleted id, or
    // `deleteMany` matching zero documents, is a no-op), so a retried
    // transaction callback or a fallback partial failure can never
    // double-apply or corrupt state — worst case without a session is a
    // crash between the three deletes leaving orphaned tasks/columns,
    // which is the acceptable single-developer trade-off the fallback
    // exists for.
    await withOptionalTransaction(async (session) => {
      await Project.findByIdAndDelete(id, { session: session ?? undefined });
      await Task.deleteMany({ project: id }, { session: session ?? undefined });
      await Column.deleteMany({ project: id }, { session: session ?? undefined });
    });

    return NextResponse.json({ ok: true });
  });
}
