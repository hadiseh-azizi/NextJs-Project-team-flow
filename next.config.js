const isProd = process.env.NODE_ENV === "production";

// Identifies this build to the shared-board service worker (L12): the page
// registers /sw.js?v=<id>, and the worker names its cache after it, so each
// new deployment starts with a fresh cache and drops the previous one's.
// NEXT_PUBLIC_BUILD_ID can be set explicitly; otherwise Vercel's commit SHA
// (stable per deployment) is used, and anywhere else a build timestamp.
// Written back to the environment so that Next's build worker processes,
// which load this file again, agree with the process that inlines the value.
const buildId = process.env.NEXT_PUBLIC_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36);
process.env.NEXT_PUBLIC_BUILD_ID = buildId;

// Headers that don't depend on the request (M6). The Content-Security-Policy
// for pages needs a per-request nonce and so lives in src/middleware.js.
const securityHeaders = [
  // Never let the browser guess a content type (attachments are served
  // from user-supplied bytes).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: nothing in this app is meant to be framed. The CSP's
  // frame-ancestors 'none' says the same for browsers that read it; this
  // covers the ones that only know the older header.
  { key: "X-Frame-Options", value: "DENY" },
  // Share-board, reset and verification URLs carry secrets in the path or
  // query. Cross-origin requests get the origin only, never the full URL.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these browser capabilities; switching them off
  // means injected or embedded code can't request them either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  // HTTPS-only, production only: browsers ignore it over plain http and a
  // dev server on localhost shouldn't pin anything. No `preload`: that is a
  // hard-to-undo commitment for the whole domain and is the owner's call.
  // includeSubDomains assumes every subdomain of the production domain is
  // also served over HTTPS; drop it if that isn't true.
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Removes the "X-Powered-By: Next.js" response header. Pure hardening —
  // no effect on routing, rendering, or application behavior.
  poweredByHeader: false,

  // Read by app/shared/board/[token]/page.jsx when it registers the worker.
  env: { NEXT_PUBLIC_BUILD_ID: buildId },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // JSON/attachment responses never need to load or run anything.
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

module.exports = nextConfig;
