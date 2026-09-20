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

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };

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
