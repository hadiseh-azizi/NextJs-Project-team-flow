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
const CACHE_VERSION = "v1";
const SHELL_CACHE = `teamflow-shared-shell-${CACHE_VERSION}`;

function shouldHandle(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/shared/board/")) return true;
  // Next.js's own JS/CSS/font chunks — needed so the shared board page's
  // app shell can actually render on a repeat visit with no network.
  if (url.pathname.startsWith("/_next/")) return true;
  if (url.pathname === "/favicon.ico") return true;
  return false;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("teamflow-shared-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key))))
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
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
