import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { takePasswordResetToken, peekPasswordResetToken, restorePasswordResetToken } from "@/lib/passwordResetToken";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { validatePassword } from "@/lib/passwordPolicy";
import { hashPassword } from "@/lib/passwordHash";
import { invalidateSessionCache } from "@/lib/sessionRevocationCache";

// Password rules live in lib/passwordPolicy.js, shared with registration
// and login, so reset can never accept something registration wouldn't.

// The reset token itself is 256 bits of randomness — not brute-forceable —
// so, same reasoning as AUTO_LOGIN_IP_LIMIT in lib/auth.js, this exists
// purely to cap how many wasted DB lookups one source can cause by
// hammering the endpoint with junk tokens, not because the token is
// guessable.
const RESET_PASSWORD_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function invalidTokenResponse() {
  return NextResponse.json(
    { error: "This password reset link is invalid or has expired" },
    { status: 400 }
  );
}

export async function POST(req) {
  const ip = getClientIp(req.headers);
  if (ip !== "unknown") {
    const { limited, retryAfterMs } = await checkRateLimit(`reset-password:ip:${ip}`, RESET_PASSWORD_IP_LIMIT);
    if (limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }
  }

  const body = await parseJsonBody(req);
  const token = body?.token;
  const password = body?.password;
  const confirmPassword = body?.confirmPassword;

  if (typeof token !== "string" || !token) {
    return invalidTokenResponse();
  }
  if (typeof password !== "string" || typeof confirmPassword !== "string" || !password || !confirmPassword) {
    return NextResponse.json({ error: "Please fill in both password fields" }, { status: 400 });
  }
  // Re-validated here even though the reset-password page already checks
  // this client-side — every route in this app validates its own input
  // server-side rather than trusting the client to have done it.
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }
  const passwordResult = validatePassword(password);
  if (passwordResult.error) {
    return NextResponse.json({ error: passwordResult.error }, { status: 400 });
  }

  await connectDB();

  // L7: nothing irreversible happens until the new password is stored.
  //   1. Cheap read-only check, so junk tokens never cost a bcrypt hash.
  //   2. Hash the password (the slow step, kept outside the transaction).
  //   3. In ONE transaction: delete the token (atomic find-and-delete, so
  //      of any number of concurrent submissions at most one gets it) and
  //      write the password. If hashing, the delete or the write fails, the
  //      transaction aborts and the token is still valid for a retry.
  // Every failure to find a usable token gives the same generic response.
  if (!(await peekPasswordResetToken(token))) {
    return invalidTokenResponse();
  }

  return withMongoErrorHandling(async () => {
    const passwordHash = await hashPassword(password);

    let resetUserId = null;
    const outcome = await withOptionalTransaction(async (session) => {
      const consumed = await takePasswordResetToken(token, { session });
      if (!consumed) return "invalid";
      resetUserId = consumed.userId;

      // M2: bumping tokenVersion revokes every session issued before this
      // reset (auth.js's jwt callback compares it on every request) and
      // retires any verification link emailed before it.
      let user;
      try {
        user = await User.findByIdAndUpdate(
          consumed.userId,
          { $set: { passwordHash }, $inc: { tokenVersion: 1 } },
          session ? { session } : undefined
        );
      } catch (err) {
        // With a transaction the abort already restores the token. Without
        // one (standalone MongoDB) it has to be put back by hand.
        if (!session) await restorePasswordResetToken(consumed);
        throw err;
      }
      // A user deleted since the link was requested: the token is spent
      // and the response is the same generic one, so it doesn't reveal
      // that the account no longer exists.
      return user ? "ok" : "invalid";
    });

    // H1: the version bump above is what revokes older sessions; drop this
    // process's cached copy now that it has committed, so revocation here is
    // immediate rather than waiting out the cache TTL.
    if (outcome === "ok") invalidateSessionCache(resetUserId);

    return outcome === "ok" ? NextResponse.json({ ok: true }) : invalidTokenResponse();
  });
}
