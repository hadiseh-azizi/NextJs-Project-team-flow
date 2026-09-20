"use client";

import { useRef, useState } from "react";
import {
  Box, Paper, Typography, IconButton, TextField, Menu, MenuItem, Tooltip, Alert, Snackbar,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import TaskCard from "@/components/TaskCard";
import TaskDetailDialog from "@/components/TaskDetailDialog";
import NewTaskModal from "@/components/NewTaskModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import FadeInStagger from "@/components/FadeInStagger";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { compareTasks, currentSiblingIndex } from "@/lib/taskOrderCompare";
import { compareColumns } from "@/lib/columnOrderCompare";
import { useIsMounted } from "@/lib/clientAsync";

export default function KanbanBoard({ projectId, columns, tasks, onChanged, assignableUsers }) {
  const isMounted = useIsMounted();
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
  const [addingColumnSubmitting, setAddingColumnSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null);
  const [deleteTaskError, setDeleteTaskError] = useState("");
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState(null);
  const [deleteColumnError, setDeleteColumnError] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Tasks with a move request currently in flight — a card can only be
  // dropped again once its previous move has resolved, so two overlapping
  // PATCHes for the same task (and the ordering confusion that would
  // cause) can't happen.
  const movingTaskIds = useRef(new Set());
  // Guards per-column single-flight requests that have no other in-flight
  // tracking of their own: renaming (the field can trigger a save from
  // both onBlur and onKeyDown/Enter, which can fire close enough together
  // to both start a request for the same column) and toggling the "done"
  // column flag (keyed as `done:${columnId}` to share this one Set
  // without colliding with a rename in flight for the same column).
  const renamingInFlight = useRef(new Set());

  const sortedColumns = [...columns].sort(compareColumns);
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
  // card) — means "drop at the end of this column". This fires whenever
  // the pointer is over the column's Paper but not over a card (cards
  // stop propagation in handleCardDragOver, so this never fires while
  // hovering a card itself) — including the gap below the last card, so
  // moving off a card into empty space must always resolve to "end", not
  // whatever card was last hovered. The functional update still skips the
  // setState when nothing would actually change (already "end" for this
  // column), to avoid re-rendering on every pixel of pointer movement —
  // it just no longer confuses "already end" with "was previously over a
  // card in this column".
  function handleColumnDragOver(e, columnId) {
    e.preventDefault();
    setDragOverCol(columnId);
    setDropTarget((prev) =>
      prev && prev.columnId === columnId && prev.position === "end" && !prev.taskId
        ? prev
        : { columnId, position: "end" }
    );
  }

  async function handleDrop(e, columnId) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    const target = dropTarget && dropTarget.columnId === columnId ? dropTarget : { columnId, position: "end" };
    setDragOverCol(null);
    setDropTarget(null);

    // Dropped on itself (e.g. hovered the card being dragged) — harmless,
    // nothing to do.
    if (!taskId || target.taskId === taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // A move for this task is already in flight — ignore this drop rather
    // than firing a second overlapping PATCH for the same card (whichever
    // response landed last would win, silently discarding the other move).
    if (movingTaskIds.current.has(taskId)) return;

    // The server is authoritative on the actual order values (integers,
    // rebalanced as needed — see lib/taskOrdering.js) — the client only
    // asks for a position among the destination column's other tasks.
    const siblings = tasks
      .filter((t) => t.columnId === columnId && t.id !== taskId)
      .sort(compareTasks);

    let targetIndex;
    if (target.position === "end" || !target.taskId) {
      targetIndex = siblings.length;
    } else {
      const idx = siblings.findIndex((t) => t.id === target.taskId);
      targetIndex = target.position === "before" ? idx : idx + 1;
    }

    // No-op if this is exactly where the task already sits. Uses the same
    // compareTasks tie-break `siblings` was sorted with (order, then
    // createdAt, then id) rather than a bare `order` comparison — with
    // duplicate `order` values (see lib/taskOrdering.js, which tolerates
    // these under concurrent writes), a bare comparison can place the
    // task's "current" index somewhere other than where it's actually
    // rendered, which would either silently drop a real move or fire an
    // unnecessary one. See lib/taskOrderCompare.js for details.
    if (task.columnId === columnId) {
      const effectiveCurrentIndex = currentSiblingIndex(task, siblings);
      if (effectiveCurrentIndex === targetIndex) return;
    }

    movingTaskIds.current.add(taskId);
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, targetIndex }),
      });
      if (isMounted()) onChanged();
    } catch (err) {
      // Local state was never mutated optimistically — it comes from
      // `tasks`/`onChanged()` (a server refetch) — so a failed move
      // leaves the board exactly as it was before the drag, no stale
      // "task looks moved but isn't" state to undo.
      if (isMounted()) setError(errorMessage(err, "Couldn't move the task. Please try again."));
    } finally {
      movingTaskIds.current.delete(taskId);
    }
  }

  async function confirmTaskDelete() {
    if (!confirmDeleteTask || deleting) return;
    setDeleting(true);
    setDeleteTaskError("");
    try {
      await apiFetch(`/api/tasks/${confirmDeleteTask.id}`, { method: "DELETE" });
      if (!isMounted()) return;
      setConfirmDeleteTask(null);
      onChanged();
    } catch (err) {
      // Keep the confirmation open so the error is actually visible —
      // it would otherwise render behind this still-open dialog.
      if (isMounted()) setDeleteTaskError(errorMessage(err, "Couldn't delete the task. Please try again."));
    } finally {
      if (isMounted()) setDeleting(false);
    }
  }

  async function handleAddColumn(e) {
    e.preventDefault();
    if (!newColumnName.trim() || addingColumnSubmitting) return;
    setAddingColumnSubmitting(true);
    try {
      await apiFetch(`/api/projects/${projectId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newColumnName }),
      });
      if (!isMounted()) return;
      setNewColumnName("");
      setAddingColumn(false);
      onChanged();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't add the column. Please try again."));
    } finally {
      if (isMounted()) setAddingColumnSubmitting(false);
    }
  }

  async function handleRenameColumn(columnId) {
    const trimmed = renameValue.trim();
    const current = columns.find((c) => c.id === columnId);
    if (!trimmed || (current && trimmed === current.name)) {
      setRenamingId(null);
      return;
    }
    // The field commits on both blur and Enter, which can fire close
    // enough together (Enter, then the resulting blur) to both reach here
    // for the same column before the first request finishes — only let
    // one PATCH for a given column be in flight at a time.
    if (renamingInFlight.current.has(columnId)) return;
    renamingInFlight.current.add(columnId);
    try {
      await apiFetch(`/api/projects/${projectId}/columns/${columnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue }),
      });
      if (isMounted()) onChanged();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't rename the column. Please try again."));
    } finally {
      renamingInFlight.current.delete(columnId);
      if (isMounted()) setRenamingId(null);
    }
  }

  async function handleToggleDoneColumn(column) {
    // The menu item that triggers this is removed from the DOM as soon as
    // the menu closes below, so a literal double-click can't reach it
    // twice — this guard is for the same class of fast-repeat trigger the
    // rename/move handlers above already guard against (e.g. assistive
    // tech re-dispatching the activation event), kept consistent with
    // those rather than because it's been observed here specifically.
    if (renamingInFlight.current.has(`done:${column.id}`)) return;
    renamingInFlight.current.add(`done:${column.id}`);
    setMenuAnchor(null);
    try {
      await apiFetch(`/api/projects/${projectId}/columns/${column.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDoneColumn: !column.isDoneColumn }),
      });
      if (isMounted()) onChanged();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't update the column. Please try again."));
    } finally {
      renamingInFlight.current.delete(`done:${column.id}`);
    }
  }

  async function confirmColumnDelete() {
    if (!confirmDeleteColumn || deleting) return;
    setDeleting(true);
    setDeleteColumnError("");
    try {
      await apiFetch(`/api/projects/${projectId}/columns/${confirmDeleteColumn.id}`, { method: "DELETE" });
      if (!isMounted()) return;
      setConfirmDeleteColumn(null);
      onChanged();
    } catch (err) {
      // Deletion very commonly fails here because the column still has
      // tasks in it — that's expected and explained in the dialog's own
      // message, so the dialog should stay open with the reason visible
      // rather than closing and losing that context.
      if (isMounted()) setDeleteColumnError(errorMessage(err, "This column can't be deleted"));
    } finally {
      if (isMounted()) setDeleting(false);
    }
  }

  return (
    <>
      <Box
        role="region"
        aria-label="Kanban board columns"
        tabIndex={0}
        sx={{
          display: "flex",
          gap: 2,
          overflowX: "auto",
          pb: 1,
          alignItems: "flex-start",
          "&::-webkit-scrollbar": { height: 6 },
          "&::-webkit-scrollbar-thumb": { bgcolor: "grey.300", borderRadius: 3 },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
        }}
      >
        {sortedColumns.map((column, columnIndex) => {
          const colTasks = tasks.filter((t) => t.columnId === column.id).sort(compareTasks);
          const isOver = dragOverCol === column.id;
          const colDropTarget = dropTarget && dropTarget.columnId === column.id ? dropTarget : null;
          return (
            <FadeInStagger key={column.id} index={columnIndex} base={200} sx={{ flex: { xs: "0 0 82%", sm: "0 0 300px", md: "0 0 300px" } }}>
            <Paper
              variant="outlined"
              onDragOver={(e) => handleColumnDragOver(e, column.id)}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, column.id)}
              sx={(theme) => ({
                p: 1.5,
                minHeight: 340,
                bgcolor: isOver ? alpha(theme.palette.primary.main, 0.06) : "grey.50",
                borderColor: isOver ? "primary.main" : "divider",
                borderWidth: isOver ? 2 : 1,
                transition: "background-color .15s, border-color .15s",
              })}
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
                    onFocus={(e) => e.target.select()}
                    onBlur={() => handleRenameColumn(column.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleRenameColumn(column.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    inputProps={{ "aria-label": `Rename column ${column.name}` }}
                    sx={{ flexGrow: 1, "& .MuiOutlinedInput-input": { py: 0.5 } }}
                  />
                ) : (
                  <Typography
                    component="span"
                    role="button"
                    tabIndex={0}
                    variant="subtitle2"
                    noWrap
                    title={column.name}
                    aria-label={`Rename column ${column.name}`}
                    onClick={() => {
                      setRenamingId(column.id);
                      setRenameValue(column.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setRenamingId(column.id);
                        setRenameValue(column.name);
                      }
                    }}
                    sx={{
                      flexGrow: 1,
                      minWidth: 0,
                      cursor: "text",
                      "&:hover": { color: "primary.main" },
                      "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px", borderRadius: 0.5 },
                    }}
                  >
                    {column.name}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  {colTasks.length}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`${column.name} column options`}
                  aria-haspopup="true"
                  onClick={(e) => {
                    setMenuAnchor(e.currentTarget);
                    setMenuColumn(column);
                  }}
                >
                  <MoreHorizIcon fontSize="small" />
                </IconButton>
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {colTasks.map((task, taskIndex) => (
                  <FadeInStagger key={task.id} index={taskIndex} base={140} duration={0.4}>
                    <TaskCard
                      task={task}
                      onDragStart={handleDragStart}
                      onDragOverCard={(e, t) => handleCardDragOver(e, column.id, t)}
                      onDelete={(t) => {
                        setDeleteTaskError("");
                        setConfirmDeleteTask(t);
                      }}
                      onOpen={(t) => setOpenTaskId(t.id)}
                      dropIndicator={colDropTarget?.taskId === task.id ? colDropTarget.position : null}
                    />
                  </FadeInStagger>
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
                component="button"
                type="button"
                onClick={() => setNewTaskColumnId(column.id)}
                aria-label={`Add task to ${column.name}`}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.5, mt: 1, px: 1, py: 0.75, width: "100%",
                  border: "none", bgcolor: "transparent", font: "inherit", textAlign: "left",
                  borderRadius: 1.5, cursor: "pointer", color: "text.secondary",
                  "&:hover": { bgcolor: "action.hover", color: "primary.main" },
                  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" },
                }}
              >
                <AddIcon sx={{ fontSize: 17 }} />
                <Typography variant="caption" fontWeight={600}>
                  Add task
                </Typography>
              </Box>
            </Paper>
            </FadeInStagger>
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
                inputProps={{ "aria-label": "New column name" }}
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                onBlur={() => !newColumnName.trim() && !addingColumnSubmitting && setAddingColumn(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setAddingColumn(false);
                    setNewColumnName("");
                  }
                }}
                disabled={addingColumnSubmitting}
                sx={{ mb: 1 }}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Box
                  component="button"
                  type="submit"
                  disabled={addingColumnSubmitting}
                  sx={{
                    border: "none", cursor: "pointer", bgcolor: "primary.main", color: "white",
                    borderRadius: 1, px: 1.5, py: 0.5, fontSize: 13, fontWeight: 600, font: "inherit",
                    "&:disabled": { cursor: "default", opacity: 0.6 },
                    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
                  }}
                >
                  {addingColumnSubmitting ? "Adding..." : "Add"}
                </Box>
                <Box
                  component="button"
                  type="button"
                  disabled={addingColumnSubmitting}
                  onClick={() => setAddingColumn(false)}
                  sx={{
                    border: "none", cursor: "pointer", bgcolor: "transparent", color: "text.secondary", fontSize: 13, font: "inherit",
                    "&:disabled": { cursor: "default", opacity: 0.6 },
                    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
                  }}
                >
                  Cancel
                </Box>
              </Box>
            </Paper>
          ) : (
            <Box
              component="button"
              type="button"
              onClick={() => setAddingColumn(true)}
              sx={(theme) => ({
                display: "flex", alignItems: "center", gap: 0.75, p: 1.5, width: "100%", borderRadius: 2,
                border: "1.5px dashed", borderColor: "grey.300", cursor: "pointer", color: "text.secondary",
                bgcolor: "transparent", font: "inherit", textAlign: "left",
                "&:hover": { borderColor: "primary.main", color: "primary.main", bgcolor: alpha(theme.palette.primary.main, 0.05) },
                "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
              })}
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
            setDeleteColumnError("");
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
        onClose={() => {
          setConfirmDeleteTask(null);
          setDeleteTaskError("");
        }}
        loading={deleting}
        error={deleteTaskError}
      />

      <ConfirmDialog
        open={!!confirmDeleteColumn}
        title="Delete column"
        message={confirmDeleteColumn ? `Column “${confirmDeleteColumn.name}” will be deleted. If it still has tasks in it, the deletion will fail.` : ""}
        onConfirm={confirmColumnDelete}
        onClose={() => {
          setConfirmDeleteColumn(null);
          setDeleteColumnError("");
        }}
        loading={deleting}
        error={deleteColumnError}
      />

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError("")}>
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
