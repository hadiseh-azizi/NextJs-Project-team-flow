"use client";

import { Card, CardContent, Box, Typography, IconButton, AvatarGroup, Avatar, Chip, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { useThemeMode } from "@/components/ThemeModeContext";
import { resolveTaskColor } from "@/lib/taskColors";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";
import { formatDateOnly } from "@/lib/dateOnly";

export default function TaskCard({ task, onDragStart, onDragOverCard, onDelete, onOpen, dropIndicator }) {
  const { mode } = useThemeMode();
  const cardColor = resolveTaskColor(task.color, mode);

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

  return (
    <Box sx={{ position: "relative" }}>
      {dropIndicator === "before" && (
        <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1, mb: 0.5, mx: 0.5 }} />
      )}
      <Card
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Open task: ${task.title}`}
        onDragStart={(e) => onDragStart(e, task.id)}
        onDragOver={(e) => onDragOverCard(e, task)}
        onClick={() => onOpen(task)}
        onKeyDown={handleKeyDown}
        sx={{
          cursor: "grab",
          bgcolor: cardColor || "background.paper",
          "&:active": { cursor: "grabbing" },
          "&:hover .task-delete-btn, &:focus-within .task-delete-btn": { opacity: 1 },
          "&:hover": { borderColor: "#D6B78A" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
        }}
      >
        <CardContent sx={{ p: "12px !important" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.4, overflowWrap: "anywhere" }}>
              {task.title}
            </Typography>
            <IconButton
              size="small"
              className="task-delete-btn"
              sx={{
                opacity: 0,
                transition: "opacity .15s",
                mt: -0.5,
                mr: -0.5,
                color: "text.disabled",
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
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Box>

          {task.description && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
              {task.description}
            </Typography>
          )}

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="caption" color="text.disabled" fontFamily="monospace">
                #{task.id.slice(-5)}
              </Typography>
              {task.attachments.length > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<AttachFileIcon sx={{ fontSize: 13 }} />}
                  label={task.attachments.length}
                  sx={{ height: 19, "& .MuiChip-label": { px: 0.65, fontSize: 11 }, color: "text.secondary" }}
                />
              )}
            </Box>
            {task.assignees.length > 0 && (
              <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 22, height: 22, fontSize: 11, borderColor: cardColor || "background.paper" } }}>
                {task.assignees.map((a) => (
                  <Tooltip key={a.id} title={a.name || "Unnamed"}>
                    <Avatar sx={{ bgcolor: pastelForString(a.id, mode), color: mode === "dark" ? "#F1EEFB" : "#221F2E" }}>
                      {avatarInitial(a.name)}
                    </Avatar>
                  </Tooltip>
                ))}
              </AvatarGroup>
            )}
          </Box>

          {task.dueDate && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              Due date: {formatDateOnly(task.dueDate)}
            </Typography>
          )}
        </CardContent>
      </Card>
      {dropIndicator === "after" && (
        <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1, mt: 0.5, mx: 0.5 }} />
      )}
    </Box>
  );
}
