import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { createPasswordResetToken } from "@/lib/passwordResetToken";
import { sendPasswordResetEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

// Same shape and reasoning as resend-verification's limits (see
// resend-verification/route.js): per-email caps how many reset emails one
// address can be sent in a window; per-IP caps how many addresses one
// source can probe/spam through this endpoint. Neither limit is ever
// revealed in the response — see below.
const FORGOT_PASSWORD_EMAIL_LIMIT = { max: 3, windowMs: 10 * 60 * 1000 };
const FORGOT_PASSWORD_IP_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

export async function POST(req) {
  const body = await parseJsonBody(req);
  const email = body?.email;
  if (typeof email !== "string" || !email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  const ip = getClientIp(req.headers);

  // Rate-limited on the normalized email regardless of whether an account
  // exists for it, and always returns the same {ok:true} shape either way
  // (see the generic response at the bottom) — otherwise a different
  // response for "rate limited" vs "sent" would itself leak account
  // existence. Both checks always run (no short-circuit) so the response
  // shape/timing doesn't depend on which limit — if either — was hit. This
  // mirrors resend-verification/route.js exactly.
  const [emailLimit, ipLimit] = await Promise.all([
    checkRateLimit(`forgot-password:email:${normalizedEmail}`, FORGOT_PASSWORD_EMAIL_LIMIT),
    ip === "unknown" ? null : checkRateLimit(`forgot-password:ip:${ip}`, FORGOT_PASSWORD_IP_LIMIT),
  ]);
  const limited = emailLimit.limited || ipLimit?.limited;

  if (!limited) {
    await connectDB();
    const user = await User.findOne({ email: normalizedEmail });

    // Never reveal whether the account exists: the same generic response
    // is returned whether or not a user was found, and whether or not
    // sending the email succeeds (see the best-effort try/catch below).
    if (user) {
      const token = await createPasswordResetToken(user._id);
      try {
        await sendPasswordResetEmail({ to: user.email, name: user.name, token });
      } catch (err) {
        console.error("[auth/forgot-password] Failed to send password reset email:", err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
