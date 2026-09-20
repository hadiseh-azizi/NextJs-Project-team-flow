import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";
import { getTaskAccess, validateAssignees } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import {
  validateRequiredString,
  validateOptionalString,
  validateOptionalDate,
  validateOptionalEnumValue,
  validateInteger,
} from "@/lib/validation";
import { TASK_COLORS } from "@/lib/taskColors";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { planTaskMove, withOptionalTransaction } from "@/lib/taskOrdering";

const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const TASK_COLOR_KEYS = TASK_COLORS.map((c) => c.key);

export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  await connectDB();

  const access = await getTaskAccess(id, userId);
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const { task, project } = access;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  // A move is requested via `columnId` (change column), `targetIndex`
  // (reorder within a column — 0-based position among that column's
  // *other* tasks), or both together for a cross-column drag. Neither
  // field is applied to `task` directly here: the actual column+order
  // assignment happens atomically in planTaskMove() below, alongside
  // every other field change in this request, in a single document
  // write. Sending `columnId` alone (e.g. the column dropdown in the
  // task detail view, which doesn't know about ordering) appends the
  // task to the end of the destination column.
  let destColumnId;
  let targetIndex;

  if (body.columnId !== undefined) {
    if (!isValidObjectId(body.columnId)) {
      return NextResponse.json({ error: "Invalid column" }, { status: 400 });
    }
    const column = await Column.findOne({ _id: body.columnId, project: project._id }).lean();
    if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });
    destColumnId = body.columnId;
  }
  if (body.targetIndex !== undefined) {
    const targetIndexResult = validateInteger(body.targetIndex, { field: "Position", min: 0, max: 100_000 });
    if (targetIndexResult.error) return NextResponse.json({ error: targetIndexResult.error }, { status: 400 });
    targetIndex = targetIndexResult.value;
    if (destColumnId === undefined) destColumnId = String(task.column);
  }
  if (body.title !== undefined) {
    const titleResult = validateRequiredString(body.title, { field: "Task title", maxLength: MAX_TASK_TITLE_LENGTH });
    if (titleResult.error) return NextResponse.json({ error: titleResult.error }, { status: 400 });
    task.title = titleResult.value;
  }
  if (body.description !== undefined) {
    const descriptionResult = validateOptionalString(body.description, {
      field: "Description",
      maxLength: MAX_TASK_DESCRIPTION_LENGTH,
    });
    if (descriptionResult.error) return NextResponse.json({ error: descriptionResult.error }, { status: 400 });
    task.description = descriptionResult.value;
  }
  if (body.assigneeIds !== undefined) {
    // A task can only be assigned to people who actually belong to this
    // project's team (or its manager) — same rule the create route
    // enforces, applied here too via the shared helper. Unlike a silent
    // filter, an id outside this set is rejected rather than dropped, so
    // a request can't be partially honored to assign someone from another
    // team.
    const { assignees, error: assigneeError } = validateAssignees(project, body.assigneeIds);
    if (assigneeError) return NextResponse.json({ error: assigneeError }, { status: 400 });
    task.assignees = assignees;
  }
  if (body.dueDate !== undefined) {
    const dueDateResult = validateOptionalDate(body.dueDate, { field: "Due date" });
    if (dueDateResult.error) return NextResponse.json({ error: dueDateResult.error }, { status: 400 });
    task.dueDate = dueDateResult.value;
  }
  if (body.color !== undefined) {
    const colorResult = validateOptionalEnumValue(body.color, { field: "Color", allowed: TASK_COLOR_KEYS });
    if (colorResult.error) return NextResponse.json({ error: colorResult.error }, { status: 400 });
    task.color = colorResult.value;
  }

  return withMongoErrorHandling(async () => {
    if (destColumnId !== undefined) {
      // Column/order assignment and the save both happen inside one
      // transaction (falls back to a plain write if the server doesn't
      // support transactions — see withOptionalTransaction), so a
      // rebalance that touches sibling tasks can never be left
      // half-applied, and no other request can observe this task between
      // "position decided" and "position saved".
      await withOptionalTransaction(async (session) => {
        await planTaskMove({ task, destColumnId, targetIndex, session });
        await task.save({ session: session ?? undefined });
      });
    } else {
      await task.save();
    }
    // Metadata only — see lib/attachmentPolicy.js and getTaskAccess() for
    // why attachment `data` is kept out of every response that isn't the
    // dedicated download route.
    const populated = await Task.findById(task._id)
      .select("-attachments.data")
      .populate("assignees", "name")
      .lean();
    return NextResponse.json(toTaskDTO(populated));
  });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  await connectDB();

  const access = await getTaskAccess(id, userId);
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  return withMongoErrorHandling(async () => {
    // The deleted document isn't used for anything here, but
    // findByIdAndDelete still returns (and Mongoose still hydrates) it by
    // default — excluding attachments.data means a task with several MB of
    // attachments doesn't get that data loaded into memory just to be
    // discarded a line later.
    await Task.findByIdAndDelete(id).select("-attachments.data");
    return NextResponse.json({ ok: true });
  });
}
