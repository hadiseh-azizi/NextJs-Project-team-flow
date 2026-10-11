// Registered only by app/shared/board/[token]/page.jsx (see that file) —
// never from the root layout — so this never even installs for anyone
// using the authenticated app. It's registered with the default ('/')
// scope purely so it's allowed to see every request (a scoped
// registration would need a Service-Worker-Allowed response header this
// app doesn't send for static files), but `shouldHandle()` below is what
// actually limits it: everything outside the shared board and its own
// static assets is left completely alone, untouched by any of this.
//
// What this SW does NOT do, on purpose: it never intercepts non-GET
// requests, never touches `/api/` routes other than the public shared-
// board endpoint's own page shell dependencies, and never caches
// anything from the authenticated app. Section 8 of the spec ("Avoid
// caching sensitive authenticated application data unnecessarily") is
// satisfied by this scope check rather than by trying to enumerate
// what's sensitive.
//
// Cache lifetime (L12): the cache is named after the build that
// registered this worker. The page registers `/sw.js?v=<build id>`
// (NEXT_PUBLIC_BUILD_ID, set per build in next.config.js), so a new
// deployment is a new script URL, which the browser installs as an update.
// Its `activate` step deletes every cache from other builds, so assets and
// page shells from an old deployment are never mixed with the new one and
// don't accumulate on a shared device. Within one build, requests are
// still network-first and the cache is capped (MAX_ENTRIES).
const CACHE_PREFIX = "teamflow-shared-shell-";
const MAX_ENTRIES = 120;

// Only the build id's own safe characters make it into a cache name; a
// missing or odd value falls back to "dev" rather than throwing.
function buildVersion() {
  try {
    const v = new URL(self.location.href).searchParams.get("v") || "";
    return /^[\w.-]{1,64}$/.test(v) ? v : "dev";
  } catch {
    return "dev";
  }
}

const SHELL_CACHE = `${CACHE_PREFIX}${buildVersion()}`;

function shouldHandle(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/shared/board/")) return true;
  // Next.js's own JS/CSS/font chunks — needed so the shared board page's
  // app shell can actually render on a repeat visit with no network.
  // Only the build's static output: `/_next/image` (the image optimizer)
  // and anything else under `/_next/` isn't needed for the shell and has
  // no reason to be kept.
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname === "/favicon.ico") return true;
  return false;
}

// Keeps the newest MAX_ENTRIES responses. `cache.keys()` returns entries
// in insertion order and `put` of an existing request re-inserts it, so
// the front of the list is the oldest.
async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function store(req, res) {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(req, res);
  await trimCache(cache);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only ever cache/serve safe, idempotent reads — a mutation has no
  // business being replayed from a cache, and this feature has no
  // mutations of its own to intercept anyway.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (!shouldHandle(url)) return; // let the browser handle it normally

  // Network-first, falling back to the last good cached copy when the
  // network is unavailable — so a rebuild's new asset hashes are always
  // preferred while online, and only used from cache once there's
  // genuinely no other option.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          // waitUntil keeps the worker alive until the copy is written
          // (a bare un-awaited put can be cut off when the worker idles).
          event.waitUntil(store(req, res.clone()).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
