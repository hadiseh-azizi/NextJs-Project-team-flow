"use client";

import { SessionProvider } from "next-auth/react";

// `session` is the server's own read of the session cookie. Handing it to
// SessionProvider makes `useSession()` report "authenticated" with the real
// user on the very first render, instead of "loading" with no user until a
// client fetch to /api/auth/session returns. Anything that derives
// permissions from the user id (manager controls, edit rights) therefore
// has the right answer immediately and never renders a "not allowed" state
// that it then corrects.
//
// The server value is only the starting point: SessionProvider still
// refetches on focus as before, so a session that ends or is revoked
// elsewhere is still noticed.
export default function AuthProvider({ children, session }) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
