import jwt from "jsonwebtoken";
import { getAuthSecret } from "@/lib/authSecret";

// Reuses NEXTAUTH_SECRET rather than requiring yet another env var — it's
// already a required secret for this app, and a JWT's `purpose` claim below
// keeps it from being confused with NextAuth's own session tokens.
const SECRET = getAuthSecret();

// `tokenVersion` should be the user's current User.tokenVersion at the time
// the token is issued. Verifying it against the user's live value is what
// lets us reject a token that's already been used (see verify-email route).
export function createVerificationToken(userId, email, tokenVersion) {
  return jwt.sign({ userId, email, tokenVersion, purpose: "email-verification" }, SECRET, { expiresIn: "24h" });
}

// Throws if the token is missing, malformed, expired, tampered with, or
// wasn't issued for email verification specifically.
export function verifyVerificationToken(token) {
  if (typeof token !== "string" || !token) {
    throw new Error("Invalid token");
  }
  const payload = jwt.verify(token, SECRET);
  if (payload.purpose !== "email-verification") {
    throw new Error("Invalid token purpose");
  }
  if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
    throw new Error("Malformed token payload");
  }
  return payload; // { userId, email, tokenVersion }
}
