"use client";

import { Box, Typography } from "@mui/material";
import TeamFlowBrand from "@/components/TeamFlowBrand";

// Shown when a list has nothing in it yet. It says what the space is for
// and offers the one thing to do next. The surface is the tinted panel
// used across the app (brand wash over the sunken surface) with a thin
// gradient line on top, and the Team Flow mark stands in for an
// illustration — so an empty page reads as intentional, not unfinished.
export default function EmptyState({ title, description, action }) {
  return (
    <Box
      className="tf-fade-up tf-topline"
      sx={{
        backgroundColor: "var(--brand-surface-tint)",
        backgroundImage: "var(--brand-panel-wash)",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        px: 3,
        py: { xs: 5, md: 7 },
        textAlign: "center",
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "center", mb: 2, opacity: 0.9 }}>
        <TeamFlowBrand variant="icon" href={null} />
      </Box>
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
