"use client";

import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { STOPS } from "@/lib/brand";

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

// The Team Flow mark with a thin ring in the mark's four colors turning
// around it. Shown only when a page does not yet know what it is going to
// show (so it cannot draw an honest skeleton). The mark itself stays still:
// it is wider than tall, and a rotating wide shape reads as a glitch.
//
// With "reduce motion" on, the global rule in globals.css stops the ring
// where it starts, which still reads as a branded loading mark.
export default function TeamFlowLoader({ label = "Loading", size = 56 }) {
  const symbolWidth = Math.round(size * 0.62);
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label={label}
      className="tf-fade-in"
      sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: { xs: 8, md: 12 } }}
    >
      <Box sx={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
        <Box
          aria-hidden
          sx={(theme) => {
            const stops = STOPS[theme.palette.mode === "dark" ? "dark" : "light"];
            return {
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `conic-gradient(from 0deg, transparent 0deg, ${stops[0]} 90deg, ${stops[1]} 180deg, ${stops[2]} 270deg, ${stops[3]} 360deg)`,
              // Cut the middle out so only a 2px ring is left.
              WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px))",
              animation: `${spin} 1.1s linear infinite`,
            };
          }}
        />
        <Box
          component="img"
          src="/brand/symbol.png"
          alt=""
          draggable={false}
          sx={{ display: "block", width: symbolWidth, height: "auto" }}
        />
      </Box>
    </Box>
  );
}
