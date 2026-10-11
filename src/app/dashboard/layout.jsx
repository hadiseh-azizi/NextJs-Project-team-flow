import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Container } from "@mui/material";
import { authOptions } from "@/lib/auth";
import AuthProvider from "@/components/AuthProvider";
import Navbar from "@/components/Navbar";
import PageTransition from "@/components/PageTransition";

export default async function DashboardLayout({ children }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  // Only the dashboard reads the session on the client (useSession), so the
  // provider lives here, seeded with the session this layout just verified.
  // Public pages (landing, login, shared boards) no longer mount a session
  // provider, and with it its /api/auth/session fetch and focus polling.
  return (
    <AuthProvider session={session}>
      <Navbar userName={session.user.name || ""} />
      <Container component="main" maxWidth="lg" sx={{ pt: { xs: 3, md: 5 }, pb: { xs: 6, md: 8 } }}>
        <PageTransition>{children}</PageTransition>
      </Container>
    </AuthProvider>
  );
}
