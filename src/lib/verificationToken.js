import jwt from "jsonwebtoken";

// Reuses NEXTAUTH_SECRET rather than requiring yet another env var — it's
// already a required secret for this app, and a JWT's `purpose` claim below
// keeps it from being confused with NextAuth's own session tokens.
const SECRET = process.env.NEXTAUTH_SECRET;

export function createVerificationToken(userId, email) {
  return jwt.sign({ userId, email, purpose: "email-verification" }, SECRET, { expiresIn: "24h" });
}

// Throws if the token is missing, expired, tampered with, or wasn't issued
// for email verification specifically.
export function verifyVerificationToken(token) {
  const payload = jwt.verify(token, SECRET);
  if (payload.purpose !== "email-verification") {
    throw new Error("Invalid token purpose");
  }
  return payload; // { userId, email }
}
