import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

// Where a signed-in user belongs: the same destination login uses after a
// successful sign-in (login/page.jsx) and the same place the dashboard
// layout sends signed-out users away from, so the two checks can't
// disagree and bounce between each other.
export const SIGNED_IN_HOME = "/dashboard";

// Used by the login and register layouts. Doing this on the server, with
// the exact check dashboard/layout.jsx uses (`session?.user`), means a
// signed-in visitor is redirected before any form is rendered: nothing
// flashes, there is no client-side "is the session loaded yet" state to
// get wrong, and a session that is invalid or revoked (the jwt callback
// throws, getServerSession returns null) just sees the normal form.
export async function redirectIfSignedIn() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect(SIGNED_IN_HOME);
}
