// NEXTAUTH_SECRET signs both NextAuth's session JWTs and our own
// email-verification tokens. Mirrors the fail-fast pattern in
// src/lib/mongodb.js: better to crash on startup with a clear message than
// to let jsonwebtoken silently sign/verify tokens with an empty secret.
export function getAuthSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not set — copy .env.example to .env and fill it in");
  }
  return secret;
}
