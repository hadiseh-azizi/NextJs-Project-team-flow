// The one password policy for the whole app. Registration, password reset
// and login all import from here so the rules can't drift apart, and the
// reset/register pages import it too so the browser and the server agree.
//
// Why bytes: bcrypt only ever reads the first 72 BYTES of its input and
// silently ignores the rest. JavaScript's `string.length` counts UTF-16
// code units, not bytes, so the old `length <= 72` check let through a
// 72-character CJK password (216 bytes) of which bcrypt used just the
// first 24 characters — the user believed they had a long password and
// had a short one. The limit is therefore enforced on the UTF-8 encoding,
// which is exactly what bcryptjs hashes. Over-long passwords are rejected
// with a message; nothing is ever truncated.
//
// Deliberately NOT done: Unicode normalization (NFC/NFKC). Existing hashes
// were made from the raw typed string, so normalizing now would lock out
// any existing user whose password isn't already in the normalized form.
// Passwords are compared byte-for-byte as typed.

export const PASSWORD_MIN_LENGTH = 6; // characters (code points), not UTF-16 units
export const PASSWORD_MAX_BYTES = 72; // bcrypt's hard input limit

export function passwordByteLength(password) {
  return new TextEncoder().encode(password).length;
}

// A lone surrogate is not valid Unicode: TextEncoder turns it into U+FFFD
// (3 bytes) while other encoders may differ, so the byte count — and what
// gets hashed — would be ambiguous. Reject it rather than guess.
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const PASSWORD_TOO_LONG_MESSAGE =
  `Password is too long. The limit is ${PASSWORD_MAX_BYTES} bytes, which is fewer characters if it contains non-Latin letters or emoji.`;

// Returns { value } or { error }, like the helpers in lib/validation.js.
export function validatePassword(password) {
  if (typeof password !== "string" || !password) return { error: "Password is required" };
  if (LONE_SURROGATE_RE.test(password)) return { error: "Password contains invalid characters" };
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) {
    return { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) return { error: PASSWORD_TOO_LONG_MESSAGE };
  return { value: password };
}

// Login only needs the upper bound: a submitted password longer than the
// limit can never be a password this app accepted (see the legacy note in
// README), and letting bcrypt compare it would silently truncate it.
export function isWithinPasswordByteLimit(password) {
  return typeof password === "string" && passwordByteLength(password) <= PASSWORD_MAX_BYTES;
}
