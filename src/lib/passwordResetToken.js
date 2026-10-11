import crypto from "crypto";
import { connectDB } from "@/lib/mongodb";
import PasswordResetToken from "@/models/PasswordResetToken";

// Long enough that a real person can receive the email, switch apps/tabs,
// and come back to it without the link dying on them; short enough that a
// link sitting unread in an inbox (or a shared/forwarded inbox) stops being
// useful reasonably quickly. This app's other short-lived token
// (AutoLoginToken) bridges an instant same-request handoff and is measured
// in minutes for that reason — a reset link is a different case, since it's
// mailed out and clicked later, so it gets a longer, but still short,
// window.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Issues a one-time password-reset authorization for `userId`. Only the raw
// token (returned here, never persisted) can be redeemed; the database only
// ever holds its hash — see PasswordResetToken.js for why.
//
// Any reset token(s) already outstanding for this user are deleted first,
// so requesting a new reset link immediately invalidates an older one that
// might still be sitting in an inbox — at most one reset link is ever live
// for a given account at a time.
export async function createPasswordResetToken(userId) {
  await connectDB();
  await PasswordResetToken.deleteMany({ userId });

  const rawToken = crypto.randomBytes(32).toString("hex");
  await PasswordResetToken.create({
    tokenHash: hashToken(rawToken),
    userId,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  return rawToken;
}

// Read-only check: is there a live (existing, unexpired) token for this raw
// value? Deletes nothing. The reset route uses it to refuse junk tokens
// before spending ~250ms hashing a password for them; it is NOT what makes
// a token single-use - takePasswordResetToken() below is, and it
// re-checks atomically.
export async function peekPasswordResetToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return false;
  await connectDB();
  const doc = await PasswordResetToken.findOne({
    tokenHash: hashToken(rawToken),
    expiresAt: { $gt: new Date() },
  })
    .select("_id")
    .lean();
  return Boolean(doc);
}

// Atomically finds-and-deletes the matching, not-yet-expired token in a
// single document operation, so of any number of concurrent or replayed
// calls carrying the same raw token, at most one can ever succeed - every
// other one (including a genuine replay afterward, e.g. an email client
// prefetching the link) finds no matching document and falls through to
// null.
//
// L7: this is meant to be called inside the same transaction as the
// password write (pass its `session`), so the delete and the write commit
// together - if the write fails the transaction aborts and the token is
// still there. Without a session (standalone MongoDB) it behaves as
// before, and the caller restores the token on failure with
// restorePasswordResetToken().
//
// Returns { userId, tokenHash, expiresAt } on success (userId as a
// string; the extra fields exist so the token can be restored exactly). Returns null for a missing, already-used, expired, or malformed
// token - every failure mode is deliberately indistinguishable to the
// caller, so the reset-password route can give one generic "invalid or
// expired" response for all of them without leaking which case it was.
export async function takePasswordResetToken(rawToken, { session } = {}) {
  if (typeof rawToken !== "string" || !rawToken) return null;

  await connectDB();
  const query = PasswordResetToken.findOneAndDelete({
    tokenHash: hashToken(rawToken),
    expiresAt: { $gt: new Date() },
  });
  const doc = await (session ? query.session(session) : query);
  if (!doc) return null;
  return { userId: String(doc.userId), tokenHash: doc.tokenHash, expiresAt: doc.expiresAt };
}

// Same operation, returning just the bound userId (or null) - the original
// contract, kept for callers that only need to know who the token was for.
export async function consumePasswordResetToken(rawToken, options) {
  const taken = await takePasswordResetToken(rawToken, options);
  return taken ? taken.userId : null;
}

// Compensation for the no-transaction fallback only: puts back a token
// that takePasswordResetToken() just removed because the password write
// that was supposed to follow it failed. Same hash and expiry, so the
// link is exactly as valid as before. Best-effort - if even this fails the
// user simply requests a new link.
export async function restorePasswordResetToken({ userId, tokenHash, expiresAt }) {
  try {
    await connectDB();
    await PasswordResetToken.create({ userId, tokenHash, expiresAt });
  } catch (err) {
    console.error("[passwordResetToken] could not restore token after failed reset:", err);
  }
}
