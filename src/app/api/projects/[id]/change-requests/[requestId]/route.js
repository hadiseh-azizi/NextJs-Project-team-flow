import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Column from "@/models/Column";
import ChangeRequest from "@/models/ChangeRequest";
import { toChangeRequestDTO } from "@/lib/serialize";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateEnumValue } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { planTaskMove, withOptionalTransaction } from "@/lib/taskOrdering";

const DECISIONS = ["approved", "rejected"];

// Re-applies a `moveTask` request's requested move, but only after
// re-checking that the task and destination column both still exist and
// still belong to this project — the request may have sat pending long
// enough for either to have been deleted, or for the task to have already
// been moved by someone else. On success the move itself uses the same
// planTaskMove()/withOptionalTransaction() path a live drag-and-drop uses
// (append to the end of the destination column — this route doesn't know
// about ordering the way a drag does). Returns an error string to store
// on the request instead of applying anything if the target isn't valid
// anymore; it never throws for a stale target, only for a real database
// error.
async function applyMoveTask(cr, projectId) {
  const task = await Task.findOne({ _id: cr.targetTask, project: projectId });
  if (!task) return "The task no longer exists.";
  const column = await Column.findOne({ _id: cr.targetColumn, project: projectId }).lean();
  if (!column) return "The destination column no longer exists.";
  if (String(task.column) === String(column._id)) return null; // already there — nothing to do
  await withOptionalTransaction(async (session) => {
    await planTaskMove({ task, destColumnId: String(column._id), targetIndex: undefined, session });
    await task.save({ session: session ?? undefined });
  });
  return null;
}

// Same re-validation principle as applyMoveTask: only marks the task
// completed if it still exists, and only if it isn't already completed
// (in which case the request's intent is already satisfied — not an
// error).
async function applyToggleComplete(cr, projectId) {
  const task = await Task.findOne({ _id: cr.targetTask, project: projectId });
  if (!task) return "The task no longer exists.";
  if (!task.completed) {
    task.completed = true;
    await task.save();
  }
  return null;
}

export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id, requestId } = await params;

  if (!isValidObjectId(id) || !isValidObjectId(requestId)) {
    return NextResponse.json({ error: "Change request not found" }, { status: 404 });
  }

  await connectDB();

  const project = await Project.findById(id).select("manager").lean();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (String(project.manager) !== userId) {
    return NextResponse.json({ error: "Only the project manager can decide on change requests" }, { status: 403 });
  }

  const cr = await ChangeRequest.findOne({ _id: requestId, project: id });
  if (!cr) return NextResponse.json({ error: "Change request not found" }, { status: 404 });
  if (cr.status !== "pending") {
    return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });
  }

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const statusResult = validateEnumValue(body.status, { field: "status", allowed: DECISIONS });
  if (statusResult.error) return NextResponse.json({ error: statusResult.error }, { status: 400 });

  return withMongoErrorHandling(async () => {
    cr.status = statusResult.value;
    cr.respondedAt = new Date();
    cr.respondedBy = userId;

    // Only an approved moveTask/toggleComplete request is ever auto-applied
    // — editTask/other are free-text descriptions of an intent the app
    // can't safely guess at, so approving one just records the manager's
    // decision; the manager still makes that change by hand, the normal
    // way. Rejecting never applies anything, regardless of action type.
    if (cr.status === "approved") {
      if (cr.actionType === "moveTask") cr.applyError = await applyMoveTask(cr, id);
      else if (cr.actionType === "toggleComplete") cr.applyError = await applyToggleComplete(cr, id);
    }

    await cr.save();

    const populated = await ChangeRequest.findById(cr._id)
      .populate("requester", "name email")
      .populate("targetTask", "title")
      .populate("targetColumn", "name")
      .populate("respondedBy", "name email")
      .lean();
    return NextResponse.json(toChangeRequestDTO(populated));
  });
}
