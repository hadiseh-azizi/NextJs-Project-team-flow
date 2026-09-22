"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, Box, Typography, IconButton, AvatarGroup, Avatar, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { useThemeMode } from "@/components/ThemeModeContext";
import { resolveTaskColor } from "@/lib/taskColors";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";
import { formatDateOnly } from "@/lib/dateOnly";
import { isOverdue, localTodayYmd } from "@/lib/dueStatus";

export default function TaskCard({ task, onDragStart, onDragOverCard, onDelete, onOpen, dropIndicator, isDone = false }) {
  const { mode } = useThemeMode();
  const cardColor = resolveTaskColor(task.color, mode);
  const [dragging, setDragging] = useState(false);
  const dragTimer = useRef(null);
  useEffect(() => () => clearTimeout(dragTimer.current), []);

  // A task in the final column is finished, so its due date can't be late.
  const overdue = !isDone && isOverdue(task.dueDate, localTodayYmd());

  // Dragging has no keyboard equivalent, but opening a task doesn't need
  // one: the card itself is focusable and Enter/Space opens it, and the
  // "Column" field inside the task dialog lets a keyboard-only user move
  // it between columns without dragging at all.
  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(task);
    }
  }

  const hasFooter = !!task.dueDate || task.attachments.length > 0 || task.assignees.length > 0;

  return (
    <Box sx={{ position: "relative" }}>
      {dropIndicator === "before" && (
        <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1, mb: 0.5 }} />
      )}
      <Card
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Open task: ${task.title}`}
        onDragStart={(e) => {
          onDragStart(e, task.id);
          // Dim the original a tick later — changing the DOM inside
          // dragstart itself can cancel the drag in some browsers.
          dragTimer.current = setTimeout(() => setDragging(true), 0);
        }}
        onDragEnd={() => {
          clearTimeout(dragTimer.current);
          setDragging(false);
        }}
        onDragOver={(e) => onDragOverCard(e, task)}
        onClick={() => onOpen(task)}
        onKeyDown={handleKeyDown}
        sx={(theme) => ({
          cursor: "grab",
          bgcolor: cardColor || "background.paper",
          borderColor: cardColor ? alpha(theme.palette.text.primary, 0.1) : "divider",
          boxShadow: theme.tf.shadow.card,
          opacity: dragging ? 0.45 : 1,
          transition: "box-shadow .12s ease, border-color .12s ease, opacity .12s ease",
          "&:active": { cursor: "grabbing" },
          "&:hover": { borderColor: theme.palette.line.strong, boxShadow: theme.tf.shadow.raised },
          "&:hover .task-delete-btn, &:focus-within .task-delete-btn": { opacity: 1 },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        })}
      >
        <CardContent sx={{ p: "10px 12px !important" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.4, overflowWrap: "anywhere" }}>
              {task.title}
            </Typography>
            <IconButton
              size="small"
              className="task-delete-btn"
              sx={{
                opacity: 0,
                // No hover on touch screens, so the button stays faintly
                // visible there instead of being unreachable.
                "@media (hover: none)": { opacity: 0.7 },
                transition: "opacity .12s ease, background-color .12s ease, color .12s ease",
                mt: -0.5,
                mr: -0.75,
                p: 0.5,
                "&:hover": { color: "error.main" },
                "&:focus-visible": { opacity: 1, color: "error.main" },
              }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={`Delete task: ${task.title}`}
            >
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
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
                <AvatarGroup
                  max={4}
                  sx={{ "& .MuiAvatar-root": { width: 22, height: 22, fontSize: 11, borderColor: cardColor || "background.paper" } }}
                >
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
      {dropIndicator === "after" && (
        <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1, mt: 0.5 }} />
      )}
    </Box>
  );
}
