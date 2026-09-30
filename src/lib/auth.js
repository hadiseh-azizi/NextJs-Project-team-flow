import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { getAuthSecret } from "@/lib/authSecret";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { consumeAutoLoginToken } from "@/lib/autoLoginToken";

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

// Generous enough that a real user fumbling their password a few times
// never notices, tight enough to make automated credential stuffing
// impractical. Two keys: the attempted email (stops focused brute-forcing
// of one account regardless of source) and the source IP (stops one
// source spraying attempts across many accounts) — either one tripping
// blocks the attempt.
const LOGIN_EMAIL_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };
const LOGIN_IP_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };

// The auto-login path (see the branch at the top of authorize() below)
// has no client-supplied email to key a limit on — by design, it never
// trusts one — so this is IP-only. A real auto-login token is 256 bits
// of randomness, not brute-forceable in any practical sense; this limit
// exists purely to cap how many wasted DB lookups one source can cause
// by hammering the endpoint with junk tokens, not because the token
// itself is guessable.
const AUTO_LOGIN_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

export const authOptions = {
  secret: getAuthSecret(),
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

          return { id: String(user._id), name: user.name, email: user.email };
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
        const emailLimit = await checkRateLimit(`login:email:${email}`, LOGIN_EMAIL_LIMIT);
        const ipLimit = ip === "unknown" ? null : await checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT);
        if (emailLimit.limited || ipLimit?.limited) {
          throw new Error("TooManyAttempts");
        }

        const user = await User.findOne({ email }).lean();

        // Always run a real bcrypt comparison, even when there's no user
        // to compare against — see DUMMY_PASSWORD_HASH above for why.
        const valid = await bcrypt.compare(credentials.password, user?.passwordHash || DUMMY_PASSWORD_HASH);
        if (!user || !valid) return null;

        if (!user.emailVerified) {
          throw new Error("EmailNotVerified");
        }

        return { id: String(user._id), name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id;
      return session;
    },
  },
};
