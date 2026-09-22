"use client";

import Link from "next/link";
import { Box, Typography, LinearProgress } from "@mui/material";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";

// One project as a row in a ruled list. The name and team lead; progress
// sits on the right at a fixed width so the bars line up down the page.
export default function ProjectCard({ project }) {
  const { mode } = useThemeMode();
  const total = project.tasks.length;
  const doneColumnIds = new Set(project.columns.filter((c) => c.isDoneColumn).map((c) => c.id));
  const done = project.tasks.filter((t) => doneColumnIds.has(t.columnId)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Box component="li" sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
      <Box
        component={Link}
        href={`/dashboard/projects/${project.id}`}
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 200px" },
          alignItems: "center",
          columnGap: 6,
          rowGap: 1.5,
          mx: -1.5,
          px: 1.5,
          py: 2,
          borderRadius: 1,
          color: "text.primary",
          textDecoration: "none",
          transition: "background-color .12s ease",
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap>
            {project.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.25, minWidth: 0 }}>
            <Box
              aria-hidden
              sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: pastelForString(project.team.id, mode), boxShadow: "inset 0 0 0 1px rgba(30,27,22,0.18)" }}
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {project.team.name}
            </Typography>
          </Box>
          {project.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.75, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}
            >
              {project.description}
            </Typography>
          )}
        </Box>
        <Box>
          <LinearProgress variant="determinate" value={pct} color={pct === 100 ? "success" : "primary"} aria-label={`${project.name} progress`} />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, fontVariantNumeric: "tabular-nums" }}>
            {total === 0 ? "No tasks yet" : `${done} of ${total} done`}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
