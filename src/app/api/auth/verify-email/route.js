import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { verifyVerificationToken } from "@/lib/verificationToken";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { isValidObjectId } from "@/lib/objectId";
import { createAutoLoginToken } from "@/lib/autoLoginToken";
import { createPasswordResetToken } from "@/lib/passwordResetToken";
import { bindingMatches } from "@/lib/registrationBinding";
import { hashPassword } from "@/lib/passwordHash";
import { invalidateSessionCache } from "@/lib/sessionRevocationCache";

function invalidTokenResponse() {
  return NextResponse.json({ error: "This verification link is invalid or has expired" }, { status: 400 });
}

export async function POST(req) {
  const body = await parseJsonBody(req);
  const token = body?.token;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyVerificationToken(token);
  } catch {
    return invalidTokenResponse();
  }

  // The token carries a userId straight from client input (albeit signed) —
  // validate its shape before it ever reaches Mongoose, or a malformed id
  // throws an uncaught CastError and this route 500s instead of 400ing.
  if (!isValidObjectId(payload.userId)) {
    return invalidTokenResponse();
  }

  await connectDB();

  const tokenEmail = normalizeEmail(payload.email);

  // M1 (account pre-hijacking) — see lib/registrationBinding.js for the
  // full reasoning. Did this link come back to the browser that registered
  // the account? Only then is it safe to treat the password on the account
  // as chosen by the person completing verification.
  const sameBrowserAsRegistration = bindingMatches(req.headers, payload.bind);

  // Otherwise the person completing verification has proven they own the
  // inbox, but the password on the account may have been set by someone
  // who registered *their* address. That password is discarded in the same
  // atomic write that marks the email verified — replaced by a hash of
  // random bytes nobody knows — so there is never a moment where the
  // account is verified and the pre-registrant's password still works.
  // (Hashed rather than a fixed marker string so a login attempt against
  // this account takes as long as against any other.)
  const replacementPasswordHash = sameBrowserAsRegistration
    ? null
    : await hashPassword(crypto.randomBytes(32).toString("hex"));

  // A single atomic find-and-update, rather than a separate findById +
  // manual field checks + save(): the lookup (matching on id, current
  // email, and current tokenVersion all at once) and the mutation
  // (flipping emailVerified, bumping tokenVersion) happen as one
  // document operation. That closes a real race — two requests carrying
  // the *same* token (e.g. an email client prefetching links, or a
  // double-submit) previously could both pass a separate "is this
  // already verified?" check before either had saved, and each would
  // independently set `tokenVersion = payload.tokenVersion + 1`; if both
  // saves landed, the net effect was tokenVersion advancing by only 1
  // instead of 2, quietly weakening the intended "each token works
  // exactly once" guarantee under concurrency. With the match condition
  // and the update in the same atomic operation, at most one of any
  // number of concurrent requests for the same token can ever match and
  // succeed — every other one (including a genuine replay afterward)
  // finds no document with that exact tokenVersion anymore and falls
  // through to the generic invalid-token response below.
  const user = await User.findOneAndUpdate(
    { _id: payload.userId, email: tokenEmail, tokenVersion: payload.tokenVersion },
    {
      $set: replacementPasswordHash
        ? { emailVerified: true, passwordHash: replacementPasswordHash }
        : { emailVerified: true },
      $inc: { tokenVersion: 1 },
    }
  );

  // Deliberately the same generic message for every failure mode here —
  // no such user, a token issued for an email the account no longer has,
  // or a tokenVersion that's already moved on (already used, or stale) —
  // so the response can't be used to tell these apart or enumerate
  // accounts.
  if (!user) {
    return invalidTokenResponse();
  }

  // H1: tokenVersion was just bumped; drop any cached copy of the old one.
  invalidateSessionCache(payload.userId);

  // Different browser (or no binding): no automatic sign-in. Hand back a
  // one-time password-setup token instead — it is the existing
  // password-reset token (single-use, 1 hour, hashed at rest), redeemed on
  // the existing reset-password page, so the person picks their own
  // password and then signs in normally. Best-effort like the auto-login
  // token below: if issuing it fails the email is still verified and
  // "Forgot password" reaches the same place.
  if (replacementPasswordHash) {
    let passwordResetToken = null;
    try {
      passwordResetToken = await createPasswordResetToken(user._id);
    } catch (err) {
      console.error("[auth/verify-email] Failed to create password setup token:", err);
    }
    return NextResponse.json({ ok: true, requiresPasswordSetup: true, passwordResetToken });
  }

  // Verification has already succeeded and is committed above — a
  // failure in this step is an auto-sign-in problem, not a verification
  // one, so it must not turn an already-successful verification into an
  // error response. Best-effort, same reasoning as the verification
  // emails elsewhere in this file's neighbors (register/resend): omit
  // autoLoginToken on failure rather than 500ing, and let the
  // verify-email page fall back to "please sign in manually".
  let autoLoginToken = null;
  try {
    autoLoginToken = await createAutoLoginToken(user._id);
  } catch (err) {
    console.error("[auth/verify-email] Failed to create auto-login token:", err);
  }

  return NextResponse.json({ ok: true, autoLoginToken });
}
