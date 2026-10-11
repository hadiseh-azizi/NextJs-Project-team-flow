import crypto from "crypto";
import { normalizeEmail } from "@/lib/normalizeEmail";

// L2: what an email address becomes inside a rate-limit key.
//
// The keys used to embed the submitted address verbatim, so a request could
// make the app store (and index) a document whose key was as large as the
// request body allowed. The key part is now the SHA-256 of the normalized
// address: fixed 32 characters whatever was sent, the same address (in any
// letter case / surrounding whitespace) always lands in the same bucket,
// different addresses never share one, and the database no longer holds a
// plaintext list of the addresses that were tried. The hash is only a
// bucket name - nothing is ever compared or reversed - so a fast hash is the
// right tool here.
export function emailRateLimitKey(email) {
  return crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);
}
