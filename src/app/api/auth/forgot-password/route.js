import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { createPasswordResetToken } from "@/lib/passwordResetToken";
import { sendPasswordResetEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { isValidEmail } from "@/lib/emailValidation";
import { emailRateLimitKey } from "@/lib/rateLimitKey";
import { runAfterResponse } from "@/lib/deferWork";

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
  // L1/L2: one shared validator, and nothing malformed or oversized ever
  // gets as far as a rate-limit key or a database query. This only says
  // something about the *shape* of what was typed, never about accounts.
  if (!isValidEmail(normalizedEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
  }
  const ip = getClientIp(req.headers);

  // Rate-limited regardless of whether an account exists, and always the
  // same {ok:true} response (see the bottom) - a different response for
  // "rate limited" vs "sent" would itself leak account existence.
  //
  // L2: the source IP is checked first and a request it already limits
  // stops there, so one limited source can't keep minting a new per-email
  // counter for every address it throws at the endpoint. The email counter
  // is keyed on a digest of the address (lib/rateLimitKey.js).
  const ipLimit = ip === "unknown" ? null : await checkRateLimit(`forgot-password:ip:${ip}`, FORGOT_PASSWORD_IP_LIMIT);
  const emailLimit = ipLimit?.limited
    ? null
    : await checkRateLimit(`forgot-password:email:${emailRateLimitKey(normalizedEmail)}`, FORGOT_PASSWORD_EMAIL_LIMIT);
  const limited = Boolean(ipLimit?.limited || emailLimit?.limited);

  if (!limited) {
    // L3: the account lookup, token write and SMTP send only happen for
    // real accounts, and the send is by far the slowest step - doing them
    // before responding made "this address exists" measurable from the
    // outside. They now run after the response is sent, so every request
    // that gets this far takes the same time to answer. Nothing is sent
    // for an address without an account; same generic reply either way.
    await runAfterResponse(async () => {
      await connectDB();
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) return;
      const token = await createPasswordResetToken(user._id);
      try {
        await sendPasswordResetEmail({ to: user.email, name: user.name, token });
      } catch (err) {
        console.error("[auth/forgot-password] Failed to send password reset email:", err);
      }
    }, "auth/forgot-password");
  }

  return NextResponse.json({ ok: true });
}
