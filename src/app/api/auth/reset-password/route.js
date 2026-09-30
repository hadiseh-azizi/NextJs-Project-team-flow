import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { consumePasswordResetToken } from "@/lib/passwordResetToken";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

// Same bounds as registration (register/route.js) — bcrypt silently
// truncates at 72 bytes, and this is the same password field with the same
// requirements, just being set a different way.
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72;
const BCRYPT_COST = 12;

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
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: "Password is too long" }, { status: 400 });
  }

  await connectDB();

  // Single-use and atomic: of any number of concurrent requests carrying
  // the same token (including a genuine replay of an already-used link),
  // at most one can ever get a userId back — see
  // lib/passwordResetToken.js. Every failure mode (missing, malformed,
  // expired, already-used token) is deliberately indistinguishable here.
  const userId = await consumePasswordResetToken(token);
  if (!userId) {
    return invalidTokenResponse();
  }

  return withMongoErrorHandling(async () => {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    // The token is already consumed above regardless of what happens next,
    // so a user deleted between the reset request and this submission
    // (an edge case, not a normal flow) still gets the same generic
    // response as any other invalid token — it doesn't leak that the
    // account no longer exists.
    const user = await User.findByIdAndUpdate(userId, { $set: { passwordHash } });
    if (!user) {
      return invalidTokenResponse();
    }

    return NextResponse.json({ ok: true });
  });
}
