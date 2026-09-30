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

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };
const MEMBERS_POPULATE = { path: "members", select: "name email" };
const EDITORS_POPULATE = { path: "editors", select: "name email" };

const MAX_PROJECT_NAME_LENGTH = 150;

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
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!projectAccessFor(project, userId).allowed) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const [columns, tasks] = await Promise.all([
    // Tie-broken by createdAt/_id in case any column ever shares an
    // `order` value (see lib/columnOrderCompare.js) — the unique index on
    // Column prevents new duplicates, but this keeps display order
    // deterministic regardless.
    Column.find({ project: id }).sort({ order: 1, createdAt: 1, _id: 1 }).lean(),
    // The board view only ever needs attachment metadata (name/size/count),
    // never the base64 contents — excluding it here means opening a
    // project doesn't pull every attachment's full bytes for every task
    // out of MongoDB on every load.
    Task.find({ project: id })
      .select("-attachments.data")
      .populate("assignees", "name")
      .sort({ order: 1 })
      .lean(),
  ]);

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
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (String(project.manager) !== userId) {
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

    const updated = await Project.findById(id)
      .populate("manager", "name email")
      .populate(TEAM_POPULATE)
      .populate(MEMBERS_POPULATE)
      .populate(EDITORS_POPULATE)
      .lean();
    const [columns, tasks] = await Promise.all([
      Column.find({ project: id }).sort({ order: 1, createdAt: 1, _id: 1 }).lean(),
      Task.find({ project: id })
        .select("-attachments.data")
        .populate("assignees", "name")
        .sort({ order: 1 })
        .lean(),
    ]);

    return NextResponse.json(toProjectDTO(updated, columns, tasks));
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
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (String(project.manager) !== userId) {
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
