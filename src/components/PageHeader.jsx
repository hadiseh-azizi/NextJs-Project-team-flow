"use client";

import Link from "next/link";
import { Box, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

// One header for every page in the dashboard: an optional way back, the
// title in the serif, one line of context, and the page's own actions on
// the right (they wrap under the title on narrow screens).
export default function PageHeader({ title, description, back, actions, sx }) {
  return (
    <Box sx={{ mb: { xs: 3, md: 4 }, ...sx }}>
      {back && (
        <Box
          component={Link}
          href={back.href}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.25,
            ml: -0.5,
            mb: 1,
            fontSize: "0.8125rem",
            fontWeight: 500,
            color: "text.secondary",
            textDecoration: "none",
            transition: "color .12s ease",
            "&:hover": { color: "text.primary" },
          }}
        >
          <ChevronLeftIcon sx={{ fontSize: 18 }} />
          {back.label}
        </Box>
      )}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2 }}>
        <Box sx={{ minWidth: 0, flex: "1 1 320px" }}>
          <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
            {title}
          </Typography>
          {description && (
            <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 620, overflowWrap: "anywhere" }}>
              {description}
            </Typography>
          )}
        </Box>
        {actions && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>{actions}</Box>}
      </Box>
    </Box>
  );
}
