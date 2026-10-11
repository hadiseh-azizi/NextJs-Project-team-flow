import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/passwordHash";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { getAuthSecret } from "@/lib/authSecret";
import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";
import { emailRateLimitKey } from "@/lib/rateLimitKey";
import { isWithinPasswordByteLimit } from "@/lib/passwordPolicy";
import { getClientIp } from "@/lib/clientIp";
import { consumeAutoLoginToken } from "@/lib/autoLoginToken";
import { sessionCache, verifySessionToken } from "@/lib/sessionRevocationCache";

// A precomputed bcrypt hash of a fixed, unused string — never compared
// against a real password, and no real account uses it. Its only job is
// to give `bcrypt.compare()` something equally expensive to chew on when
// there's no matching user, so "no such account" and "wrong password"
// take the same amount of time. Without this, returning early on a
// missing user makes that branch measurably faster than a real
// comparison, which is enough of a timing signal for an attacker to
// enumerate which emails have accounts by measuring response time alone
// — a side channel unrelated to (and not fixed by) the resend/registration
// anti-enumeration behavior elsewhere in this app. Cost factor matches
// the one used for real password hashes (see register/route.js).
const DUMMY_PASSWORD_HASH = "$2a$12$umFwSnc/OJfL6r0Zcxv.3e6AudQMfHUgSwEHIkbrOu3qZtk/nN3WK";

// Login throttling (M3). The old design keyed the main limit on the
// attempted email alone, so anyone could lock a victim out just by
// submitting wrong passwords for the victim's address. Now three counters
// are checked in this order, and a request stopped by one never touches
// the ones after it:
//
//   1. IP (every attempt): stops one source spraying many accounts.
//   2. email + IP (failed attempts; cleared on success): the brute-force
//      limit for one account from one source. An attacker only ever
//      exhausts the budget for THEIR OWN address; the victim, coming from
//      a different IP, has a separate budget and keeps signing in.
//   3. email alone: a deliberately high backstop against a distributed
//      guesser rotating IPs. Because requests blocked by (1) or (2) never
//      reach it, an attacker needs many distinct IPs to move it at all.
//      If it does trip, the real owner can still use "Forgot password"
//      (not governed by this limiter) rather than waiting out the window.
//
// When the client IP can't be determined (RATE_LIMIT_TRUST_PROXY=none),
// (1) and (2) are impossible, so the previous email-only limit applies
// unchanged — see README. Counters are keyed by the submitted address
// whether or not an account exists, so none of this reveals which emails
// are registered.
const LOGIN_IP_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const LOGIN_EMAIL_IP_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };
const LOGIN_EMAIL_LIMIT = { max: 50, windowMs: 15 * 60 * 1000 };
const LOGIN_EMAIL_ONLY_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 }; // unknown-IP deployments

// The auto-login path (see the branch at the top of authorize() below)
// has no client-supplied email to key a limit on — by design, it never
// trusts one — so this is IP-only. A real auto-login token is 256 bits
// of randomness, not brute-forceable in any practical sense; this limit
// exists purely to cap how many wasted DB lookups one source can cause
// by hammering the endpoint with junk tokens, not because the token
// itself is guessable.
const AUTO_LOGIN_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

