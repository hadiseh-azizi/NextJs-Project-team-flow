import mongoose from "mongoose";

// Runs `fn(session)` inside a real MongoDB transaction. Atlas (this app's
// only supported deployment target — see .env.example) is always a
// replica set, so this is the normal path in production. Falls back to
// running `fn(null)` with no session if the server doesn't support
// transactions at all (a standalone `mongod`, which only really comes up
// against a bare local install) — acceptable there because every caller
// of this helper touches at most a handful of documents and local dev
// isn't handling concurrent traffic.
//
// `session.withTransaction()` also retries the callback itself on a
// transient error (e.g. two transactions writing overlapping documents
// and one loses the write conflict) — which is what makes this safe for
// two requests that race to modify the same documents: one aborts and
// retries against the other's now-committed state instead of the two
// interleaving into an invalid result.
//
// Originally written for task-move concurrency (see lib/taskOrdering.js);
// pulled out here so any route needing the same guarantee — e.g. the
// done-column toggle — can reuse it instead of duplicating the
// session/retry/fallback plumbing.
export async function withOptionalTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const message = String(err?.message || "");
    const transactionsUnsupported =
      err?.code === 20 || /Transaction numbers|replica set|transactions are not supported/i.test(message);
    if (!transactionsUnsupported) throw err;
    return fn(null);
  } finally {
    await session.endSession();
  }
}
