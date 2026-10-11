import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { createVerificationToken } from "@/lib/verificationToken";
import { sendVerificationEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { bindingHashFromRequest } from "@/lib/registrationBinding";
import { isValidEmail } from "@/lib/emailValidation";
import { emailRateLimitKey } from "@/lib/rateLimitKey";
import { runAfterResponse } from "@/lib/deferWork";

// Per-email: roughly one resend every couple of minutes, generous enough
// that a real user who missed the email or mistyped it isn't blocked from
// trying again shortly after. Per-IP: a much looser cap whose only job is
// to stop one source from using this endpoint to blast email to a large
// number of addresses (it can't be used to determine which of those
// addresses are real — see the identical {ok:true} response below — but
// nothing stops it from still costing this app's SMTP sender reputation
// if left uncapped).
const RESEND_EMAIL_LIMIT = { max: 3, windowMs: 10 * 60 * 1000 };
const RESEND_IP_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

export async function POST(req) {
  const body = await parseJsonBody(req);
  const email = body?.email;
  if (typeof email !== "string" || !email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  // L1/L2: shared validator; malformed or oversized input is turned away
  // before it can become a rate-limit key or a query. Shape only - this
  // says nothing about whether an account exists.
  if (!isValidEmail(normalizedEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
  }
  const ip = getClientIp(req.headers);

  // Rate-limited regardless of whether an account exists, and always the
  // same {ok:true} response - a different response (including a different
  // status for "rate limited" vs "sent") would itself leak account
  // existence. L2: IP first, and a request the IP limit already stops never
  // creates a per-email counter; email keys are digests (lib/rateLimitKey.js).
  const ipLimit = ip === "unknown" ? null : await checkRateLimit(`resend:ip:${ip}`, RESEND_IP_LIMIT);
  const emailLimit = ipLimit?.limited
    ? null
    : await checkRateLimit(`resend:email:${emailRateLimitKey(normalizedEmail)}`, RESEND_EMAIL_LIMIT);
  const limited = Boolean(ipLimit?.limited || emailLimit?.limited);

  if (!limited) {
    // Read now: the deferred task below runs after the response.
    const bindingHash = bindingHashFromRequest(req.headers);

    // L3: lookup, token and SMTP send run after the response so the time
    // taken doesn't depend on whether the account exists (or is already
    // verified). Same {ok:true} in every case. A request from a browser
    // that carries the registration binding (lib/registrationBinding.js)
    // lets only that browser auto-sign-in from the link.
    await runAfterResponse(async () => {
      await connectDB();
      const user = await User.findOne({ email: normalizedEmail });
      if (!user || user.emailVerified) return;
      const token = createVerificationToken(String(user._id), user.email, user.tokenVersion, bindingHash);
      // Best-effort, same as the invite email.
      try {
        await sendVerificationEmail({ to: user.email, name: user.name, token });
      } catch (err) {
        console.error("[auth/resend-verification] Failed to send verification email:", err);
      }
    }, "auth/resend-verification");
  }

  return NextResponse.json({ ok: true });
}
