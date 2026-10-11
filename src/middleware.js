import { NextResponse } from "next/server";
import { buildCsp, generateNonce } from "@/lib/csp";
import { isSameOriginRequest } from "@/lib/csrf";

// Per-request Content-Security-Policy with a nonce (M6) — see lib/csp.js for
// the reasoning. The policy goes on the *request* too: that is how Next.js
// finds the nonce to stamp on its own inline scripts, and how layout.jsx
// reads it (via the x-nonce header) for the theme script and style tags.
//
// CSP_REPORT_ONLY=1 switches to Content-Security-Policy-Report-Only: an
// operational escape hatch for observing a deployment without blocking
// anything. The default is enforcing.
//
// L6: the same file also guards the API. Every state-changing request to
// /api/* (JSON or multipart POST/PUT/PATCH/DELETE) must come from this app's
// own origin - see lib/csrf.js - on top of the SameSite=Lax session cookie.
// A refused request gets a plain 403 and never reaches a route.
export function middleware(request) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (!isSameOriginRequest({ method: request.method, headers: request.headers })) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    return NextResponse.next();
  }

  const nonce = generateNonce();
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV !== "production" });
  const headerName =
    process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, csp);
  return response;
}

// Pages get the CSP; /api/* only gets the origin check above (API responses
// carry a locked-down CSP from next.config.js). Static assets don't render
// anything. Prefetches are skipped as in the
// Next.js CSP guide (they never execute scripts).
export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sw.js|brand/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
