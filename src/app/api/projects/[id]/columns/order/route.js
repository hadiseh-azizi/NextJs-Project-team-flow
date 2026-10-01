import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Column from "@/models/Column";
import { toColumnDTO } from "@/lib/serialize";
import { getAccessibleProject, canEditProject } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { compareColumns } from "@/lib/columnOrderCompare";
import { validateColumnOrderPayload, planColumnReorder } from "@/lib/columnReorder";

// Sentinels thrown from inside the transaction callback so the route can
// answer with a specific status instead of a generic 500 (a value
// *returned* from that callback would just become the transaction result).
class ForeignColumnsError extends Error {}
class BoardChangedError extends Error {}

// Saves a new left-to-right order for a project's columns. The client
// sends the complete resulting order in one request:
//   PATCH { columnOrder: ["<columnId>", ...] }
// and the server rewrites every column's `order` to 0..n-1 in that
// sequence — which also normalizes any gaps left by deleted columns or
// by projects that predate this endpoint.
//
// Authorization is exactly the existing per-project check every other
// column mutation uses: view access via getAccessibleProject, then
// canEditProject (manager, explicitly granted editors, or everyone when
// the project's editing mode is "everyone"). Nothing here trusts the
// client about who may reorder.
export async function PATCH(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  await connectDB();

  const project = await getAccessibleProject(id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (!canEditProject(project, userId)) {
    return NextResponse.json(
      { error: "You don't have permission to reorder columns in this project." },
      { status: 403 }
    );
  }

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const payload = validateColumnOrderPayload(body.columnOrder, isValidObjectId);
  if (payload.error) return NextResponse.json({ error: payload.error }, { status: 400 });
  const requestedIds = payload.value;

  return withMongoErrorHandling(async () => {
    let columns;
    try {
      columns = await withOptionalTransaction(async (session) => {
        const sessionOpt = session ?? undefined;
        // Read inside the transaction so the "exactly this project's
        // columns" check and the writes see the same snapshot.
        const existing = await Column.find({ project: id }).session(session ?? null).lean();
        const plan = planColumnReorder(existing, requestedIds);

        if (plan.foreign.length > 0) throw new ForeignColumnsError();
        if (plan.missing.length > 0) throw new BoardChangedError();

        if (!plan.alreadyNormalized) {
          // The unique (project, order) index (models/Column.js) rejects
          // any intermediate state where two columns share an order, so
          // a straight rewrite of 0..n-1 could collide with a column
          // that hasn't been moved yet. Two passes avoid that: first
          // park every column on a fresh block of values above the
          // current maximum (already in the requested sequence), then
          // settle them onto 0..n-1. Inside the transaction this is
          // atomic; on a standalone server without transactions, a
          // failure between the passes still leaves a valid, correctly
          // ordered board — just with larger order numbers.
          const maxOrder = existing.reduce((m, c) => (Number.isFinite(c.order) ? Math.max(m, c.order) : m), 0);
          const base = maxOrder + requestedIds.length + 1;
          const oid = (columnId) => existing.find((c) => String(c._id) === columnId)._id;

          await Column.bulkWrite(
            requestedIds.map((columnId, i) => ({
              updateOne: { filter: { _id: oid(columnId), project: id }, update: { $set: { order: base + i } } },
            })),
            { session: sessionOpt }
          );
          await Column.bulkWrite(
            requestedIds.map((columnId, i) => ({
              updateOne: { filter: { _id: oid(columnId), project: id }, update: { $set: { order: i } } },
            })),
            { session: sessionOpt }
          );
        }

        // Re-read for the response so it reflects what was stored, in
        // the explicit saved order (never MongoDB's natural order).
        return Column.find({ project: id })
          .sort({ order: 1, createdAt: 1, _id: 1 })
          .session(session ?? null)
          .lean();
      });
    } catch (err) {
      if (err instanceof ForeignColumnsError) {
        return NextResponse.json({ error: "One or more columns don't belong to this project" }, { status: 400 });
      }
      if (err instanceof BoardChangedError) {
        return NextResponse.json(
          { error: "This board changed while you were reordering. Refresh and try again." },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({ columns: columns.map(toColumnDTO).sort(compareColumns) });
  });
}
