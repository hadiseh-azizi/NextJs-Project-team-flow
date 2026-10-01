"use client";

import { Box } from "@mui/material";
import { accentGradient } from "@/lib/brand";
import { useThemeMode } from "@/components/ThemeModeContext";

// A determinate progress bar whose filled part carries the brand gradient
// across its own length (MUI's LinearProgress translates one long bar, so a
// gradient on it would show only its right-hand end at low percentages).
//
//   accent   optional identity color (a project's); the fill then runs from
//            that color toward the brand cyan instead of the full gradient.
//   done     a complete project uses the semantic success color, as before.
export default function GradientProgress({ value, accent, done = false, width = "100%", height = 4, label, sx }) {
  const { mode } = useThemeMode();
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  let fill = "var(--brand-gradient)";
  if (done) fill = "var(--brand-success)";
  else if (accent) fill = accentGradient(accent, mode);
  return (
    <Box
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      sx={{ width, maxWidth: "100%", height, borderRadius: height / 2, bgcolor: "surface.track", overflow: "hidden", ...sx }}
    >
      <Box
        sx={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: "inherit",
          background: fill,
          transition: "width 280ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </Box>
  );
}
