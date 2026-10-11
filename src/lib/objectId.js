// Route params come straight from the URL, so anything can show up there —
// a malformed id would otherwise reach Mongoose and throw an uncaught
// CastError (surfaced to the client as an unstyled 500). Routes should
// check this before querying and return a clean 400 instead.
//
// L5: exactly 24 hexadecimal characters, in either letter case. MongoDB and
// Mongoose both treat "507F1F77BCF86CD799439011" and its lower-case form as
// the same id, so rejecting the upper-case spelling made routes disagree
// with the database. (The old check round-tripped through ObjectId and
// compared strings, which only ever matched the lower-case form.)
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export function isValidObjectId(id) {
  return typeof id === "string" && OBJECT_ID_RE.test(id);
}

// The canonical (lower-case) spelling Mongoose uses when it prints an _id.
// Accepting an upper-case id is only safe if code that compares it as a
// plain string against stored ids (`String(team.manager) === id`,
// `Set.has(id)`, duplicate checks) first converts it with this - otherwise
// "507F..." would not equal "507f..." and, for example, the "manager can't
// be removed" guard would not fire. Returns null for anything invalid.
export function normalizeObjectId(id) {
  return isValidObjectId(id) ? id.toLowerCase() : null;
}
