"use client";

import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { accentGradient } from "@/lib/brand";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

// One header for every page in the dashboard: an optional way back, the
// title in the serif, one line of context, and the page's own actions on
// the right (they wrap under the title on narrow screens).
// `accent`, when passed, draws a small identity-color dot before the
// title — the same treatment ProjectCard/TeamCard use, so a project or
// team's detail page still reads as "the same one" you clicked from the
// grid. Omitted everywhere else; it's optional and defaults to nothing.
export default function PageHeader({ title, description, back, actions, accent, sx }) {
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
          <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 1.25 }}>
            {accent && (
              <Box
                aria-hidden
                sx={{ width: 11, height: 11, borderRadius: "50%", flexShrink: 0, background: (theme) => accentGradient(accent, theme.palette.mode), boxShadow: (theme) => `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.18)}` }}
              />
            )}
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
