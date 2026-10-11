"use client";

import { Container } from "@mui/material";
import RouteError from "@/components/RouteError";

// Catches failures outside a dashboard page — including the dashboard
// layout itself, which app/dashboard/error.jsx cannot catch.
export default function AppError(props) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <RouteError {...props} />
    </Container>
  );
}
