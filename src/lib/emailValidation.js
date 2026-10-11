// Single source of truth for "is this a plausible email address?" (L1).
//
// Registration, the team "add member" form and the forgot-password /
// resend-verification endpoints all validate through isValidEmail() so an
// address is accepted or rejected the same way everywhere. Callers pass an
// address that has already been through normalizeEmail() (trimmed and
// lower-cased).
//
// Why not the old /^[^\s@]+@[^\s@]+\.[^\s@]+$/: it only excluded spaces and
// "@", so "a<b@c.com>", "x@y.com,z" and "\"a\"@b.com" all passed. Those are
// exactly the shapes that matter downstream, because the address ends up in
// email headers (To:) and HTML.
//
// This is deliberately a pragmatic check, not full RFC 5322:
//   - local part: RFC 5322 "atext" characters plus ".", no leading/trailing
//     or doubled dots, at most 64 characters. Quoted local parts, comments
//     and angle brackets are rejected (never used by real mailboxes, and
//     they are what makes an address ambiguous to header parsers).
//   - domain: dot-separated labels of letters, digits and hyphens (no
//     leading/trailing hyphen, at most 63 characters each), at least two
//     labels, and a top-level label of two or more characters that is not
//     purely numeric. IP-literal domains ("user@[1.2.3.4]") are rejected.
//   - Unicode letters/digits are accepted in both parts, so internationalized
//     addresses are not turned away; nodemailer converts the domain to
//     punycode when sending.
//   - at most 254 characters overall (the practical SMTP path limit).
// Delivery is only ever proven by the verification email, never by syntax.

export const EMAIL_MAX_LENGTH = 254;
const LOCAL_MAX_LENGTH = 64;

const LOCAL_CHAR = "[\\p{L}\\p{N}\\p{M}!#$%&'*+/=?^_`{|}~-]";
const LOCAL_RE = new RegExp(`^${LOCAL_CHAR}+(?:\\.${LOCAL_CHAR}+)*$`, "u");
const LABEL_RE = /^[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}-]{0,61}[\p{L}\p{N}\p{M}])?$/u;

export function isValidEmail(email) {
  if (typeof email !== "string" || email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;

  // Exactly one "@": a second one can only be inside a quoted local part.
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > LOCAL_MAX_LENGTH || !LOCAL_RE.test(local)) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => LABEL_RE.test(label))) return false;

  const tld = labels[labels.length - 1];
  return tld.length >= 2 && !/^\p{N}+$/u.test(tld);
}
