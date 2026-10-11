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
// Returns { limited, remaining, retryAfterMs, unavailable }.
//
// By default it fails OPEN (never blocks a request) if the rate-limit check
// itself errors out (e.g. a transient DB blip) — a broken limiter should
// degrade to "no extra protection", not take down login/registration/resend
// entirely. That default is deliberate for the account flows, which have
// other identities (email, token) enforcing limits of their own.
//
// A caller whose limiter is the ONLY protection on an unauthenticated route
// (the public shared board) passes `failClosed: true`. When the check cannot
// be completed it then gets `{ limited: true, unavailable: true }` — the
// request is not allowed through unmetered, and `unavailable` lets the route
// answer 503 ("try again shortly") instead of a 429 that would wrongly say
// the caller did something wrong. Only the outcome of the limiter's own
// check changes; the counting logic below is identical for both modes.
const UNAVAILABLE_RETRY_MS = 5000;

export async function checkRateLimit(key, { max, windowMs, failClosed = false }) {
  if (!key || !Number.isFinite(max) || max < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error("checkRateLimit: invalid key/max/windowMs");
  }

  const onLimiterFailure = (what, err) => {
    if (failClosed) {
      console.error(`[rateLimit] ${what}, failing closed:`, err);
      return { limited: true, unavailable: true, remaining: 0, retryAfterMs: UNAVAILABLE_RETRY_MS };
    }
    console.error(`[rateLimit] ${what}, failing open:`, err);
    return { limited: false, remaining: max, retryAfterMs: 0 };
  };

  try {
    await connectDB();
  } catch (err) {
    return onLimiterFailure("connectDB failed", err);
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowMs);

  // L2: a key that is already over its limit for the current window stays
  // limited until `expiresAt`, so there is nothing left to record. Looking
  // first means a flood of rejected requests costs a read instead of a
  // write per request (and cannot keep rewriting a document). The count
  // only ever grows inside a window, so this can't turn a limited caller
  // into an unlimited one; if the read fails we just fall through to the
  // normal atomic increment below. The increment stays the single source
  // of truth for requests that are not yet limited.
  try {
    const current = await RateLimitAttempt.findOne({ key }, { count: 1, expiresAt: 1 }).lean();
    if (current && current.expiresAt && current.expiresAt.getTime() > now.getTime() && current.count >= max) {
      return { limited: true, remaining: 0, retryAfterMs: Math.max(0, current.expiresAt.getTime() - now.getTime()) };
    }
  } catch (err) {
    console.error("[rateLimit] pre-check failed, continuing:", err);
  }

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
        return onLimiterFailure("retry after duplicate key failed", retryErr);
      }
    } else {
      return onLimiterFailure("check failed", err);
    }
  }

  const limited = doc.count > max;
  const retryAfterMs = limited ? Math.max(0, doc.expiresAt.getTime() - now.getTime()) : 0;
  return { limited, remaining: Math.max(0, max - doc.count), retryAfterMs, unavailable: false };
}

// Clears a counter outright. Used for "failed attempts" style counters
// (see the per-email-and-IP login key in lib/auth.js) so a successful
// sign-in doesn't leave the legitimate user's earlier typos counting
// against them. Best-effort: if it fails the counter simply expires on
// its own window, which is the safe direction.
export async function resetRateLimit(key) {
  if (!key) return;
  try {
    await connectDB();
    await RateLimitAttempt.deleteOne({ key });
  } catch (err) {
    console.error("[rateLimit] reset failed:", err);
  }
}
