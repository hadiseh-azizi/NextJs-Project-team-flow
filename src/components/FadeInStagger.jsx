"use client";

import { Box } from "@mui/material";

// Lists (project cards, team cards, kanban columns, task cards) render
// immediately with no entrance animation — a fade/blur/scale sequence on
// every item on every page load reads as decorative rather than useful.
// This wrapper is kept as a stable API for existing call sites but no
// longer animates; motion in the app is reserved for direct responses to
// a user action (opening a dialog, reordering a task), not page load.
export function staggerDelay() {
  return 0;
}

export default function FadeInStagger({ index, base, curve, duration, sx, children, ...props }) {
  return (
    <Box sx={sx} {...props}>
      {children}
    </Box>
  );
}
