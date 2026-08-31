"use client";

import { useState } from "react";
import Link from "next/link";
import { Box, Paper, Typography, List, ListItemButton, ListItemText } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { staggerDelay } from "@/components/FadeInStagger";

export default function OverviewStats({ projects, userId }) {
  const [activeStat, setActiveStat] = useState(null);

  const allTasks = projects.flatMap((p) => {
    const doneColumnIds = new Set(p.columns.filter((c) => c.isDoneColumn).map((c) => c.id));
    return p.tasks.map((t) => ({
      ...t,
      projectId: p.id,
      projectName: p.name,
      isDone: doneColumnIds.has(t.columnId),
    }));
  });
  const doneTasks = allTasks.filter((t) => t.isDone);
  const myOpenTasks = allTasks.filter((t) => t.assignees.some((a) => a.id === userId) && !t.isDone);

  const stats = [
    { key: "projects", label: "Active projects", value: projects.length },
    { key: "done", label: "Tasks completed", value: `${doneTasks.length}/${allTasks.length}` },
    { key: "open", label: "My open tasks", value: myOpenTasks.length },
  ];

  let items = [];
  let emptyLabel = "";
  if (activeStat === "projects") {
    items = projects.map((p) => ({ id: p.id, primary: p.name, href: `/dashboard/projects/${p.id}` }));
    emptyLabel = "You haven't created any projects yet.";
  } else if (activeStat === "done") {
    items = doneTasks.map((t) => ({ id: t.id, primary: t.title, secondary: t.projectName, href: `/dashboard/projects/${t.projectId}` }));
    emptyLabel = "Nothing's been finished yet.";
  } else if (activeStat === "open") {
    items = myOpenTasks.map((t) => ({ id: t.id, primary: t.title, secondary: t.projectName, href: `/dashboard/projects/${t.projectId}` }));
    emptyLabel = "No open tasks — nice work!";
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Paper variant="outlined" sx={{ display: "flex", overflow: "hidden" }}>
        {stats.map((s, i) => {
          const active = activeStat === s.key;
          return (
            <Box
              key={s.key}
              component="button"
              onClick={() => setActiveStat(active ? null : s.key)}
              sx={(theme) => ({
                flex: 1,
                textAlign: "left",
                px: { xs: 2, sm: 3 },
                py: 2.5,
                cursor: "pointer",
                border: "none",
                borderLeft: i > 0 ? `1px solid ${theme.palette.divider}` : "none",
                bgcolor: active ? alpha(theme.palette.primary.main, 0.06) : "transparent",
                transition: "background-color .15s",
                animation: "ff-fade-in .5s cubic-bezier(.2,.8,.2,1) both",
                animationDelay: `${staggerDelay(i, { base: 180 })}ms`,
                "&:hover": { bgcolor: alpha(theme.palette.primary.main, active ? 0.1 : 0.04) },
              })}
            >
              <Typography variant="body2" sx={{ mb: 0.5, color: active ? "primary.main" : "text.secondary" }}>
                {s.label}
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {s.value}
              </Typography>
            </Box>
          );
        })}
      </Paper>

      {activeStat && (
        <Paper variant="outlined" sx={{ mt: 1 }}>
          {items.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>
              {emptyLabel}
            </Typography>
          ) : (
            <List disablePadding>
              {items.map((it, i) => (
                <ListItemButton
                  key={it.id}
                  component={Link}
                  href={it.href}
                  divider={i < items.length - 1}
                  sx={{
                    animation: "ff-fade-in .4s cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${staggerDelay(i, { base: 110 })}ms`,
                  }}
                >
                  <ListItemText primary={it.primary} secondary={it.secondary} />
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>
      )}
    </Box>
  );
}
