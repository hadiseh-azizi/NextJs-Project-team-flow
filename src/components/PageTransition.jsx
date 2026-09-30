"use client";

import { usePathname } from "next/navigation";
import { Box } from "@mui/material";

// Wraps the dashboard layout's {children} so navigating between major
// pages (Dashboard, Projects, a project's board, Teams, a team's page)
// gets a short, subtle entrance instead of an instant swap. Keyed by the
// route so React mounts a fresh node — and therefore replays the
// `.tf-page-enter` CSS animation — exactly once per navigation, never on
// re-renders within the same page (e.g. a task edit).
export default function PageTransition({ children }) {
  const pathname = usePathname();
  return (
    <Box key={pathname} className="tf-page-enter">
      {children}
    </Box>
  );
}
