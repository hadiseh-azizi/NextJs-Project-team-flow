// Shared request-body validators for API routes.
//
// Every function here follows the same shape used by the existing
// `validateAssignees()` helper in authz.js: return either `{ value }` on
// success or `{ error }` (a user-facing string) on failure — callers map
// `error` straight to a 400 response instead of letting bad input reach
// Mongoose, where it would either throw an uncaught CastError/ValidationError
// (surfaced as an unstyled 500) or, worse, get coerced into something that
// silently isn't what the client sent.
//
// Convention used throughout: a field that's `undefined` in the request
// body means "not provided, leave unchanged" (relevant for PATCH routes);
// `null` (where the field is nullable) means "clear it". Both are distinct
// from an invalid value, which is always rejected.

import { isValidObjectId } from "@/lib/objectId";
import { normalizeEmail } from "@/lib/normalizeEmail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A required, human-entered piece of text: title, name, etc. Trims
// surrounding whitespace and rejects anything that's empty once trimmed —
// a string of only spaces should not count as a title.
export function validateRequiredString(value, { field, maxLength = 200 } = {}) {
  if (typeof value !== "string") return { error: `${field} is required` };
  const trimmed = value.trim();
  if (!trimmed) return { error: `${field} is required` };
  if (trimmed.length > maxLength) {
    return { error: `${field} must be ${maxLength} characters or fewer` };
  }
  return { value: trimmed };
}

// An optional block of text: description, notes, etc. `undefined` means
// "field not provided" (PATCH callers should leave the existing value
// alone); an empty string or `null` normalizes to `null` (explicitly
// cleared) rather than being rejected, since clearing a description is a
// legitimate action, not malformed input.
export function validateOptionalString(value, { field, maxLength = 2000 } = {}) {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${field} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { error: `${field} must be ${maxLength} characters or fewer` };
  }
  return { value: trimmed || null };
}

// Normalizes + validates an email address's shape and length. Always
// required — callers that need an optional email should check
// `value === undefined` before calling this.
//
// Uses the same normalizeEmail() as registration/login/verification so an
// address is normalized identically everywhere it's compared or stored —
// otherwise "Foo@Bar.com" typed into an invite form could fail to match
// the account already normalized to "foo@bar.com" at registration.
export function validateEmailInput(value, { field = "email", maxLength = 254 } = {}) {
  if (typeof value !== "string" || !value.trim()) return { error: `${field} is required` };
  const normalized = normalizeEmail(value);
  if (normalized.length > maxLength) return { error: `${field} is too long` };
  if (!EMAIL_RE.test(normalized)) return { error: `Please enter a valid ${field}` };
  return { value: normalized };
}

// A single ObjectId-shaped string.
export function validateObjectIdField(value, { field = "id" } = {}) {
  if (!isValidObjectId(value)) return { error: `${field} is invalid` };
  return { value };
}

// An array of ObjectId-shaped strings. Verifies the value is actually an
// array (not an object, not a single string a client forgot to wrap),
// validates every entry, and de-duplicates intentionally rather than
// rejecting on duplicates — a client re-submitting the same id twice
// (e.g. a double-click) shouldn't be a hard error, but the deduping is
// explicit here rather than left to whatever happens to touch the array
// next.
export function validateObjectIdArray(value, { field = "ids", max = 500 } = {}) {
  if (!Array.isArray(value)) return { error: `${field} must be a list` };
  if (value.length > max) return { error: `${field} has too many items` };
  const seen = new Set();
  const ids = [];
  for (const raw of value) {
    const id = typeof raw === "string" ? raw : String(raw ?? "");
    if (!isValidObjectId(id)) return { error: `${field} contains an invalid id` };
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { value: ids };
}

// An optional date. `undefined` = not provided (leave unchanged); `null`
// or `""` = explicitly cleared. Anything else must parse to a real
// calendar date — this is the guard that keeps `new Date("garbage")`
// (an "Invalid Date" object) from ever reaching Mongoose, where it would
// otherwise pass straight through as a non-null-but-nonsensical value.
export function validateOptionalDate(value, { field = "date" } = {}) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === "") return { value: null };
  if (typeof value !== "string" && typeof value !== "number") {
    return { error: `${field} is invalid` };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: `${field} is invalid` };
  return { value: date };
}

// A finite, whole number within a sane range — used for things like
// Kanban `order` positions. Rejects NaN, Infinity, fractional values, and
// anything wildly out of range (a typo'd order of 1e30 shouldn't silently
// become the new sort key).
export function validateInteger(value, { field = "value", min = -1_000_000, max = 1_000_000 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { error: `${field} must be a whole number` };
  }
  if (value < min || value > max) return { error: `${field} is out of range` };
  return { value };
}

export function validateBooleanField(value, { field = "value" } = {}) {
  if (typeof value !== "boolean") return { error: `${field} must be true or false` };
  return { value };
}

// A value that must be one of a fixed set (e.g. a task color key) — a
// request can't smuggle through an arbitrary string just because the
// frontend happens to send it.
export function validateEnumValue(value, { field = "value", allowed = [] } = {}) {
  if (!allowed.includes(value)) {
    return { error: `${field} must be one of: ${allowed.join(", ")}` };
  }
  return { value };
}

// Same as above, but optional: `undefined` = not provided, `null`/`""` =
// explicitly cleared.
export function validateOptionalEnumValue(value, { field = "value", allowed = [] } = {}) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === "") return { value: null };
  if (!allowed.includes(value)) {
    return { error: `${field} must be one of: ${allowed.join(", ")}` };
  }
  return { value };
}
