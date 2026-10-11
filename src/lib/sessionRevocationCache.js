// H1: a short-lived, per-process cache for the jwt callback's revocation check.
//
// The jwt callback (lib/auth.js) must confirm on every use of a session that
// the user still exists and that `User.tokenVersion` still matches the value
// stamped into the token (M2: a password change or reset bumps it, which is
// what revokes older sessions). Doing that with a User.findById on every
// getServerSession / /api/auth/session poll roughly doubled the database reads
// of any route that also runs its own queries.
//
// What is cached, and for how long
//   Only a *successful* lookup: { tokenVersion, name } for a user id. Never a
//   missing user, never a failed lookup, never a token that did not match.
//   An entry is trusted for SESSION_CACHE_TTL_MS and then ignored.
//
// Revocation window (the trade-off, stated plainly)
//   - In the process that changes a password, resets one, verifies an email,
//     renames a user or deletes an account, the entry is dropped immediately
//     (invalidateSessionCache) — revocation there is immediate.
//   - In any OTHER warm process (a separate serverless instance, a second
//     server) the old tokenVersion can still be honoured until that process's
//     entry expires: at most SESSION_CACHE_TTL_MS. There is no cross-process
//     invalidation channel in this architecture and none is invented here.
//     Ten seconds is the whole stale-authorization window.
//
// What is NOT done
//   - A token whose version differs from the cached one is never rejected on
//     the cache's say-so (the cache may be the stale side, e.g. the person
//     just signed in again after a bump): it is re-checked against the
//     database, and only that answer decides.
//   - A database error is never treated as "verified" and a cached value is
//     never served past its TTL to ride out an outage: the check fails closed
//     (SessionUnavailable), exactly as the uncached code did.
//
// Memory is bounded: at most SESSION_CACHE_MAX_ENTRIES entries; expired ones
// are dropped when read and swept before anything live is evicted, then the
// oldest entry goes.

export const SESSION_CACHE_TTL_MS = 10 * 1000;
export const SESSION_CACHE_MAX_ENTRIES = 1000;

export function createSessionCache({
  ttlMs = SESSION_CACHE_TTL_MS,
  maxEntries = SESSION_CACHE_MAX_ENTRIES,
  now = Date.now,
} = {}) {
  // Map keeps insertion order, so the first key is always the oldest entry
  // (set() re-inserts, which also refreshes an id's position).
  const entries = new Map();

  function sweepExpired() {
    const t = now();
    for (const [id, e] of entries) {
      if (e.expiresAt <= t) entries.delete(id);
    }
  }

  return {
    get(userId) {
      const e = entries.get(userId);
      if (!e) return undefined;
      if (e.expiresAt <= now()) {
        entries.delete(userId);
        return undefined;
      }
      return { tokenVersion: e.tokenVersion, name: e.name };
    },
    set(userId, { tokenVersion, name }) {
      entries.delete(userId);
      if (entries.size >= maxEntries) {
        sweepExpired();
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      }
      entries.set(userId, { tokenVersion, name, expiresAt: now() + ttlMs });
    },
    invalidate(userId) {
      entries.delete(String(userId));
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

// One shared instance per process. Held on globalThis (like the Mongoose
// connection in lib/mongodb.js) because Next bundles server components and
// route handlers separately: a plain module-level variable could end up as
// two unrelated caches, and an invalidation from a route handler would then
// never reach the one getServerSession reads.
const GLOBAL_KEY = "__teamFlowSessionCache";
export const sessionCache = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = createSessionCache());

// Call after anything that changes what the jwt callback would conclude for
// this user (tokenVersion bump, name change, account deletion). Memory-only:
// no database access.
export function invalidateSessionCache(userId) {
  if (userId !== undefined && userId !== null) sessionCache.invalidate(String(userId));
}

// The jwt callback's verification step, with the database lookup and the
// cache passed in so it can be tested without either.
//   loadUser(id) -> { tokenVersion, name } | null   (null = no such user)
// Returns { name } for a valid session; throws SessionInvalid (malformed
// token), SessionRevoked (user gone or version moved on) or
// SessionUnavailable (the lookup itself failed). next-auth treats any throw as
// signed-out.
export async function verifySessionToken(token, loadUser, cache = sessionCache) {
  if (!token?.id || typeof token.tv !== "number") throw new Error("SessionInvalid");
  const userId = String(token.id);

  const hit = cache.get(userId);
  if (hit && hit.tokenVersion === token.tv) return { name: hit.name };

  let current;
  try {
    current = await loadUser(userId);
  } catch (err) {
    console.error("Session verification could not reach the database:", err?.message || err);
    throw new Error("SessionUnavailable");
  }

  if (!current) {
    cache.invalidate(userId);
    throw new Error("SessionRevoked");
  }
  const version = current.tokenVersion ?? 0;
  // The database's answer is what gets remembered, whether or not it matched
  // this particular token.
  cache.set(userId, { tokenVersion: version, name: current.name });
  if (version !== token.tv) throw new Error("SessionRevoked");
  return { name: current.name };
}
