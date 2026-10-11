import { NextResponse } from "next/server";
import User from "@/models/User";
import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";
import { isWithinPasswordByteLimit } from "@/lib/passwordPolicy";
import { verifyPassword } from "@/lib/passwordHash";

// Re-checks the signed-in user's CURRENT password before a sensitive account
// change (new password, account deletion). A session alone isn't enough for
// those: whoever is at an unlocked laptop or holds a stolen cookie shouldn't
// be able to lock the owner out or erase the account.
//
// Because a session makes this endpoint a password-guessing oracle, wrong
// attempts are limited per user. The key is the account, not the IP, so it
// holds when the IP can't be determined. A correct password clears the
// counter. The limit is shared by every route that calls this.
const CURRENT_PASSWORD_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

const rateKey = (userId) => `account-password:user:${userId}`;

// Returns `{ user }` (the lean user document) when the password is right, or
// `{ response }` (a ready NextResponse) when it isn't, the account is gone, or
// the caller is over the limit.
export async function requireCurrentPassword(userId, password) {
  if (typeof password !== "string" || !password) {
    return { response: NextResponse.json({ error: "Enter your current password" }, { status: 400 }) };
  }

  const { limited, retryAfterMs } = await checkRateLimit(rateKey(userId), CURRENT_PASSWORD_LIMIT);
  if (limited) {
    return {
      response: NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      ),
    };
  }

  const user = await User.findById(userId).lean();
  // Unreachable through a valid session (the jwt callback already rejects a
  // deleted user), but never assume it.
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };

  // Same rule as login: over bcrypt's 72-byte limit can never be a password
  // this app accepted, and bcrypt would compare only a prefix of it.
  const valid = isWithinPasswordByteLimit(password) && (await verifyPassword(password, user.passwordHash));
  if (!valid) return { response: NextResponse.json({ error: "Current password is incorrect" }, { status: 400 }) };

  await resetRateLimit(rateKey(userId));
  return { user };
}
