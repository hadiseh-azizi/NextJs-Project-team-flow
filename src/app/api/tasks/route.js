import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";
import { getAccessibleProject, validateAssignees } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString, validateOptionalString, validateOptionalDate, validateOptionalEnumValue } from "@/lib/validation";
import { TASK_COLORS } from "@/lib/taskColors";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { nextOrderForNewTask, withOptionalTransaction } from "@/lib/taskOrdering";

const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const TASK_COLOR_KEYS = TASK_COLORS.map((c) => c.key);

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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

  await connectDB();

  const project = await getAccessibleProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

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

    // toTaskDTO() never includes attachment `data` (a brand-new task has
    // none anyway), so there's nothing to gain by selecting it here.
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
