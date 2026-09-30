"use client";

import { Box } from "@mui/material";
import { staggerDelay } from "@/lib/staggerDelay";

// A small, capped stagger for short lists that are genuinely new on
// screen (Kanban columns, the task cards inside them). Renders via a
// plain CSS `animation` (see .tf-fade-up in globals.css), so it only
// plays when React actually mounts a new DOM node for this item — an
// existing card re-rendering because sibling data changed, or the whole
// board refetching after an edit, does not replay it, since the element
// keeps its identity across those renders as long as `key` (the task or
// column id) stays the same.
//
// The delay-capping logic itself lives in lib/staggerDelay.js (see
// MAX_STAGGER_DELAY_MS there) so it stays unit-testable.
export { staggerDelay };

//
// `animate={false}` turns the entrance off for an item that has already
// played it. The Kanban board uses this for columns/cards that have
// settled: reordering columns moves their DOM nodes, and browsers restart
// a CSS animation on any element (or descendant) that is removed and
// re-inserted — without this, every card in a dragged column would fade
// in again on drop.
export default function FadeInStagger({ index = 0, base = 30, duration = 0.22, animate = true, sx, children, ...props }) {
  const delayMs = staggerDelay(index, base);
  return (
    <Box
      sx={{
        animation: animate ? `tf-fade-up ${duration}s cubic-bezier(0.16, 1, 0.3, 1) both` : "none",
        animationDelay: animate ? `${delayMs}ms` : undefined,
        ...sx,
      }}
      {...props}
    >
      {children}
    </Box>
  );
}
