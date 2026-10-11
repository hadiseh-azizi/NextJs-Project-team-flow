// L6: Origin-based CSRF check for state-changing API requests.
//
// Session cookies are SameSite=Lax, which already stops the classic
// cross-site form POST in current browsers. This is the second layer for
// everything SameSite doesn't cover (older browsers, same-site-but-not-
// same-origin siblings, a cookie-policy change): a browser always labels a
// non-GET request with where it came from, so a request whose label isn't
// this app is refused before it reaches any route.
//
// No token to thread through forms or fetch calls, so JSON fetches and
// multipart uploads from the app's own pages keep working untouched.
//
// Rules, in order:
//   1. GET/HEAD/OPTIONS are never checked (they don't change state here).
//   2. `Origin` present: it must be "this app" - same host as the request's
//      Host / X-Forwarded-Host, or an origin listed in CSRF_TRUSTED_ORIGINS
//      (comma-separated; optional) or the NEXTAUTH_URL origin. The literal
//      "null" (sandboxed iframes, some redirects) never matches.
//   3. No `Origin`: fall back to `Sec-Fetch-Site` (same-origin / none pass,
//      cross-site / same-site fail), then to `Referer` the same way as step 2.
//   4. Neither header: not a browser navigation or fetch, so there is no
//      ambient-cookie CSRF to defend against (curl, server-to-server, tests).
//      Allowed - the session cookie is still required by every route.
//
// Only the host is compared, not the scheme: behind TLS termination the app
// sees http while the browser says https, and an http/https mismatch on the
// same host is not what this check is for.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function trustedHosts(headers, env) {
  const hosts = new Set();
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded) hosts.add(forwarded.split(",")[0].trim().toLowerCase());
  const host = headers.get("host");
  if (host) hosts.add(host.trim().toLowerCase());
  const extra = [env.NEXTAUTH_URL, ...(env.CSRF_TRUSTED_ORIGINS || "").split(",")];
  for (const entry of extra) {
    const h = entry && hostOf(entry.trim());
    if (h) hosts.add(h);
  }
  return hosts;
}

// Returns true when the request may proceed.
// `env` is injectable for tests; the default reads the two variables below.
const defaultEnv = () => ({
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  CSRF_TRUSTED_ORIGINS: process.env.CSRF_TRUSTED_ORIGINS,
});

export function isSameOriginRequest({ method, headers, env = defaultEnv() }) {
  if (SAFE_METHODS.has(String(method).toUpperCase())) return true;

  const trusted = trustedHosts(headers, env);

  const origin = headers.get("origin");
  if (origin !== null) {
    const h = origin === "null" ? null : hostOf(origin);
    return h !== null && trusted.has(h);
  }

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";

  const referer = headers.get("referer");
  if (referer) {
    const h = hostOf(referer);
    return h !== null && trusted.has(h);
  }

  return true;
}
