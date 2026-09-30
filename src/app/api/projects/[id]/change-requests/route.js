import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Task from "@/models/Task";
import Column from "@/models/Column";
import ChangeRequest from "@/models/ChangeRequest";
import { CHANGE_REQUEST_ACTION_TYPES } from "@/models/ChangeRequest";
import { toChangeRequestDTO } from "@/lib/serialize";
import { getAccessibleProject } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateEnumValue, validateObjectIdField } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

const MAX_DESCRIPTION_LENGTH = 1000;

// Action types that describe a change to one specific task, and so
// require `targetTaskId`. `moveTask` additionally requires
// `targetColumnId` — the requested destination. `other` has no required
// target (it covers project- and column-level asks, and anything else).
const TASK_SCOPED_ACTION_TYPES = new Set(["moveTask", "toggleComplete", "editTask"]);

function populateForResponse(query) {
  return query.populate("requester", "name email").populate("targetTask", "title").populate("targetColumn", "name");
}

// Anyone with view access to the project can submit a request — this is
// deliberately not restricted to people who currently lack edit
// permission: a request is a proposal, and letting anyone use the same
// path keeps the rule simple rather than depending on the exact edit
// state at submission time (which the requester's own UI already reads
// from the project DTO to decide when to show this action at all).
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const actionTypeResult = validateEnumValue(body.actionType, { field: "Action type", allowed: CHANGE_REQUEST_ACTION_TYPES });
  if (actionTypeResult.error) return NextResponse.json({ error: actionTypeResult.error }, { status: 400 });
  const actionType = actionTypeResult.value;

  const descriptionResult = validateRequiredString(body.description, { field: "Description", maxLength: MAX_DESCRIPTION_LENGTH });
  if (descriptionResult.error) return NextResponse.json({ error: descriptionResult.error }, { status: 400 });

  let targetTaskId = null;
  let targetColumnId = null;
  if (TASK_SCOPED_ACTION_TYPES.has(actionType)) {
    const taskIdResult = validateObjectIdField(body.targetTaskId, { field: "targetTaskId" });
    if (taskIdResult.error) return NextResponse.json({ error: taskIdResult.error }, { status: 400 });
    targetTaskId = taskIdResult.value;
  }
  if (actionType === "moveTask") {
    const columnIdResult = validateObjectIdField(body.targetColumnId, { field: "targetColumnId" });
    if (columnIdResult.error) return NextResponse.json({ error: columnIdResult.error }, { status: 400 });
    targetColumnId = columnIdResult.value;
  }

  await connectDB();

  const project = await getAccessibleProject(id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  // The referenced task/column must actually belong to this project —
  // otherwise a request could point at a task the manager can't (and
  // shouldn't) see the context for, or masquerade as being about this
  // project while targeting another one entirely.
  if (targetTaskId) {
    const task = await Task.findOne({ _id: targetTaskId, project: id }).select("_id").lean();
    if (!task) return NextResponse.json({ error: "That task wasn't found in this project" }, { status: 404 });
  }
  if (targetColumnId) {
    const column = await Column.findOne({ _id: targetColumnId, project: id }).select("_id").lean();
    if (!column) return NextResponse.json({ error: "That column wasn't found in this project" }, { status: 404 });
  }

  return withMongoErrorHandling(async () => {
    const created = await ChangeRequest.create({
      project: id,
      requester: userId,
      actionType,
      targetTask: targetTaskId,
      targetColumn: targetColumnId,
      description: descriptionResult.value,
    });

    const populated = await populateForResponse(ChangeRequest.findById(created._id)).lean();
    return NextResponse.json(toChangeRequestDTO(populated), { status: 201 });
  });
}

// The project manager sees every request (optionally filtered to one
// status, e.g. `?status=pending` for their queue); anyone else only sees
// their own — this is someone else's request queue, not a shared log.
export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  await connectDB();

  const project = await getAccessibleProject(id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");
  if (statusFilter && !["pending", "approved", "rejected"].includes(statusFilter)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const isManager = String(project.manager?._id ?? project.manager) === userId;

  const filter = { project: id, ...(statusFilter ? { status: statusFilter } : {}), ...(isManager ? {} : { requester: userId }) };

  const requests = await populateForResponse(ChangeRequest.find(filter).sort({ createdAt: -1 })).lean();

  return NextResponse.json(requests.map(toChangeRequestDTO));
}
