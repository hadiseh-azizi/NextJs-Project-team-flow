"use client";

import Link from "next/link";
import { Box } from "@mui/material";

// The product name is the only logo: set in the serif, with the ochre
// full stop that carries the accent color through the interface.
export default function Wordmark({ href = "/", compact = false, size = "1.15rem" }) {
  return (
    <Box
      component={Link}
      href={href}
      aria-label="TeamFlow"
      sx={{
        fontFamily: "'Fraunces', Georgia, serif",
        fontWeight: 600,
        fontSize: size,
        letterSpacing: "-0.01em",
        textDecoration: "none",
        color: "text.primary",
        flexShrink: 0,
        borderRadius: 0.5,
      }}
    >
      {compact ? "T" : "TeamFlow"}
      <Box component="span" sx={{ color: "primary.main" }}>.</Box>
    </Box>
  );
}
