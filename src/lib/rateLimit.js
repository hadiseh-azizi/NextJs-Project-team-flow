import { connectDB } from "@/lib/mongodb";
import RateLimitAttempt from "@/models/RateLimitAttempt";

// Atomic, DB-backed fixed-window rate limiter.
//
// Why not an in-memory Map: this app's target deployment is Next.js on
// top of MongoDB Atlas (see .env.example / mongoTransaction.js), which in
// practice means either multiple long-lived instances behind a load
// balancer or a serverless/edge runtime with many short-lived ones. A
// counter kept in a module-level Map only limits requests that happen to
// land on the same warm instance — with more than one instance it stops
// doing anything useful, and every cold start/redeploy silently resets
// it back to zero. That is a real gap, not a theoretical one: it's the
// exact shape of bug that lets an attacker "outrun" a rate limit just by
// how the platform load-balances or recycles instances, while looking
// like it works fine in a single-instance local test.
//
// MongoDB is already required infrastructure for this app, so counting
// attempts there adds no new operational dependency (no Redis, no third
// party service) while giving every instance a consistent, shared view.
// `findOneAndUpdate` on a single document is atomic in MongoDB regardless
// of how many callers race it, which is what makes this safe without a
// transaction.
//
// Deliberately a fixed window, not sliding/token-bucket: it's simple
// enough to express as one atomic update, and "at most `max` attempts
// per `windowMs`, then a hard reset" is a well-understood trade-off for
// what this guards against (credential stuffing, resend spam,
// registration flooding). A caller right at a window boundary can in the
// worst case get ~2x the nominal limit — that does not meaningfully help
// an attacker running hundreds or thousands of automated attempts, which
// is the actual threat model here.
//
// Returns { limited, remaining, retryAfterMs }. Fails OPEN (never blocks
// a request) if the rate-limit check itself errors out (e.g. a transient
// DB blip) — a broken limiter should degrade to "no extra protection",
// not take down login/registration/resend entirely.
export async function checkRateLimit(key, { max, windowMs }) {
  if (!key || !Number.isFinite(max) || max < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error("checkRateLimit: invalid key/max/windowMs");
  }

  try {
    await connectDB();
  } catch (err) {
    console.error("[rateLimit] connectDB failed, failing open:", err);
    return { limited: false, remaining: max, retryAfterMs: 0 };
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowMs);

  // Aggregation-pipeline update: if the stored window has already
  // expired (or this is a brand-new key), reset to count 1 with a fresh
  // window; otherwise increment the existing window's count. Expressed
  // as a single pipeline so the "is it expired?" check and the
  // increment-or-reset happen atomically as one document operation —
  // there's no read-then-write gap for two concurrent requests to race
  // through.
  const isStaleOrNew = { $or: [{ $eq: ["$expiresAt", null] }, { $lte: ["$expiresAt", now] }] };
  const pipeline = [
    {
      $set: {
        count: { $cond: [isStaleOrNew, 1, { $add: ["$count", 1] }] },
        expiresAt: { $cond: [isStaleOrNew, windowEnd, "$expiresAt"] },
      },
    },
  ];
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };

  let doc;
  try {
    doc = await RateLimitAttempt.findOneAndUpdate({ key }, pipeline, options);
  } catch (err) {
    // Two requests racing to create the *same new* key can both miss
    // each other and both attempt the upsert's insert; MongoDB's unique
    // index on `key` lets one through and the other gets a duplicate-key
    // error rather than silently corrupting the count. Retrying once
    // resolves it normally: the retry finds the now-existing document
    // and increments it instead of trying to insert again.
    if (err?.code === 11000) {
      try {
        doc = await RateLimitAttempt.findOneAndUpdate({ key }, pipeline, options);
      } catch (retryErr) {
        console.error("[rateLimit] retry after duplicate key failed, failing open:", retryErr);
        return { limited: false, remaining: max, retryAfterMs: 0 };
      }
    } else {
      console.error("[rateLimit] check failed, failing open:", err);
      return { limited: false, remaining: max, retryAfterMs: 0 };
    }
  }

  const limited = doc.count > max;
  const retryAfterMs = limited ? Math.max(0, doc.expiresAt.getTime() - now.getTime()) : 0;
  return { limited, remaining: Math.max(0, max - doc.count), retryAfterMs };
}
