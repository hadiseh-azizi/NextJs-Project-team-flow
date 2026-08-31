"use client";

import Link from "next/link";
import { Card, CardActionArea, CardContent, Box, Typography, LinearProgress, Chip } from "@mui/material";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";

export default function ProjectCard({ project }) {
  const { mode } = useThemeMode();
  const total = project.tasks.length;
  const doneColumnIds = new Set(project.columns.filter((c) => c.isDoneColumn).map((c) => c.id));
  const done = project.tasks.filter((t) => doneColumnIds.has(t.columnId)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Card>
      <CardActionArea component={Link} href={`/dashboard/projects/${project.id}`} sx={{ p: 0.25 }}>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography variant="h6" fontWeight={700} noWrap>
              {project.name}
            </Typography>
            <Chip
              label={project.team.name}
              size="small"
              sx={{ bgcolor: pastelForString(project.team.id, mode), color: mode === "dark" ? "#F1EEFB" : "#221F2E" }}
            />
          </Box>
          {project.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 2.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {project.description}
            </Typography>
          )}
          <LinearProgress
            variant="determinate"
            value={pct}
            color={pct === 100 ? "success" : "primary"}
            sx={{ height: 5, borderRadius: 3, mb: 1 }}
          />
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            {done}/{total} tasks — {pct}%
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