export const authOptions = {
  // A getter so NEXTAUTH_SECRET is checked when NextAuth reads its options
  // for a request (still fail-fast, never an empty secret) instead of when
  // this module is imported — `next build` imports it with no secret set.
  get secret() {
    return getAuthSecret();
  },
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Only ever sent by the verify-email page, immediately after a
        // successful first-time verification — see the branch at the
        // top of authorize() below. Mutually exclusive with email/
        // password: this is a distinct, single-use authorization, not a
        // second password.
        autoLoginToken: { label: "Auto Login Token", type: "text" },
      },
      // NextAuth passes a second `req` argument alongside the submitted
      // credentials — a plain `{ query, body, headers, method }` object,
      // not a Fetch `Request` — which is where the source IP comes from
      // for the per-IP rate limit below.
      async authorize(credentials, req) {
        // Automatic sign-in right after email verification: the
        // verify-email page calls signIn("credentials", { autoLoginToken })
        // with no email/password at all. This branch never trusts a
        // client-supplied email or user id — the only identity that
        // matters is whichever userId consumeAutoLoginToken() resolves
        // the (single-use, short-lived) token to server-side — so a
        // tampered request can authenticate at most the one account the
        // token was actually issued for, never an arbitrary other one.
        if (typeof credentials?.autoLoginToken === "string" && credentials.autoLoginToken) {
          const ip = getClientIp(req?.headers);

          await connectDB();

          const ipLimit = ip === "unknown" ? null : await checkRateLimit(`auto-login:ip:${ip}`, AUTO_LOGIN_IP_LIMIT);
          if (ipLimit?.limited) {
            throw new Error("TooManyAttempts");
          }

          const userId = await consumeAutoLoginToken(credentials.autoLoginToken);
          if (!userId) return null;

          const user = await User.findById(userId).lean();
          // Re-checks emailVerified even though createAutoLoginToken() is
          // only ever called right after the verify-email route just set
          // it — belt-and-braces against any future caller of
          // createAutoLoginToken() that doesn't make the same guarantee.
          if (!user || !user.emailVerified) return null;

          return { id: String(user._id), name: user.name, email: user.email, tokenVersion: user.tokenVersion ?? 0 };
        }

        if (typeof credentials?.email !== "string" || typeof credentials?.password !== "string") {
          return null;
        }
        if (!credentials.email || !credentials.password) return null;

        const email = normalizeEmail(credentials.email);
        const ip = getClientIp(req?.headers);

        await connectDB();

        // Checked before the database lookup and before any password
        // comparison — a caller that's already over the limit shouldn't
        // be able to keep using response timing or error shape to keep
        // probing. Thrown errors surface their message verbatim as the
        // `error` value on the client's signIn() result (see the
        // EmailNotVerified throw below), which is how the login page
        // tells this apart from "wrong password".
        // L2: the email only ever enters a key as a fixed-length digest, so
        // an oversized or odd-looking address can't bloat or shape a key.
        const emailKey = emailRateLimitKey(email);
        const pairKey = ip === "unknown" ? null : `login:pair:${emailKey}|${ip}`;
        if (ip === "unknown") {
          if ((await checkRateLimit(`login:email:${emailKey}`, LOGIN_EMAIL_ONLY_LIMIT)).limited) {
            throw new Error("TooManyAttempts");
          }
        } else {
          if ((await checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT)).limited) {
            throw new Error("TooManyAttempts");
          }
          if ((await checkRateLimit(pairKey, LOGIN_EMAIL_IP_LIMIT)).limited) {
            throw new Error("TooManyAttempts");
          }
          if ((await checkRateLimit(`login:email:${emailKey}`, LOGIN_EMAIL_LIMIT)).limited) {
            throw new Error("TooManyAttempts");
          }
        }

        const user = await User.findOne({ email }).lean();

        // Always run a real bcrypt comparison, even when there's no user
        // to compare against — see DUMMY_PASSWORD_HASH above for why.
        //
        // M5: a password over bcrypt's 72-byte limit can never be one this
        // app accepted at registration/reset, and bcrypt would silently
        // compare only its first 72 bytes. It is treated as simply wrong —
        // after the same dummy comparison, so timing doesn't change.
        const withinLimit = isWithinPasswordByteLimit(credentials.password);
        const valid = await verifyPassword(
          withinLimit ? credentials.password : "x",
          withinLimit && user?.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH
        );
        if (!user || !valid || !withinLimit) return null;

        // Correct password: the failed-attempt counter for this
        // email+IP starts over.
        if (pairKey) await resetRateLimit(pairKey);

        if (!user.emailVerified) {
          throw new Error("EmailNotVerified");
        }

        return { id: String(user._id), name: user.name, email: user.email, tokenVersion: user.tokenVersion ?? 0 };
      },
    }),
  ],
  callbacks: {
    // M2: sessions are stateless JWTs, so revocation has to be checked on
    // every use. At sign-in the user's current `tokenVersion` is stamped
    // into the token; on every later call (each getServerSession and each
    // /api/auth/session poll) it is compared with the user's current
    // version. A password reset or change bumps the field, so every token
    // issued before it stops matching. Throwing makes next-auth treat the
    // request as signed-out and clear the cookie. A token with no stamp
    // (issued before this check existed) is rejected too: accepting it
    // would let a pre-reset token outlive the reset.
    //
    // H1: the current version is read from a short-lived per-process cache
    // (lib/sessionRevocationCache.js) instead of a User.findById on every
    // call. The cache holds only successful lookups for at most 10 s, is
    // dropped immediately by the routes that bump the version / rename /
    // delete a user, and is never used to reject a token or to excuse a
    // database failure — a miss, an expired entry or a version mismatch
    // goes to the database, and a lookup that fails rejects the session
    // (fail closed). In another warm process a revoked token can therefore
    // be honoured for up to that TTL; see the file's header for the full
    // statement of the window.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tv = user.tokenVersion ?? 0;
        // authorize() just read these from the database, so the first
        // requests after sign-in need no lookup.
        sessionCache.set(String(user.id), { tokenVersion: user.tokenVersion ?? 0, name: user.name });
        return token;
      }
      const { name } = await verifySessionToken(token, async (id) => {
        await connectDB();
        return User.findById(id).select("tokenVersion name").lean();
      });
      // The display name is edited on the Account page; it comes from the
      // same (cached) read, so it stays current without a second query.
      if (name) token.name = name;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id;
      return session;
    },
  },
};
