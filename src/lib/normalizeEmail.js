// Single source of truth for turning a user-supplied email into the form
// we store/query by. Registration, login, verification, and
// resend-verification all need to agree on this or the same address can
// end up looking like two different accounts (e.g. "Foo@Bar.com " vs
// "foo@bar.com").
export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
