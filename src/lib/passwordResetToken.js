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

// Atomically finds-and-deletes the matching, not-yet-expired token in a
// single document operation, so of any number of concurrent or replayed
// calls carrying the same raw token, at most one can ever succeed — every
// other one (including a genuine replay afterward, e.g. an email client
// prefetching the link) finds no matching document and falls through to
// null.
//
// Returns the bound userId (as a string) on success. Returns null for a
// missing, already-used, expired, or malformed token — every failure mode
// is deliberately indistinguishable to the caller, so the reset-password
// route can give one generic "invalid or expired" response for all of them
// without leaking which case it was.
export async function consumePasswordResetToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return null;

  await connectDB();
  const doc = await PasswordResetToken.findOneAndDelete({
    tokenHash: hashToken(rawToken),
    expiresAt: { $gt: new Date() },
  });
  return doc ? String(doc.userId) : null;
}
