// Content-Security-Policy builder (M6). Used by src/middleware.js, which
// generates a fresh nonce per request; kept separate so it can be unit
// tested without the Next.js runtime.
//
// Why a nonce rather than a hash or 'unsafe-inline':
//   - The inline theme script in app/layout.jsx could be allowed by hash,
//     but Next.js itself emits inline scripts on every page (the RSC
//     payload and bootstrap) whose content differs per request, so a hash
//     list can't cover them. A per-request nonce covers both: Next.js
//     reads the nonce from this header and stamps it on its own scripts,
//     and layout.jsx stamps it on the theme script and <style> tags.
//   - 'strict-dynamic' lets those trusted scripts load the chunks they
//     need; the host allow-list is then ignored by modern browsers, so an
//     injected <script src=...> or inline handler without the nonce is
//     blocked.
// Cost: pages carrying a nonce must be rendered per request, so the root
// layout reads it from the request headers and nothing is statically
// prerendered. (Every page here is behind client-side data fetching
// anyway; see README.)
//
// Styles are the pragmatic part: MUI/Emotion writes <style> elements
// (nonce'd via the Emotion cache, see ThemeRegistry.jsx) and React inline
// `style=""` attributes (charts, transitions). Attributes can't carry a
// nonce, so style attributes are allowed via style-src-attr while
// <style>/<link> elements stay nonce/host restricted. The plain `style-src`
// is the fallback for browsers that predate the -elem/-attr split.
// Google Fonts (globals.css @import) is the only third-party origin.

export function buildCsp(nonce, { isDev = false } = {}) {
  const fontsCss = "https://fonts.googleapis.com";
  const fontsFiles = "https://fonts.gstatic.com";

  const directives = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`],
    ["style-src", `'self' 'unsafe-inline' ${fontsCss}`],
    ["style-src-elem", `'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`} ${fontsCss}`],
    ["style-src-attr", "'unsafe-inline'"],
    ["font-src", `'self' ${fontsFiles}`],
    ["img-src", "'self' data: blob:"],
    ["connect-src", "'self'"],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  if (!isDev) directives.push(["upgrade-insecure-requests", ""]);

  return directives.map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}

export function generateNonce() {
  // Web Crypto: available in the Edge runtime middleware runs in.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
