import { NextResponse } from "next/server";

// Translates the handful of Mongoose/MongoDB error shapes routes can
// actually anticipate (schema validation failures, malformed ObjectIds
// that slipped through as a query filter value, duplicate-key races) into
// the same `{ error: string }` shape apiFetch() already expects.
//
// Returns `null` for anything it doesn't recognize — callers should let
// that case propagate (rethrow) rather than swallow it, so unexpected
// failures still show up in server logs instead of being silently
// reshaped into a misleading 400. This function never includes the
// original error's message, stack, or driver-specific fields in the
// response; only a fixed, generic, user-safe string per error kind.
export function mongoErrorResponse(err) {
  if (!err) return null;

  if (err.name === "ValidationError") {
    return NextResponse.json({ error: "Some fields are invalid" }, { status: 400 });
  }
  if (err.name === "CastError") {
    return NextResponse.json({ error: "One or more values are invalid" }, { status: 400 });
  }
  if (err.name === "MongoServerError" && err.code === 11000) {
    return NextResponse.json({ error: "This record already exists" }, { status: 409 });
  }
  if (err.code === 11000) {
    return NextResponse.json({ error: "This record already exists" }, { status: 409 });
  }
  // A save that would push the document past MongoDB's 16MB BSON limit —
  // in practice only reachable for attachment uploads, since every other
  // field this app writes is small text. The per-file/per-task attachment
  // caps (see lib/attachmentPolicy.js) are meant to make this unreachable,
  // but the driver and server surface it under a few different
  // names/messages depending on version, so this is matched defensively
  // by message rather than a single error code.
  if (/bson|document.{0,20}(too large|exceeds)/i.test(err.message || "")) {
    return NextResponse.json(
      { error: "This file is too large to store on this task. Remove another attachment first, or upload a smaller file." },
      { status: 413 }
    );
  }

  return null;
}

// Wraps a route handler body: runs `fn`, and if it throws something
// `mongoErrorResponse` recognizes, returns the safe response for it;
// otherwise logs server-side and returns a generic 500 rather than
// letting the raw error (and its stack trace) reach the client.
export async function withMongoErrorHandling(fn) {
  try {
    return await fn();
  } catch (err) {
    const handled = mongoErrorResponse(err);
    if (handled) return handled;
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
