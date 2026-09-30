import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";
import { getAccessibleProject, validateAssignees, canEditProject } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateOptionalString, validateOptionalDate, validateOptionalEnumValue } from "@/lib/validation";
import { TASK_COLORS } from "@/lib/taskColors";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { nextOrderForNewTask, withOptionalTransaction } from "@/lib/taskOrdering";
import { readFormDataWithLimit, PayloadTooLargeError } from "@/lib/limitedFormData";
import {
  MAX_FILE_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_CREATE_UPLOAD_REQUEST_SIZE,
  ALLOWED_TYPES_SUMMARY,
  sanitizeFilename,
  resolveAttachmentMimeType,
  validateAttachmentFile,
} from "@/lib/attachmentPolicy";

const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const TASK_COLOR_KEYS = TASK_COLORS.map((c) => c.key);

// Task creation accepts either a plain JSON body (the original, still-
// supported shape) or a multipart/form-data body carrying a "data" field
// (the same JSON payload, stringified) plus zero or more "files" parts —
// used only when the client is attaching files at creation time. Every
// existing JSON caller (including the manual test harness's fakeReq,
// which has no `.headers`) is completely unaffected: the multipart branch
// is only taken when the content-type says so.
function isMultipartRequest(req) {
  const contentType = req.headers?.get?.("content-type") || "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  let body;
  let incomingFiles = [];

  if (isMultipartRequest(req)) {
    let formData;
    try {
      formData = await readFormDataWithLimit(req, MAX_CREATE_UPLOAD_REQUEST_SIZE);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return NextResponse.json({ error: "The attached files are too large" }, { status: 413 });
      }
      return NextResponse.json({ error: "The upload couldn't be read. Please try again." }, { status: 400 });
    }

    const raw = formData.get("data");
    if (typeof raw !== "string") return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    // Every non-string entry under "files" is a real upload; a client
    // sending none is the common case (creating a task with no attachments
    // via the same multipart shape isn't required, but is handled the same
    // as if it had used the JSON path).
    incomingFiles = formData.getAll("files").filter((f) => f && typeof f !== "string");
  } else {
    body = await parseJsonBody(req);
    if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { projectId, columnId, assigneeIds } = body;

  const titleResult = validateRequiredString(body.title, { field: "Task title", maxLength: MAX_TASK_TITLE_LENGTH });
  if (titleResult.error) return NextResponse.json({ error: titleResult.error }, { status: 400 });

  const descriptionResult = validateOptionalString(body.description, {
    field: "Description",
    maxLength: MAX_TASK_DESCRIPTION_LENGTH,
  });
  if (descriptionResult.error) return NextResponse.json({ error: descriptionResult.error }, { status: 400 });

  const dueDateResult = validateOptionalDate(body.dueDate, { field: "Due date" });
  if (dueDateResult.error) return NextResponse.json({ error: dueDateResult.error }, { status: 400 });

  const colorResult = validateOptionalEnumValue(body.color, { field: "Color", allowed: TASK_COLOR_KEYS });
  if (colorResult.error) return NextResponse.json({ error: colorResult.error }, { status: 400 });

  if (!isValidObjectId(projectId) || !isValidObjectId(columnId)) {
    return NextResponse.json({ error: "Invalid project or column" }, { status: 400 });
  }

  // Attachments selected at creation time go through the exact same
  // per-file checks (size, extension/MIME pairing, magic-byte signature)
  // and the same running-total/count caps as the post-creation upload
  // route (see app/api/tasks/[id]/attachments/route.js) — just evaluated
  // against 0 pre-existing attachments, since the task doesn't exist yet.
  // Validated in full before anything touches the database, same as the
  // field validation above, so a bad file never leaves behind a task.
  if (incomingFiles.length > MAX_ATTACHMENTS_PER_TASK) {
    return NextResponse.json(
      { error: `A task cannot have more than ${MAX_ATTACHMENTS_PER_TASK} attachments` },
      { status: 400 }
    );
  }

  const attachmentsToCreate = [];
  let runningTotal = 0;
  for (const file of incomingFiles) {
    if (file.size <= 0) {
      return NextResponse.json({ error: `"${file.name}" is empty` }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `"${file.name}" is larger than the allowed 5MB per file` }, { status: 400 });
    }
    runningTotal += file.size;
    if (runningTotal > MAX_TOTAL_ATTACHMENTS_SIZE) {
      return NextResponse.json(
        { error: "The selected files exceed the 8MB total attachment limit for a task" },
        { status: 400 }
      );
    }

    const filename = sanitizeFilename(file.name);
    const declaredMimeType = typeof file.type === "string" ? file.type.split(";")[0].trim().toLowerCase() : "";
    // Source-code files get a server-chosen type (browsers report these
    // inconsistently); every other type must still match what was declared.
    const mimeType = resolveAttachmentMimeType(filename, declaredMimeType);
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateAttachmentFile(filename, mimeType, buffer);
    if (!validation.ok) {
      return NextResponse.json(
        { error: `"${filename}": ${validation.error} Allowed: ${ALLOWED_TYPES_SUMMARY}.` },
        { status: 400 }
      );
    }

    attachmentsToCreate.push({ filename, mimeType, size: file.size, data: buffer.toString("base64") });
  }

  await connectDB();

  const project = await getAccessibleProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!canEditProject(project, userId)) {
    return NextResponse.json(
      { error: "You don't have permission to add tasks to this project. Submit a change request instead." },
      { status: 403 }
    );
  }

  // A task can only be assigned to people who actually belong to this
  // project's team (or its manager) — same rule the update route enforces.
  // An id outside that set is rejected with a 400, not silently dropped.
  const { assignees, error: assigneeError } = validateAssignees(project, assigneeIds ?? []);
  if (assigneeError) return NextResponse.json({ error: assigneeError }, { status: 400 });

  return withMongoErrorHandling(async () => {
    // `countDocuments` was the previous strategy here — it re-issues a
    // stale index once any task in the column has been deleted (e.g. a
    // column with tasks at orders 0/1/2 that loses order 1 hands out
    // order 2 again for the next task, colliding with the task already
    // there), on top of being racy under concurrent creates. Deriving the
    // order from the current max instead is correct regardless of past
    // deletions.
    //
    // Reading the max and inserting the new task happen inside one
    // transaction so a create can never read the column mid-rebalance
    // (see lib/taskOrdering.js) — without this, a create racing a
    // rebalance could read a half-renumbered "max" and hand out an order
    // that collides with a sibling once the rebalance finishes writing.
    // This does not, and isn't meant to, guarantee two *simultaneous*
    // creates into the same column always get distinct order values —
    // see lib/taskOrdering.js for why that specific tie is deliberately
    // tolerated (compareTasks resolves it deterministically everywhere
    // the app sorts tasks, and the next rebalance cleans it up).
    //
    // The column's existence is (re-)checked here, inside the same
    // transaction as the insert, rather than once up front before all the
    // validation above. A column can be deleted (while empty) at any time
    // by anyone with project access — checking only up front leaves a
    // window between that check and the eventual insert, below, where the
    // column can be deleted out from under this request, producing a task
    // that references a column that no longer exists. Re-checking right
    // next to the write can't close that window to zero (two fully
    // concurrent transactions can each read a snapshot from before the
    // other's commit — MongoDB's write-conflict detection only fires when
    // both transactions modify the same document, and this create never
    // writes to the Column document itself), but it shrinks the window
    // from "the entire request, including validation" down to "two reads
    // inside one transaction," which removes the version of this race
    // that was actually reachable in practice. The fully-simultaneous case
    // is the same class of low-probability, non-corrupting edge case
    // already accepted for task-order ties (see lib/taskOrdering.js) —
    // not engineered away with per-column document locking, which would
    // add real complexity for a gap this narrow.
    let task;
    try {
      task = await withOptionalTransaction(async (session) => {
        const column = await Column.findOne({ _id: columnId, project: projectId })
          .session(session ?? null)
          .lean();
        if (!column) {
          throw new ColumnNotFoundError();
        }

        const order = await nextOrderForNewTask(columnId, session);
        const [created] = await Task.create(
          [
            {
              project: projectId,
              column: columnId,
              title: titleResult.value,
              description: descriptionResult.value ?? null,
              assignees,
              dueDate: dueDateResult.value ?? null,
              color: colorResult.value ?? null,
              order,
              attachments: attachmentsToCreate,
            },
          ],
          { session: session ?? undefined }
        );
        return created;
      });
    } catch (err) {
      if (err instanceof ColumnNotFoundError) {
        return NextResponse.json({ error: "Column not found" }, { status: 404 });
      }
      throw err;
    }

    // toTaskDTO() never includes attachment `data`, so even when the new
    // task was created with attachments there's nothing to gain by
    // selecting it back out of MongoDB here.
    const populated = await Task.findById(task._id)
      .select("-attachments.data")
      .populate("assignees", "name")
      .lean();
    return NextResponse.json(toTaskDTO(populated), { status: 201 });
  });
}

// Sentinel used to short-circuit out of the transaction callback above
// with a clean 404 instead of a generic 500 — thrown instead of returned
// because a NextResponse returned from inside withOptionalTransaction's
// callback would just become the (unused) transaction result, not the
// route's actual response.
class ColumnNotFoundError extends Error {}
