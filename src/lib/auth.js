import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { getAuthSecret } from "@/lib/authSecret";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

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
      },
      // NextAuth passes a second `req` argument alongside the submitted
      // credentials — a plain `{ query, body, headers, method }` object,
      // not a Fetch `Request` — which is where the source IP comes from
      // for the per-IP rate limit below.
      async authorize(credentials, req) {
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
