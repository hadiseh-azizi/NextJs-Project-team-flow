import crypto from "crypto";

// M1 (account pre-hijacking) — binds an email-verification link to the
// browser that did the registering.
//
// The attack this exists for: someone registers a victim's address with a
// password they know. The victim gets the verification email, clicks it,
// and the account becomes verified — with the attacker's password on it.
//
// Registration therefore sets a random secret in a cookie on the
// registering browser, and the emailed verification token carries only the
// SHA-256 of that secret. When the link is opened:
//   - cookie present and matching -> the person who registered is the one
//     who controls the inbox: ordinary verification + auto sign-in.
//   - anything else (another browser/device, cookie expired, token with no
//     binding) -> the email is proven, but the password on the account
//     was NOT chosen by this person. verify-email/route.js then discards
//     that password and has them choose a new one before anything can
//     sign in.
// An attacker who pre-registered never holds the victim's inbox, and the
// victim never holds the attacker's cookie, so the attacker's password
// never survives a verification they didn't perform themselves.

export const REGISTRATION_BINDING_COOKIE = "tf_reg_bind";
// Same lifetime as the verification token itself (see verificationToken.js).
export const REGISTRATION_BINDING_MAX_AGE_SECONDS = 24 * 60 * 60;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createRegistrationBinding() {
  const secret = crypto.randomBytes(32).toString("base64url");
  return { secret, hash: sha256Hex(secret) };
}

// SameSite=Strict (not Lax): a cross-site page must not be able to make the
// victim's browser accept a binding cookie for an account the attacker
// registered. The cookie is still sent on the verify page's own same-origin
// fetch, which is the only place it is needed. Path is limited to the auth
// API so it isn't attached to every request.
export function registrationBindingCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: REGISTRATION_BINDING_MAX_AGE_SECONDS,
  };
}

// Works with both a Fetch `Headers` object and the minimal fake used by the
// manual tests (anything with .get()).
export function readBindingSecret(headers) {
  const raw = headers?.get?.("cookie");
  if (typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === REGISTRATION_BINDING_COOKIE) {
      const value = part.slice(idx + 1).trim();
      return value && value.length <= 128 ? value : null;
    }
  }
  return null;
}

export function bindingHashFromRequest(headers) {
  const secret = readBindingSecret(headers);
  return secret ? sha256Hex(secret) : null;
}

// Constant-time comparison of the hash the token carries against the hash
// of the secret this request presented.
export function bindingMatches(headers, tokenBindingHash) {
  if (typeof tokenBindingHash !== "string" || !tokenBindingHash) return false;
  const presented = bindingHashFromRequest(headers);
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(tokenBindingHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
