"use client";

import { Box, Card, CardContent, Typography, AvatarGroup, Avatar, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { useThemeMode } from "@/components/ThemeModeContext";
import { resolveTaskColor } from "@/lib/taskColors";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";
import { formatDateOnly } from "@/lib/dateOnly";
import { isOverdue, localTodayYmd } from "@/lib/dueStatus";
import { compareColumns } from "@/lib/columnOrderCompare";
import { compareTasks } from "@/lib/taskOrderCompare";
import EmptyState from "@/components/EmptyState";

// A deliberately non-interactive echo of TaskCard (see
// components/TaskCard.jsx) — same visual language (color, checkbox,
// footer chips) but no drag handle, no click target, no delete button,
// and the completion checkbox is a plain icon rather than a button.
// TaskCard itself isn't reused here because even its `canEdit={false}`
// mode still wires the checkbox up to a "request a change" flow that
// only makes sense for a signed-in project member — an anonymous public
// viewer has no action to take on a task at all.
function ReadOnlyTaskCard({ task }) {
  const { mode } = useThemeMode();
  const cardColor = resolveTaskColor(task.color, mode);
  const completed = !!task.completed;
  const overdue = !completed && isOverdue(task.dueDate, localTodayYmd());
  const hasFooter = !!task.dueDate || task.attachments.length > 0 || task.assignees.length > 0;

  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        bgcolor: cardColor || "background.paper",
        borderColor: cardColor ? alpha(theme.palette.text.primary, 0.1) : "divider",
        boxShadow: theme.tf.shadow.card,
        position: "relative",
        "&::before": completed
          ? { content: '""', position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--brand-gradient-strong)", borderRadius: "6px 0 0 6px", opacity: 0.85 }
          : undefined,
      })}
    >
      <CardContent sx={{ p: "10px 12px !important" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75 }}>
          {completed ? (
            <CheckCircleIcon aria-label="Completed" sx={{ fontSize: 18, mt: 0.1, color: "success.main", flexShrink: 0 }} />
          ) : (
            <RadioButtonUncheckedIcon aria-label="Not completed" sx={{ fontSize: 18, mt: 0.1, color: "text.secondary", flexShrink: 0 }} />
          )}
          <Typography
            variant="body2"
            sx={{
              flexGrow: 1,
              fontWeight: 500,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
              textDecoration: completed ? "line-through" : "none",
              color: completed ? "text.secondary" : "text.primary",
            }}
          >
            {task.title}
          </Typography>
        </Box>

        {task.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", mt: 0.5, overflowWrap: "anywhere" }}
          >
            {task.description}
          </Typography>
        )}

        {hasFooter && (
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, mt: 1.25, minHeight: 22 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flexWrap: "wrap" }}>
              {task.dueDate && (
                <Typography
                  variant="caption"
                  sx={{ color: overdue ? "error.main" : "text.secondary", fontWeight: overdue ? 600 : 400, fontVariantNumeric: "tabular-nums" }}
                >
                  {overdue ? "Overdue " : "Due "}
                  {formatDateOnly(task.dueDate, { month: "short", day: "numeric" })}
                </Typography>
              )}
              {task.attachments.length > 0 && (
                <Box
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, color: "text.secondary" }}
                  aria-label={`${task.attachments.length} attached ${task.attachments.length === 1 ? "file" : "files"}`}
                >
                  <AttachFileIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">{task.attachments.length}</Typography>
                </Box>
              )}
            </Box>
            {task.assignees.length > 0 && (
              <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 22, height: 22, fontSize: 11, borderColor: cardColor || "background.paper" } }}>
                {task.assignees.map((a) => (
                  <Tooltip key={a.id} title={a.name || "Unnamed"}>
                    <Avatar aria-label={a.name || "Unnamed"} sx={{ bgcolor: pastelForString(a.id, mode) }}>
                      {avatarInitial(a.name)}
                    </Avatar>
                  </Tooltip>
                ))}
              </AvatarGroup>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// The board itself: same column-strip layout as KanbanBoard, minus every
// affordance that implies an action is possible (add task, add column,
// rename, drag, delete, column menu). `columns`/`tasks` are the shared
// DTOs from GET /api/shared/board/[token] (see lib/serialize.js's
// toSharedBoardDTO) — already stripped of anything an anonymous viewer
// shouldn't see.
export default function SharedBoardView({ columns, tasks }) {
  const sortedColumns = [...columns].sort(compareColumns);

  if (sortedColumns.length === 0) {
    return <EmptyState title="No board yet" description="This project doesn't have any columns to show." />;
  }

  return (
    <Box
      role="region"
      aria-label="Project board (read-only)"
      sx={{
        display: "flex",
        gap: 1.5,
        overflowX: "auto",
        pb: 1.5,
        alignItems: "flex-start",
        "&::-webkit-scrollbar": { height: 8 },
        "&::-webkit-scrollbar-thumb": { bgcolor: "line.strong", borderRadius: 4 },
      }}
    >
      {sortedColumns.map((column) => {
        const colTasks = tasks.filter((t) => t.columnId === column.id).sort(compareTasks);
        return (
          <Box key={column.id} sx={{ flex: { xs: "0 0 84%", sm: "0 0 288px" } }}>
            <Box
              sx={(theme) => ({
                p: 1,
                minHeight: 160,
                borderRadius: 2,
                bgcolor: "var(--brand-surface-tint)",
                border: "1px solid",
                borderColor: theme.palette.divider,
              })}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1, pl: 1, pr: 0.25, minHeight: 32 }}>
                <Typography variant="subtitle2" noWrap title={column.name} sx={{ flexGrow: 1, minWidth: 0 }}>
                  {column.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", px: 0.25 }}
                  aria-label={`${colTasks.length} ${colTasks.length === 1 ? "task" : "tasks"}`}
                >
                  {colTasks.length}
                </Typography>
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                {colTasks.map((task) => (
                  <ReadOnlyTaskCard key={task.id} task={task} />
                ))}
                {colTasks.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, py: 1.5 }}>
                    No tasks yet
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
