import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { createVerificationToken } from "@/lib/verificationToken";
import { sendVerificationEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { withOptionalTransaction } from "@/lib/mongoTransaction";

// Loose but real email shape check — not full RFC 5322, just enough to
// reject obviously-malformed input before it reaches the database.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
// bcrypt silently truncates at 72 bytes, so anything longer doesn't add
// real strength and would just be misleading to accept.
const MAX_PASSWORD_LENGTH = 72;
// bcrypt's own recommended minimum as of this writing; also matches the
// dummy hash used for timing-safe login in lib/auth.js.
const BCRYPT_COST = 12;

// Registration has no per-account identity to key a limit on until after
// it succeeds, so this is IP-only. It also doubles as the mitigation for
// the account-enumeration note below: the existing-email 409 does confirm
// whether an address is registered, but capping how many registration
// attempts one source can make caps how many addresses they can check.
const REGISTER_IP_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

// getClientIp() returns "unknown" both when a single request just didn't
// carry the header and when RATE_LIMIT_TRUST_PROXY=none makes the app
// treat the header as untrustworthy for every request (see
// clientIp.js). Because this endpoint has no other identity to fall back
// on, silently skipping the limit whenever the IP is "unknown" would mean
// a deployment with RATE_LIMIT_TRUST_PROXY=none has NO registration rate
// limiting at all — exactly the "fallback silently disables rate
// limiting" failure this is written to avoid. Instead, every request
// with an unknown IP shares one bucket: a real user only ever needs one
// or two registration attempts, so this still stops unattended bulk
// registration/enumeration, at the cost of legitimate concurrent
// registrations from different untrackable clients being able to
// collide into the same bucket. That trade-off only matters on a
// deployment where the real per-client IP genuinely can't be
// determined — see FINAL_RELEASE_CLEANUP.md.
const REGISTER_FALLBACK_LIMIT = { max: 100, windowMs: 60 * 60 * 1000 };

export async function POST(req) {
  const ip = getClientIp(req.headers);
  const rateLimitKey = ip !== "unknown" ? `register:ip:${ip}` : "register:no-ip-fallback";
  const rateLimitConfig = ip !== "unknown" ? REGISTER_IP_LIMIT : REGISTER_FALLBACK_LIMIT;
  {
    const { limited, retryAfterMs } = await checkRateLimit(rateLimitKey, rateLimitConfig);
    if (limited) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }
  }

  const body = await parseJsonBody(req);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { name, email, password } = body;

  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  const trimmedName = name.trim();
  const normalizedEmail = normalizeEmail(email);

  if (!trimmedName || !normalizedEmail || !password) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Name is too long" }, { status: 400 });
  }
  if (normalizedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(normalizedEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: "Password is too long" }, { status: 400 });
  }

  await connectDB();

  // Deliberately still discloses that the address is taken (see
  // AUTH_SECURITY_AUDIT.md, "Account enumeration" — kept as-is rather
  // than silently accepting a duplicate signup or sending a "someone
  // tried to register your email" notice instead, both of which are
  // worse UX for a negligible enumeration-risk reduction). The IP rate
  // limit above is what caps how many addresses one source can check
  // this way.
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) {
    return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  return withMongoErrorHandling(async () => {
    // User creation and invitation consumption must succeed or fail
    // together: if the account were created outside this transaction and
    // the invitation step then failed, the email would be "taken" by a
    // half-onboarded account with no team membership and no way to retry
    // (registration would just reject it as a duplicate). Putting the
    // create() inside the same transaction as the Team/Invitation writes
    // means a failure anywhere in this block rolls back the user too, so
    // the only two outcomes are "fully registered" and "not registered at
    // all". Only non-expired invitations grant membership — an invitation
    // that's aged out shouldn't silently add someone to a team months
    // later — but when at least one active invitation exists, every
    // invitation for this email (expired or not) is still cleared so
    // stale records don't linger. This mirrors the session.withTransaction
    // pattern already used in the projects and team-members routes.
    //
    // Note on retries: the MongoDB driver may re-run this callback on a
    // transient transaction error (e.g. a replica set stepdown mid-commit).
    // Every operation below is a plain DB write scoped to `session`, so a
    // retried attempt starts from a clean, uncommitted slate rather than
    // double-applying anything. Nothing with an external side effect
    // (hashing, token generation, email) happens inside this callback.
    //
    // Uses withOptionalTransaction (see lib/mongoTransaction.js) instead of
    // a raw mongoose.startSession()/session.withTransaction() pair — the
    // raw form throws outright on a standalone (non-replica-set) MongoDB
    // instead of falling back to an unsessioned write, which contradicted
    // what README.md documents for this exact operation. The fallback is
    // safe for the same reason the retry note above holds: User.create
    // plus the two invitation writes are a one-shot sequence with no
    // external side effects, so running them without a session in the
    // worst case leaves an account created without its team memberships
    // applied — recoverable by re-sending the invite — rather than any
    // double-write or corruption.
    let user;
    try {
      user = await withOptionalTransaction(async (session) => {
        const [created] = await User.create(
          [{ name: trimmedName, email: normalizedEmail, passwordHash, emailVerified: false }],
          { session: session ?? undefined }
        );

        const invitations = await Invitation.find({
          email: normalizedEmail,
          expiresAt: { $gt: new Date() },
        })
          .session(session ?? null)
          .lean();

        if (invitations.length > 0) {
          await Team.updateMany(
            { _id: { $in: invitations.map((i) => i.team) } },
            { $addToSet: { members: created._id } },
            { session: session ?? undefined }
          );
          await Invitation.deleteMany({ email: normalizedEmail }, { session: session ?? undefined });
        }

        return created;
      });
    } catch (err) {
      // Guards against a race between the findOne check above and this
      // create() — the unique index is the real source of truth. A
      // duplicate-key error aborts the transaction (nothing is
      // committed), so there's no cleanup to do here beyond reporting it.
      if (err?.code === 11000) {
        return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
      }
      throw err;
    }

    // The account exists but can't sign in yet — confirming this email is
    // what proves it's really them. Sending is best-effort: the account is
    // already committed above, so a transient SMTP failure here shouldn't
    // turn an already-successful registration into a 500 (the client would
    // see a failure for an account that actually exists, and "resend
    // verification" already covers getting them a working link).
    const token = createVerificationToken(String(user._id), user.email, user.tokenVersion);
    try {
      await sendVerificationEmail({ to: user.email, name: user.name, token });
    } catch (err) {
      console.error("[auth/register] Failed to send verification email:", err);
    }

    return NextResponse.json({ id: String(user._id), email: user.email, requiresVerification: true }, { status: 201 });
  });
}
