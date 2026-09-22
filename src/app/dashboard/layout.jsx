import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Container } from "@mui/material";
import { authOptions } from "@/lib/auth";
import Navbar from "@/components/Navbar";

export default async function DashboardLayout({ children }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <>
      <Navbar userName={session.user.name || ""} />
      <Container component="main" maxWidth="lg" sx={{ pt: { xs: 3, md: 5 }, pb: { xs: 6, md: 8 } }}>
        {children}
      </Container>
    </>
  );
}
