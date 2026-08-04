"use client";

import { Card, CardContent, Box, Typography, IconButton, AvatarGroup, Avatar, Chip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";

export default function TaskCard({ task, onDragStart, onDragOverCard, onDelete, onOpen, dropIndicator }) {
  return (
    <Box sx={{ position: "relative" }}>
      {dropIndicator === "before" && (
        <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1, mb: 0.5, mx: 0.5 }} />
      )}
      <Card
        draggable
        onDragStart={(e) => onDragStart(e, task.id)}
        onDragOver={(e) => onDragOverCard(e, task)}
        onClick={() => onOpen(task)}
        sx={{
          cursor: "grab",
          bgcolor: "background.paper",
          "&:active": { cursor: "grabbing" },
          "&:hover .task-delete-btn": { opacity: 1 },
          "&:hover": { borderColor: "#E8B8A3", boxShadow: "0 2px 10px rgba(28,27,25,0.06)" },
        }}
      >
        <CardContent sx={{ p: "12px !important" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.4 }}>
              {task.title}
            </Typography>
            <IconButton
              size="small"
              className="task-delete-btn"
              sx={{ opacity: 0, transition: "opacity .15s", mt: -0.5, mr: -0.5, color: "text.disabled", "&:hover": { color: "error.main" } }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task);
              }}
              aria-label="Delete task"
            >
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Box>

          {task.description && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
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
              <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 22, height: 22, fontSize: 11, borderColor: "background.paper" } }}>
                {task.assignees.map((a) => (
                  <Avatar key={a.id} sx={{ bgcolor: "primary.main" }}>
                    {a.name.slice(0, 1)}
                  </Avatar>
                ))}
              </AvatarGroup>
            )}
          </Box>

          {task.dueDate && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              Due date: {new Date(task.dueDate).toLocaleDateString("en-US")}
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
