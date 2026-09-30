import crypto from "crypto";
import { connectDB } from "@/lib/mongodb";
import AutoLoginToken from "@/models/AutoLoginToken";

// Short enough that this only ever bridges "verification just succeeded"
// to the verify-email page's own immediate signIn() call, never a
// standing credential — the whole round trip normally completes client-
// side in well under a second. Generous enough to tolerate real-world
// network latency without the legitimate case failing.
const AUTO_LOGIN_TOKEN_TTL_MS = 2 * 60 * 1000;

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Issues a one-time auto-login authorization for `userId`. Only the raw
// token (returned here, never persisted) can be redeemed; the database
// only ever holds its hash, so a database read alone — a backup, a
// replica, a leaked query result — can't be replayed as a working
// token, the same reasoning as password hashing.
export async function createAutoLoginToken(userId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await connectDB();
  await AutoLoginToken.create({
    tokenHash: hashToken(rawToken),
    userId,
    expiresAt: new Date(Date.now() + AUTO_LOGIN_TOKEN_TTL_MS),
  });
  return rawToken;
}

// Atomically finds-and-deletes the matching, not-yet-expired token in a
// single document operation, so of any number of concurrent or replayed
// calls carrying the same raw token, at most one can ever succeed — every
// other one (including a genuine replay afterward) finds no matching
// document and falls through to null. Mirrors the single-use guarantee
// verify-email's own tokenVersion match gives the verification token
// itself (see verify-email/route.js).
//
// Returns the bound userId (as a string) on success. Returns null for a
// missing, already-used, expired, or malformed token — every failure
// mode is deliberately indistinguishable to the caller, the same
// generic-failure convention verify-email's own invalidTokenResponse()
// and login's authorize() already use elsewhere in this app.
export async function consumeAutoLoginToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return null;

  await connectDB();
  const doc = await AutoLoginToken.findOneAndDelete({
    tokenHash: hashToken(rawToken),
    expiresAt: { $gt: new Date() },
  });
  return doc ? String(doc.userId) : null;
}
