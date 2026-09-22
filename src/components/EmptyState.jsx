"use client";

import { Box, Typography } from "@mui/material";

// Shown when a list has nothing in it yet. It says what the space is for
// and offers the one thing to do next — no illustration, no filler.
export default function EmptyState({ title, description, action }) {
  return (
    <Box
      sx={(theme) => ({
        bgcolor: theme.palette.surface.sunken,
        borderRadius: 2,
        px: 3,
        py: { xs: 5, md: 7 },
        textAlign: "center",
      })}
    >
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mx: "auto", maxWidth: 400 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2.5, display: "flex", justifyContent: "center", gap: 1, flexWrap: "wrap" }}>{action}</Box>}
    </Box>
  );
}
