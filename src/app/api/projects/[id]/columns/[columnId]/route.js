import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toColumnDTO } from "@/lib/serialize";
import { getAccessibleProject, canEditProject } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateInteger } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";

const MAX_COLUMN_NAME_LENGTH = 60;

// Rename or reorder a column. (Columns have no special meaning — in
// particular none is a "completed" column; completion lives on the task.)
export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id, columnId } = await params;

  await connectDB();

  const project = await getAccessibleProject(id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!canEditProject(project, userId)) {
    return NextResponse.json(
      { error: "You don't have permission to edit this column." },
      { status: 403 }
    );
  }

  if (!isValidObjectId(columnId)) return NextResponse.json({ error: "Column not found" }, { status: 404 });
  const column = await Column.findOne({ _id: columnId, project: id }).lean();
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const updateFields = {};
  if (body.name !== undefined) {
    const nameResult = validateRequiredString(body.name, { field: "Column name", maxLength: MAX_COLUMN_NAME_LENGTH });
    if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });
    updateFields.name = nameResult.value;
  }
  if (body.order !== undefined) {
    const orderResult = validateInteger(body.order, { field: "Order", min: 0 });
    if (orderResult.error) return NextResponse.json({ error: orderResult.error }, { status: 400 });
    updateFields.order = orderResult.value;
  }

  return withMongoErrorHandling(async () => {
    // Columns are all equal: renaming/reordering touches this one document
    // and nothing else. (There is no "done" flag to keep unique across the
    // project any more, so no multi-document transaction is needed.)
    const updated = await Column.findOneAndUpdate(
      { _id: columnId, project: id },
      { $set: updateFields },
      { new: true }
    );
    if (!updated) return NextResponse.json({ error: "Column not found" }, { status: 404 });

    return NextResponse.json(toColumnDTO(updated));
  });
}

// A column can only be deleted while it's empty — this avoids silently
// losing tasks or having to guess which column they should move to.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id, columnId } = await params;

  await connectDB();

  const project = await getAccessibleProject(id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!canEditProject(project, userId)) {
    return NextResponse.json(
      { error: "You don't have permission to delete this column." },
      { status: 403 }
    );
  }

  if (!isValidObjectId(columnId)) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  return withMongoErrorHandling(async () => {
    // The empty-check and the delete happen inside one transaction so a
    // task can't be created into this column in the gap between "confirmed
    // empty" and "deleted" — see the matching note in tasks/route.js POST,
    // which re-checks column existence for the same reason. As there,
    // this closes the window down to two reads inside one transaction
    // rather than a whole request; it doesn't add document-level locking,
    // so a task-create transaction that started its own snapshot before
    // this one commits is still a theoretical, low-probability edge case
    // accepted here rather than engineered away.
    let result;
    try {
      result = await withOptionalTransaction(async (session) => {
        const column = await Column.findOne({ _id: columnId, project: id }).session(session ?? null);
        if (!column) throw new ColumnNotFoundError();

        const taskCount = await Task.countDocuments({ column: columnId }).session(session ?? null);
        if (taskCount > 0) throw new ColumnNotEmptyError();

        await Column.deleteOne({ _id: columnId, project: id }, { session: session ?? undefined });
        return { ok: true };
      });
    } catch (err) {
      if (err instanceof ColumnNotFoundError) {
        return NextResponse.json({ error: "Column not found" }, { status: 404 });
      }
      if (err instanceof ColumnNotEmptyError) {
        return NextResponse.json({ error: "Move or delete this column's tasks first" }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json(result);
  });
}

// Sentinels used to short-circuit out of the transaction callback above
// with a clean, specific response instead of a generic 500 — thrown
// instead of returned because a value returned from inside
// withOptionalTransaction's callback just becomes the (unused)
// transaction result, not the route's actual response.
class ColumnNotFoundError extends Error {}
class ColumnNotEmptyError extends Error {}
