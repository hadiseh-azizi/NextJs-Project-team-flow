import crypto from "crypto";

// 24 random bytes (192 bits) encoded as URL-safe base64 — far beyond any
// realistic brute-force range for a bearer-style read-only link, and
// short enough to sit cleanly in a URL path segment with no escaping
// (base64url has no `+`, `/`, or `=`). See models/Project.js for why this
// token is stored as plain text rather than hashed.
export function generateShareToken() {
  return crypto.randomBytes(24).toString("base64url");
}
