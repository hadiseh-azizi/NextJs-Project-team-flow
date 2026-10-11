import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Column from "@/models/Column";
import Task from "@/models/Task";
import { toSharedBoardDTO } from "@/lib/serialize";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { countTasksByColumn } from "@/lib/taskCounts";
import { SHARED_BOARD_MAX_COLUMNS, SHARED_BOARD_MAX_TASKS } from "@/lib/sharedBoardLimits";

// Loose enough that a real viewer refreshing or reopening a cached tab
// never notices it, but bounded so this public, unauthenticated route
// can't be turned into an unbounded token-guessing or scraping loop.
// Per-IP rather than per-token: a wrong token never reaches a database
// query at all under this limit, and a correct one is cheap to serve
// repeatedly.
const SHARED_BOARD_IP_LIMIT = { max: 60, windowMs: 60 * 1000, failClosed: true };

// H4: used when no trustworthy client IP exists — RATE_LIMIT_TRUST_PROXY=none,
// or a request that simply carries no usable forwarding header (see
// lib/clientIp.js). Before this, such requests skipped rate limiting
// entirely. Now they all share ONE bucket, the same strategy
// register/route.js uses (REGISTER_FALLBACK_LIMIT). Properties worth knowing:
//
//  - The key is a constant, never derived from request data, so a caller
//    cannot mint new buckets by varying headers and the collection cannot
//    grow from this path: it is exactly one document, which carries the
//    same TTL (`expiresAt`) as every other rate-limit document.
//  - The ceiling is 10x the per-IP one because every viewer on the
//    deployment now draws from the same bucket. 600/min (10 requests a
//    second, in total) is far above what real viewers of a share link
//    generate and still stops sustained scraping.
//  - The cost: while the real IP is unknowable, one abusive client can use up
//    the shared bucket and make other viewers wait out the window (they get
//    429 with Retry-After). That is the price of not leaving the endpoint
//    unmetered, and is the reason RATE_LIMIT_TRUST_PROXY should be set
//    correctly for the host (README, .env.example).
const SHARED_BOARD_FALLBACK_LIMIT = { max: 600, windowMs: 60 * 1000, failClosed: true };
const FALLBACK_BUCKET_KEY = "shared-board:no-ip-fallback";

function retryAfterHeaders(retryAfterMs) {
  return { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) };
}

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

  // Every request that gets past the token-shape check is metered: by IP
  // when one can be trusted, otherwise against the shared fallback bucket.
  // The limiter is asked to fail closed — this route has no other rate
  // control, so "the limiter broke" must not mean "no limit". It is not a
  // new availability cost: serving a board needs the same database anyway.
  const ip = getClientIp(req.headers);
  const hasTrustedIp = ip !== "unknown";
  const { limited, unavailable, retryAfterMs } = await checkRateLimit(
    hasTrustedIp ? `shared-board:ip:${ip}` : FALLBACK_BUCKET_KEY,
    hasTrustedIp ? SHARED_BOARD_IP_LIMIT : SHARED_BOARD_FALLBACK_LIMIT
  );
  if (unavailable) {
    return NextResponse.json(
      { error: "This board is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: retryAfterHeaders(retryAfterMs) }
    );
  }
  if (limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: retryAfterHeaders(retryAfterMs) }
    );
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

  // H4: the work below is bounded however large the project is. The counts
  // come from MongoDB (grouped numbers only), the columns and tasks are cut
  // in the database with a deterministic sort, and the DTO builder applies
  // the per-field limits and the byte budget (lib/sharedBoardLimits.js).
  const columnSort = { order: 1, createdAt: 1, _id: 1 };
  const [columns, totalColumns, columnCounts] = await Promise.all([
    Column.find({ project: found._id }).sort(columnSort).limit(SHARED_BOARD_MAX_COLUMNS).lean(),
    Column.countDocuments({ project: found._id }),
    countTasksByColumn(found._id),
  ]);

  // Only tasks of the columns being sent. Sorted by (order, createdAt, _id) —
  // the same tie-break the board view uses — so cutting at the limit leaves
  // each column with an unbroken run of its first tasks, and the same board
  // always yields the same slice.
  const tasks = await Task.find({ project: found._id, column: { $in: columns.map((c) => c._id) } })
    // Never loads attachment bytes or any auth-only fields — the public
    // DTO builder (toSharedBoardDTO) only reads filename/mimeType/size
    // off each attachment anyway, but excluding `.data` here means the
    // (potentially large, base64) file contents never leave MongoDB for
    // this route in the first place.
    .select("-attachments.data")
    .populate("assignees", "name")
    .sort(columnSort)
    .limit(SHARED_BOARD_MAX_TASKS)
    .lean();

  return NextResponse.json(toSharedBoardDTO(found, columns, tasks, { totalColumns, columnCounts }));
}
