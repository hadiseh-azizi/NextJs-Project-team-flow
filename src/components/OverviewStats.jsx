"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { formatDateOnly } from "@/lib/dateOnly";
import { isOverdue, localTodayYmd } from "@/lib/dueStatus";

// Three numbers that double as a switch: choosing one lists what is behind
// it right underneath. "My open tasks" is open by default because it is the
// one list that tells you what to do next.
export default function OverviewStats({ projects, userId }) {
  const [activeStat, setActiveStat] = useState("open");
  // Set after mount so server and client markup agree; overdue flags appear
  // one frame later.
  const [today, setToday] = useState(null);
  useEffect(() => {
    setToday(localTodayYmd());
  }, []);

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
  // Soonest due date first; tasks without one keep their existing order at the end.
  const myOpenTasks = allTasks
    .filter((t) => t.assignees.some((a) => a.id === userId) && !t.isDone)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ad = a.t.dueDate ? new Date(a.t.dueDate).getTime() : Infinity;
      const bd = b.t.dueDate ? new Date(b.t.dueDate).getTime() : Infinity;
      return ad === bd ? a.i - b.i : ad - bd;
    })
    .map(({ t }) => t);

  const stats = [
    { key: "open", label: "My open tasks", value: myOpenTasks.length },
    { key: "done", label: "Tasks completed", value: `${doneTasks.length}/${allTasks.length}` },
    { key: "projects", label: "Active projects", value: projects.length },
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
    items = myOpenTasks.map((t) => ({
      id: t.id,
      primary: t.title,
      secondary: t.projectName,
      dueDate: t.dueDate,
      href: `/dashboard/projects/${t.projectId}`,
    }));
    emptyLabel = "No open tasks assigned to you.";
  }

  return (
    <Box>
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
                  bgcolor: "primary.main",
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
        {activeStat &&
          (items.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
              {emptyLabel}
            </Typography>
          ) : (
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {items.map((it) => {
                const overdue = activeStat === "open" && isOverdue(it.dueDate, today);
                return (
                  <Box component="li" key={it.id} sx={{ borderBottom: "1px solid", borderColor: "divider", "&:last-of-type": { borderBottom: "none" } }}>
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
                        "&:hover": { bgcolor: "action.hover" },
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
              })}
            </Box>
          ))}
      </Box>
    </Box>
  );
}
