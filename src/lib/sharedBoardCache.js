// Client-side offline cache for one shared board's data, keyed by its
// share token. Uses the Cache Storage API directly (not through the
// service worker — see public/sw.js, which only precaches the page shell
// and static assets) so the "did this load, and when" logic lives in one
// place with normal try/catch control flow, rather than being smuggled
// through response headers on a SW-intercepted fetch.
//
// Two synthetic entries per token: the board data itself, stored under
// the real API path so it reads back as a normal JSON body, and a small
// metadata entry (just `cachedAt`) under a path that's never actually
// requested — Cache Storage only stores Request/Response pairs, so a
// timestamp needs a Response of its own rather than a bare field
// tacked onto the real one.
const CACHE_NAME = "teamflow-shared-board-data-v1";

function dataKey(token) {
  return `/api/shared/board/${token}`;
}

function metaKey(token) {
  return `/__teamflow-shared-board-meta__/${token}`;
}

function cacheStorageAvailable() {
  return typeof window !== "undefined" && "caches" in window;
}

// Stores the just-fetched board snapshot for offline fallback, alongside
// the moment it was fetched. Best-effort: a cache write can fail (private
// browsing, storage quota, Cache Storage simply unavailable) without that
// being a real error for the person looking at their board right now —
// they just won't have an offline copy for next time.
export async function cacheBoardSnapshot(token, data) {
  if (!cacheStorageAvailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([
      cache.put(dataKey(token), new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })),
      cache.put(metaKey(token), new Response(JSON.stringify({ cachedAt: Date.now() }))),
    ]);
  } catch {
    // See comment above — offline support degrades gracefully, nothing
    // else about viewing the board depends on this succeeding.
  }
}

// Returns `{ data, cachedAt }` for a previously cached snapshot, or
// `null` if there isn't one (never been cached, or Cache Storage isn't
// available at all).
export async function readCachedBoard(token) {
  if (!cacheStorageAvailable()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const [dataRes, metaRes] = await Promise.all([cache.match(dataKey(token)), cache.match(metaKey(token))]);
    if (!dataRes) return null;
    const data = await dataRes.json();
    const meta = metaRes ? await metaRes.json() : null;
    return { data, cachedAt: meta?.cachedAt ?? null };
  } catch {
    return null;
  }
}

// Removes a token's cached snapshot — used when the server gives a
// definitive "this link no longer works" answer (see the shared board
// page's error handling), so a revoked or disabled link doesn't keep
// quietly serving its last-known board to whoever still has it cached.
export async function clearCachedBoard(token) {
  if (!cacheStorageAvailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([cache.delete(dataKey(token)), cache.delete(metaKey(token))]);
  } catch {
    // Nothing more useful to do — worst case is a stale cache entry that
    // a later successful load will overwrite anyway.
  }
}
