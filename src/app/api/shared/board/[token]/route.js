import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toSharedBoardDTO } from "@/lib/serialize";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

// Loose enough that a real viewer refreshing or reopening a cached tab
// never notices it, but bounded so this public, unauthenticated route
// can't be turned into an unbounded token-guessing or scraping loop.
// Per-IP rather than per-token: a wrong token never reaches a database
// query at all under this limit, and a correct one is cheap to serve
// repeatedly.
const SHARED_BOARD_IP_LIMIT = { max: 60, windowMs: 60 * 1000 };

// A dedicated, unauthenticated route rather than reusing
// GET /api/projects/[id] with a token in place of a session — this way
// there is exactly one query path that can ever return project data
// without a login, and it's built from scratch to return only the fields
// toSharedBoardDTO() explicitly allows (see lib/serialize.js).
export async function GET(req, { params }) {
  const { token } = await params;

  if (typeof token !== "string" || !token || token.length > 200) {
    return NextResponse.json({ error: "This board isn't available." }, { status: 404 });
  }

  const ip = getClientIp(req.headers);
  if (ip !== "unknown") {
    const { limited } = await checkRateLimit(`shared-board:ip:${ip}`, SHARED_BOARD_IP_LIMIT);
    if (limited) {
      return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
    }
  }

  await connectDB();

  // `shareEnabled: true` is part of the query, not a check performed
  // after loading — a disabled or never-shared project's token (if it
  // even still has one on the document) simply doesn't match, so a
  // revoked link stops working immediately without a second code path to
  // keep in sync. A non-matching token and a token that matches a
  // project with sharing disabled get the identical response, on purpose
  // — see the authz.js convention this follows (getAccessibleProject's
  // comment on not distinguishing "missing" from "denied").
  const found = await Project.findOne({ shareToken: token, shareEnabled: true }).lean();
  if (!found) {
    return NextResponse.json({ error: "This board isn't available. The link may be invalid, disabled, or revoked." }, { status: 404 });
  }

  const [columns, tasks] = await Promise.all([
    Column.find({ project: found._id }).sort({ order: 1, createdAt: 1, _id: 1 }).lean(),
    // Never loads attachment bytes or any auth-only fields — the public
    // DTO builder (toSharedBoardDTO) only reads filename/mimeType/size
    // off each attachment anyway, but excluding `.data` here means the
    // (potentially large, base64) file contents never leave MongoDB for
    // this route in the first place.
    Task.find({ project: found._id })
      .select("-attachments.data")
      .populate("assignees", "name")
      .sort({ order: 1 })
      .lean(),
  ]);

  return NextResponse.json(toSharedBoardDTO(found, columns, tasks));
}
