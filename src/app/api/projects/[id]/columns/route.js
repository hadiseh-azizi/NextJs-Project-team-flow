import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Column from "@/models/Column";
import { toColumnDTO } from "@/lib/serialize";
import { getAccessibleProject } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

const MAX_COLUMN_NAME_LENGTH = 60;

// Column order is derived from "current max + 1", but reading that max
// and inserting the new column are two separate operations — two
// concurrent requests can both read the same max and try to insert at
// the same order. The unique (project, order) index on Column (see
// models/Column.js) turns that race into a duplicate-key error instead
// of silently corrupting the sort order; this retries with a freshly
// read max whenever that happens, so the race is invisible to the user
// and no artificial locking is needed. A handful of attempts is more
// than enough — each retry can only be caused by another request that
// just committed, not by a growing queue of waiters.
const MAX_CREATE_ATTEMPTS = 5;

export async function createColumnWithNextOrder({ name, projectId }) {
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    const maxOrder = await Column.findOne({ project: projectId }).sort({ order: -1 }).lean();
    const order = maxOrder ? maxOrder.order + 1 : 0;
    try {
      return await Column.create({ name, project: projectId, order });
    } catch (err) {
      const isOrderCollision = err?.code === 11000;
      if (!isOrderCollision || attempt === MAX_CREATE_ATTEMPTS) throw err;
      // Someone else just took this order — loop and read the new max.
    }
  }
}

// Anyone who can see the project can add a column — deciding the board's
// shape isn't a manager-only privilege, it's a team thing.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const nameResult = validateRequiredString(body.name, { field: "Column name", maxLength: MAX_COLUMN_NAME_LENGTH });
  if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });

  const { id } = await params;

  await connectDB();

  const project = await getAccessibleProject(id, userId);
  if (!project) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  return withMongoErrorHandling(async () => {
    const column = await createColumnWithNextOrder({ name: nameResult.value, projectId: id });
    return NextResponse.json(toColumnDTO(column), { status: 201 });
  });
}
