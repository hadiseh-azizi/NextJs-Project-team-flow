"use client";

import { Box } from "@mui/material";

// The delay between item N and N+1 shrinks as the list goes on — the first
// couple of items reveal at a relaxed pace, then the rest cascade in
// increasingly quickly, rather than a flat metronome delay per item.
export function staggerDelay(index, { base = 260, curve = 0.6 } = {}) {
  return Math.round(base * (1 - 1 / (1 + index * curve)));
}

export default function FadeInStagger({ index = 0, base, curve, duration = 0.5, sx, children, ...props }) {
  return (
    <Box
      sx={{
        animation: `ff-fade-in ${duration}s cubic-bezier(.2,.8,.2,1) both`,
        animationDelay: `${staggerDelay(index, { base, curve })}ms`,
        ...sx,
      }}
      {...props}
    >
      {children}
    </Box>
  );
}
