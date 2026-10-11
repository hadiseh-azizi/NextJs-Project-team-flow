"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { formatDateOnly } from "@/lib/dateOnly";
import { isOverdue, localTodayYmd } from "@/lib/dueStatus";
import { projectColorForId } from "@/lib/entityColor";
import { groupByProject } from "@/lib/groupByProject";
import { useThemeMode } from "@/components/ThemeModeContext";

// Three numbers that double as a switch: choosing one lists what is behind
// it right underneath. "My open tasks" is open by default because it is the
// one list that tells you what to do next.
//
// The numbers are the true totals (counted by the database). The two task
// lists are bounded and already ordered by the server — open tasks soonest
// due first, completed ones most recently updated first — so when a list
// holds fewer rows than its count, a line under it says so.
export default function OverviewStats({ projects, counts, openTasks, completedTasks }) {
  const [activeStat, setActiveStat] = useState("open");
  const { mode } = useThemeMode();
  // Set after mount so server and client markup agree; overdue flags appear
  // one frame later.
  const [today, setToday] = useState(null);
  useEffect(() => {
    setToday(localTodayYmd());
  }, []);

  const stats = [
    { key: "open", label: "My open tasks", value: counts.open },
    { key: "done", label: "Tasks completed", value: `${counts.done}/${counts.total}` },
    { key: "projects", label: "Active projects", value: projects.length },
  ];

  let items = [];
  let emptyLabel = "";
  if (activeStat === "projects") {
    items = projects.map((p) => ({ id: p.id, primary: p.name, href: `/dashboard/projects/${p.id}` }));
    emptyLabel = "You haven't created any projects yet.";
  } else if (activeStat === "done") {
    // Project name is carried on each item so it can be grouped below;
    // it's shown once as the group heading rather than repeated per row.
    items = completedTasks.map((t) => ({ id: t.id, primary: t.title, projectId: t.projectId, projectName: t.projectName, href: `/dashboard/projects/${t.projectId}` }));
    emptyLabel = "Nothing's been finished yet.";
  } else if (activeStat === "open") {
    items = openTasks.map((t) => ({
      id: t.id,
      primary: t.title,
      projectId: t.projectId,
      projectName: t.projectName,
      dueDate: t.dueDate,
      href: `/dashboard/projects/${t.projectId}`,
    }));
    emptyLabel = "No open tasks assigned to you.";
  }
  const isTaskList = activeStat === "open" || activeStat === "done";
  const totalForList = activeStat === "open" ? counts.open : activeStat === "done" ? counts.done : 0;
  const listIsPartial = isTaskList && items.length > 0 && items.length < totalForList;

  return (
    <Box
      className="tf-topline"
      sx={{
        bgcolor: "background.paper",
        backgroundImage: "var(--brand-panel-wash)",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        boxShadow: "var(--brand-shadow-card)",
        overflow: "hidden",
        px: { xs: 2, sm: 3 },
        pt: { xs: 2.5, sm: 3 },
        pb: 1.5,
      }}
    >
      <Box sx={{ display: "flex", gap: { xs: 2.5, sm: 4 }, borderBottom: "1px solid", borderColor: "divider" }}>
        {stats.map((s) => {
          const active = activeStat === s.key;
          return (
            <Box
              key={s.key}
              component="button"
              type="button"
              onClick={() => setActiveStat(active ? null : s.key)}
              aria-pressed={active}
              aria-expanded={active}
              aria-controls="overview-list"
              sx={{
                position: "relative",
                textAlign: "left",
                p: 0,
                pb: 1.5,
                font: "inherit",
                cursor: "pointer",
                border: "none",
                bgcolor: "transparent",
                color: "text.primary",
                "&::after": {
                  content: '""',
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 2,
                  background: "var(--brand-gradient)",
                  opacity: active ? 1 : 0,
                  transition: "opacity .12s ease",
                },
                "&:hover .stat-label": { color: "text.primary" },
                "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 4, borderRadius: 0.5 },
              }}
            >
              <Typography
                component="span"
                sx={{ display: "block", fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500, fontSize: { xs: "1.75rem", sm: "2.125rem" }, lineHeight: 1.1, letterSpacing: "-0.02em" }}
              >
                {s.value}
              </Typography>
              <Typography
                className="stat-label"
                component="span"
                variant="body2"
                sx={{ display: "block", mt: 0.5, color: active ? "text.primary" : "text.secondary", fontWeight: active ? 600 : 400, transition: "color .12s ease" }}
              >
                {s.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Box id="overview-list" sx={{ mt: 1 }}>
        {activeStat && (
          // Keyed by which stat is active so switching tabs remounts this
          // panel and gets a quick crossfade, instead of the new list just
          // snapping in where the old one was.
          <Box key={activeStat} className="tf-fade-in">
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                {emptyLabel}
              </Typography>
            ) : isTaskList ? (
              // Open/completed tasks span every project, so they're
              // grouped under one heading per project rather than left to
              // blend together in a single list.
              groupByProject(items).map((group, gi) => (
                <Box key={group.projectId} sx={{ mt: gi === 0 ? 0 : 2.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
                    <Box
                      aria-hidden
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        flexShrink: 0,
                        // Same hue identifies the project either way; the
                        // completed list uses the quieter variant so it
                        // reads as "done", not "active".
                        bgcolor: projectColorForId(group.projectId, mode)[activeStat === "done" ? "muted" : "strong"],
                        boxShadow: (theme) => `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.18)}`,
                      }}
                    />
                    <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", overflowWrap: "anywhere" }}>
                      {group.projectName}
                    </Typography>
                  </Box>
                  <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                    {group.items.map((it) => (
                      <TaskRow key={it.id} it={it} activeStat={activeStat} today={today} />
                    ))}
                  </Box>
                </Box>
              ))
            ) : (
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {items.map((it) => (
                  <TaskRow key={it.id} it={it} activeStat={activeStat} today={today} />
                ))}
              </Box>
            )}
            {listIsPartial && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", py: 1.5 }}>
                {activeStat === "open"
                  ? `Showing the ${items.length} due soonest of ${totalForList}.`
                  : `Showing the ${items.length} most recently updated of ${totalForList}.`}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function TaskRow({ it, activeStat, today }) {
  const overdue = activeStat === "open" && isOverdue(it.dueDate, today);
  return (
    <Box component="li" sx={{ borderBottom: "1px solid", borderColor: "divider", "&:last-of-type": { borderBottom: "none" } }}>
      <Box
        component={Link}
        href={it.href}
        sx={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 2,
          mx: -1.5,
          px: 1.5,
          py: 1.25,
          borderRadius: 1,
          color: "text.primary",
          textDecoration: "none",
          transition: "background-color .12s ease",
          "&:hover": { backgroundImage: "var(--brand-gradient-subtle)" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
            {it.primary}
          </Typography>
          {it.secondary && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {it.secondary}
            </Typography>
          )}
        </Box>
        {it.dueDate && (
          <Typography
            variant="caption"
            sx={{ flexShrink: 0, color: overdue ? "error.main" : "text.secondary", fontWeight: overdue ? 600 : 400, fontVariantNumeric: "tabular-nums" }}
          >
            {overdue ? "Overdue " : "Due "}
            {formatDateOnly(it.dueDate, { month: "short", day: "numeric" })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
