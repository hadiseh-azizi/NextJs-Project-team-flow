import jwt from "jsonwebtoken";
import { getAuthSecret } from "@/lib/authSecret";

// L6: the only algorithm Team Flow signs these with is HS256 (the secret is
// a shared string, so it is an HMAC). Verification names it explicitly
// instead of trusting whatever the token header claims, which closes off
// "alg" downgrade/confusion tricks.
const JWT_ALGORITHM = "HS256";

// Reuses NEXTAUTH_SECRET rather than requiring yet another env var — it's
// already a required secret for this app, and a JWT's `purpose` claim below
// keeps it from being confused with NextAuth's own session tokens.
// The secret is read when a token is signed or verified, not at import, so
// merely importing this module (e.g. during `next build`) needs no secret.

// `tokenVersion` should be the user's current User.tokenVersion at the time
// the token is issued. Verifying it against the user's live value is what
// lets us reject a token that's already been used (see verify-email route).
//
// `bindingHash` (optional) is the SHA-256 of the registering browser's
// binding secret — see lib/registrationBinding.js. A token without one is
// still valid for verifying the email, but can never trigger automatic
// sign-in (verify-email/route.js).
export function createVerificationToken(userId, email, tokenVersion, bindingHash) {
  const claims = { userId, email, tokenVersion, purpose: "email-verification" };
  if (bindingHash) claims.bind = bindingHash;
  return jwt.sign(claims, getAuthSecret(), { algorithm: JWT_ALGORITHM, expiresIn: "24h" });
}

// Throws if the token is missing, malformed, expired, tampered with, or
// wasn't issued for email verification specifically.
export function verifyVerificationToken(token) {
  if (typeof token !== "string" || !token) {
    throw new Error("Invalid token");
  }
  const payload = jwt.verify(token, getAuthSecret(), { algorithms: [JWT_ALGORITHM] });
  if (payload.purpose !== "email-verification") {
    throw new Error("Invalid token purpose");
  }
  if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
    throw new Error("Malformed token payload");
  }
  if (payload.bind !== undefined && typeof payload.bind !== "string") {
    throw new Error("Malformed token payload");
  }
  return payload; // { userId, email, tokenVersion, bind? }
}
