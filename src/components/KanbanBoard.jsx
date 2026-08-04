"use client";

import { useState } from "react";
import {
  Box, Paper, Typography, IconButton, TextField, Menu, MenuItem, Tooltip, Alert, Snackbar,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import TaskCard from "@/components/TaskCard";
import TaskDetailDialog from "@/components/TaskDetailDialog";
import NewTaskModal from "@/components/NewTaskModal";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function KanbanBoard({ projectId, columns, tasks, onChanged, assignableUsers }) {
  const [dragOverCol, setDragOverCol] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { columnId, taskId, position } | { columnId, position: "end" }
  const [openTaskId, setOpenTaskId] = useState(null);
  const [newTaskColumnId, setNewTaskColumnId] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuColumn, setMenuColumn] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [error, setError] = useState("");
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null);
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
  const openTask = tasks.find((t) => t.id === openTaskId) || null;

  function handleDragStart(e, taskId) {
    e.dataTransfer.setData("text/plain", taskId);
  }

  // Fired while dragging over a specific card — figures out whether the
  // pointer is in the top or bottom half of that card, which decides
  // whether the dragged task lands before or after it.
  function handleCardDragOver(e, columnId, task) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const position = e.clientY < midpoint ? "before" : "after";
    setDragOverCol(columnId);
    setDropTarget({ columnId, taskId: task.id, position });
  }

  // Fired over the empty background of a column (not over any specific
  // card) — means "drop at the end of this column".
  function handleColumnDragOver(e, columnId) {
    e.preventDefault();
    setDragOverCol(columnId);
    setDropTarget((prev) => (prev && prev.columnId === columnId && prev.taskId ? prev : { columnId, position: "end" }));
  }

  async function handleDrop(e, columnId) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    const target = dropTarget && dropTarget.columnId === columnId ? dropTarget : { columnId, position: "end" };
    setDragOverCol(null);
    setDropTarget(null);

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const siblings = tasks
      .filter((t) => t.columnId === columnId && t.id !== taskId)
      .sort((a, b) => a.order - b.order);

    let newOrder;
    if (siblings.length === 0) {
      newOrder = 0;
    } else if (target.position === "end" || !target.taskId) {
      newOrder = siblings[siblings.length - 1].order + 1;
    } else {
      const idx = siblings.findIndex((t) => t.id === target.taskId);
      if (target.position === "before") {
        const prevOrder = idx > 0 ? siblings[idx - 1].order : siblings[idx].order - 1;
        newOrder = (prevOrder + siblings[idx].order) / 2;
      } else {
        const nextOrder = idx < siblings.length - 1 ? siblings[idx + 1].order : siblings[idx].order + 1;
        newOrder = (siblings[idx].order + nextOrder) / 2;
      }
    }

    if (task.columnId === columnId && task.order === newOrder) return;

    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId, order: newOrder }),
    });
    onChanged();
  }

  async function confirmTaskDelete() {
    if (!confirmDeleteTask) return;
    setDeleting(true);
    await fetch(`/api/tasks/${confirmDeleteTask.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDeleteTask(null);
    onChanged();
  }

  async function handleAddColumn(e) {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    await fetch(`/api/projects/${projectId}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newColumnName }),
    });
    setNewColumnName("");
    setAddingColumn(false);
    onChanged();
  }

  async function handleRenameColumn(columnId) {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/projects/${projectId}/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue }),
    });
    setRenamingId(null);
    onChanged();
  }

  async function handleToggleDoneColumn(column) {
    setMenuAnchor(null);
    await fetch(`/api/projects/${projectId}/columns/${column.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDoneColumn: !column.isDoneColumn }),
    });
    onChanged();
  }

  async function confirmColumnDelete() {
    if (!confirmDeleteColumn) return;
    setDeleting(true);
    const res = await fetch(`/api/projects/${projectId}/columns/${confirmDeleteColumn.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDeleteColumn(null);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "This column can't be deleted");
      return;
    }
    onChanged();
  }

  return (
    <>
      <Box
        sx={{
          display: "flex",
          gap: 2,
          overflowX: "auto",
          pb: 1,
          alignItems: "flex-start",
          "&::-webkit-scrollbar": { height: 6 },
          "&::-webkit-scrollbar-thumb": { bgcolor: "grey.300", borderRadius: 3 },
        }}
      >
        {sortedColumns.map((column) => {
          const colTasks = tasks.filter((t) => t.columnId === column.id).sort((a, b) => a.order - b.order);
          const isOver = dragOverCol === column.id;
          const colDropTarget = dropTarget && dropTarget.columnId === column.id ? dropTarget : null;
          return (
            <Paper
              key={column.id}
              variant="outlined"
              onDragOver={(e) => handleColumnDragOver(e, column.id)}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, column.id)}
              sx={{
                p: 1.5,
                minHeight: 340,
                flex: { xs: "0 0 82%", sm: "0 0 300px", md: "0 0 300px" },
                bgcolor: isOver ? "rgba(181,74,44,0.04)" : "grey.50",
                borderColor: isOver ? "primary.main" : "divider",
                borderWidth: isOver ? 2 : 1,
                transition: "background-color .15s, border-color .15s",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, px: 0.5, pt: 0.5 }}>
                {column.isDoneColumn && (
                  <Tooltip title="Final column — tasks here count as “done” in the progress report">
                    <CheckCircleIcon sx={{ fontSize: 15, color: "success.main", flexShrink: 0 }} />
                  </Tooltip>
                )}
                {renamingId === column.id ? (
                  <TextField
                    autoFocus
                    size="small"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => handleRenameColumn(column.id)}
                    onKeyDown={(e) => e.key === "Enter" && handleRenameColumn(column.id)}
                    sx={{ flexGrow: 1, "& .MuiOutlinedInput-input": { py: 0.5 } }}
                  />
                ) : (
                  <Typography
                    variant="subtitle2"
                    noWrap
                    title={column.name}
                    onClick={() => {
                      setRenamingId(column.id);
                      setRenameValue(column.name);
                    }}
                    sx={{ flexGrow: 1, minWidth: 0, cursor: "text", "&:hover": { color: "primary.main" } }}
                  >
                    {column.name}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  {colTasks.length}
                </Typography>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    setMenuAnchor(e.currentTarget);
                    setMenuColumn(column);
                  }}
                >
                  <MoreHorizIcon fontSize="small" />
                </IconButton>
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDragStart={handleDragStart}
                    onDragOverCard={(e, t) => handleCardDragOver(e, column.id, t)}
                    onDelete={setConfirmDeleteTask}
                    onOpen={(t) => setOpenTaskId(t.id)}
                    dropIndicator={colDropTarget?.taskId === task.id ? colDropTarget.position : null}
                  />
                ))}
                {colTasks.length === 0 && (
                  <Box sx={{ border: "1.5px dashed", borderColor: "grey.300", borderRadius: 2, py: 3, textAlign: "center" }}>
                    <Typography variant="caption" color="text.disabled">
                      No tasks here
                    </Typography>
                  </Box>
                )}
                {colDropTarget?.position === "end" && colTasks.length > 0 && (
                  <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1, mx: 0.5 }} />
                )}
              </Box>

              <Box
                onClick={() => setNewTaskColumnId(column.id)}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.5, mt: 1, px: 1, py: 0.75,
                  borderRadius: 1.5, cursor: "pointer", color: "text.secondary",
                  "&:hover": { bgcolor: "action.hover", color: "primary.main" },
                }}
              >
                <AddIcon sx={{ fontSize: 17 }} />
                <Typography variant="caption" fontWeight={600}>
                  Add task
                </Typography>
              </Box>
            </Paper>
          );
        })}

        <Box sx={{ flex: { xs: "0 0 82%", sm: "0 0 260px", md: "0 0 260px" } }}>
          {addingColumn ? (
            <Paper variant="outlined" component="form" onSubmit={handleAddColumn} sx={{ p: 1.5 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                placeholder="New column name"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                onBlur={() => !newColumnName.trim() && setAddingColumn(false)}
                sx={{ mb: 1 }}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Box
                  component="button"
                  type="submit"
                  sx={{
                    border: "none", cursor: "pointer", bgcolor: "primary.main", color: "white",
                    borderRadius: 1, px: 1.5, py: 0.5, fontSize: 13, fontWeight: 600,
                  }}
                >
                  Add
                </Box>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setAddingColumn(false)}
                  sx={{ border: "none", cursor: "pointer", bgcolor: "transparent", color: "text.secondary", fontSize: 13 }}
                >
                  Cancel
                </Box>
              </Box>
            </Paper>
          ) : (
            <Box
              onClick={() => setAddingColumn(true)}
              sx={{
                display: "flex", alignItems: "center", gap: 0.75, p: 1.5, borderRadius: 2,
                border: "1.5px dashed", borderColor: "grey.300", cursor: "pointer", color: "text.secondary",
                "&:hover": { borderColor: "primary.main", color: "primary.main", bgcolor: "rgba(181,74,44,0.03)" },
              }}
            >
              <AddIcon fontSize="small" />
              <Typography variant="body2" fontWeight={600}>
                New column
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setRenamingId(menuColumn.id);
            setRenameValue(menuColumn.name);
            setMenuAnchor(null);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem onClick={() => handleToggleDoneColumn(menuColumn)}>
          {menuColumn?.isDoneColumn ? (
            <>
              <CheckCircleIcon fontSize="small" sx={{ ml: 1, color: "success.main" }} /> Unmark as final column
            </>
          ) : (
            <>
              <CheckCircleOutlineIcon fontSize="small" sx={{ ml: 1 }} /> Mark as final column
            </>
          )}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConfirmDeleteColumn(menuColumn);
            setMenuAnchor(null);
          }}
          sx={{ color: "error.main" }}
        >
          Delete column
        </MenuItem>
      </Menu>

      {openTask && (
        <TaskDetailDialog
          task={openTask}
          columns={sortedColumns}
          assignableUsers={assignableUsers}
          onClose={() => setOpenTaskId(null)}
          onChanged={onChanged}
          onDeleted={() => {
            setOpenTaskId(null);
            onChanged();
          }}
        />
      )}

      {newTaskColumnId && (
        <NewTaskModal
          projectId={projectId}
          columnId={newTaskColumnId}
          columnName={sortedColumns.find((c) => c.id === newTaskColumnId)?.name}
          assignableUsers={assignableUsers}
          onClose={() => setNewTaskColumnId(null)}
          onCreated={onChanged}
        />
      )}

      <ConfirmDialog
        open={!!confirmDeleteTask}
        title="Delete task"
        message={confirmDeleteTask ? `“${confirmDeleteTask.title}” will be permanently deleted. Are you sure?` : ""}
        onConfirm={confirmTaskDelete}
        onClose={() => setConfirmDeleteTask(null)}
        loading={deleting}
      />

      <ConfirmDialog
        open={!!confirmDeleteColumn}
        title="Delete column"
        message={confirmDeleteColumn ? `Column “${confirmDeleteColumn.name}” will be deleted. If it still has tasks in it, the deletion will fail.` : ""}
        onConfirm={confirmColumnDelete}
        onClose={() => setConfirmDeleteColumn(null)}
        loading={deleting}
      />

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError("")}>
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
