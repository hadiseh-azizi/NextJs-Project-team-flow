// Client IP extraction for rate-limit bucketing — never for an
// access-control or trust decision. See the trust-boundary note below
// for exactly when `x-forwarded-for` is and isn't believed.
//
// Accepts either a Fetch API `Headers` object (Next.js route handlers)
// or a plain lowercase-keyed object (the `headers` NextAuth passes into
// `authorize()`), so the same helper works in both places.

// --- Trust boundary ------------------------------------------------
//
// README.md documents this app's deployment target as Vercel, with no
// customer-supplied reverse proxy in front of it. On that specific
// deployment shape, Vercel's edge network itself sets `x-forwarded-for`
// on the way in and does not forward whatever value the client's own
// request originally carried — see
// https://vercel.com/docs/headers/request-headers ("we currently
// overwrite the X-Forwarded-For header and do not forward external
// IPs. This restriction is in place to prevent IP spoofing."). The only
// way a client-supplied X-Forwarded-For reaches the app is Vercel's
// Enterprise-only "trusted proxy in front of Vercel" feature, which this
// project does not use. So on the actual documented deployment,
// `x-forwarded-for` is not attacker-controlled.
//
// That assumption does NOT hold for every environment this same code
// could technically run in — a bare `next start` with no proxy at all,
// a self-hosted/Docker deployment, or a reverse proxy that hasn't been
// configured to strip client-supplied forwarding headers. In any of
// those, a client can put whatever it wants in this header, and trusting
// it would let that client pick its own rate-limit identity at will
// (spin up a new "IP" on every request to dodge a per-IP limit).
//
// Rather than trust it unconditionally, trust is gated behind an
// explicit environment flag so a non-Vercel deployment doesn't silently
// inherit a false sense of security:
//
//   RATE_LIMIT_TRUST_PROXY=vercel  (default) — trust x-forwarded-for /
//     x-real-ip, matching README's documented deployment target.
//   RATE_LIMIT_TRUST_PROXY=none — the app cannot reliably determine the
//     real client IP in this deployment; every request is treated as
//     "unknown" and IP-based rate-limit components are skipped. Callers
//     that rely solely on IP (see register/route.js) fall back to a
//     single shared bucket rather than skipping their limit entirely —
//     see REGISTER_FALLBACK_LIMIT there. Callers that already combine IP
//     with a non-IP identity (login email, resend-verification email)
//     are unaffected: that identity keeps enforcing the limit on its
//     own, per-IP is only ever a second, tighter net on top of it.
//
// Set RATE_LIMIT_TRUST_PROXY=none for any deployment other than Vercel
// unless you have independently verified your reverse proxy overwrites
// (not merely appends to) these headers for untrusted clients.
function isProxyTrusted() {
  const mode = (process.env.RATE_LIMIT_TRUST_PROXY || "vercel").trim().toLowerCase();
  return mode !== "none";
}

// Loose but real IPv4/IPv6 shape check. This is not a full RFC-grade
// validator — its only job is to reject obvious garbage (empty strings,
// stray quotes, script fragments, absurdly long values) before it's used
// as a MongoDB document key, not to validate that the address is
// globally routable.
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_CHARS_RE = /^[0-9a-fA-F:]+$/;

function isPlausibleIp(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v.length > 45) return false; // longest valid IPv6 text form
  const v4 = v.match(IPV4_RE);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255);
  if (v.includes(":")) return IPV6_CHARS_RE.test(v);
  return false;
}

export function getClientIp(headers) {
  if (!headers) return "unknown";
  if (!isProxyTrusted()) return "unknown";

  const get = typeof headers.get === "function" ? (name) => headers.get(name) : (name) => headers[name];

  const forwarded = get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.trim()) {
    // Vercel's own x-forwarded-for is a single client IP in normal
    // operation, but a well-formed multi-hop chain (client, proxy, proxy)
    // is still leftmost-first; a malformed or clearly-spoofed-looking
    // value is rejected outright rather than passed through.
    const first = forwarded.split(",")[0].trim();
    if (isPlausibleIp(first)) return first;
  }

  const real = get("x-real-ip");
  if (typeof real === "string" && isPlausibleIp(real.trim())) return real.trim();

  return "unknown";
}

// Exposed so callers with an IP-only rate limit (nothing else to key on)
// can tell "the proxy layer is untrusted/misconfigured" apart from "this
// one request just didn't carry the header" — both currently return
// `getClientIp() === "unknown"`, but only the former is a standing
// condition worth falling back to a shared bucket for on every request,
// rather than quietly running with no limit at all.
export const isIpTrustEnabled = isProxyTrusted;
