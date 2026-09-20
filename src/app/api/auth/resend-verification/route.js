import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { createVerificationToken } from "@/lib/verificationToken";
import { sendVerificationEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

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
  const ip = getClientIp(req.headers);

  // Rate-limited on the normalized email regardless of whether an account
  // exists for it, and always returns the same {ok:true} shape either
  // way — otherwise a difference in response (including a different
  // status code for "rate limited" vs "sent") would itself leak account
  // existence. Both checks always run (no short-circuit) so the response
  // shape/timing doesn't depend on which limit — if either — was hit.
  const [emailLimit, ipLimit] = await Promise.all([
    checkRateLimit(`resend:email:${normalizedEmail}`, RESEND_EMAIL_LIMIT),
    ip === "unknown" ? null : checkRateLimit(`resend:ip:${ip}`, RESEND_IP_LIMIT),
  ]);
  const limited = emailLimit.limited || ipLimit?.limited;

  if (!limited) {
    await connectDB();
    const user = await User.findOne({ email: normalizedEmail });

    // Always respond the same way whether or not the account exists (and
    // whether or not it's already verified) — this avoids leaking which
    // emails have accounts on this app.
    if (user && !user.emailVerified) {
      const token = createVerificationToken(String(user._id), user.email, user.tokenVersion);
      // Best-effort, same as the invite email: a transient SMTP failure
      // shouldn't surface as a 500 (which would also break the
      // anti-enumeration guarantee below by responding differently).
      try {
        await sendVerificationEmail({ to: user.email, name: user.name, token });
      } catch (err) {
        console.error("[auth/resend-verification] Failed to send verification email:", err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
