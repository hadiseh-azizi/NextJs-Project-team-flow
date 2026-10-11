import Link from "next/link";
import { Button, Container } from "@mui/material";
import EmptyState from "@/components/EmptyState";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <EmptyState
        title="Page not found"
        description="The address may be mistyped, or the page has moved."
        action={
          <Button component={Link} href="/dashboard" variant="contained">
            Go to dashboard
          </Button>
        }
      />
    </Container>
  );
}
