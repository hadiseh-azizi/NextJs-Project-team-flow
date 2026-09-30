"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Typography, IconButton, TextField, Menu, MenuItem, Tooltip, Alert, Snackbar, Button,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import TaskCard from "@/components/TaskCard";
import CollapsedColumnRail from "@/components/CollapsedColumnRail";
import TaskDetailDialog from "@/components/TaskDetailDialog";
import NewTaskModal from "@/components/NewTaskModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import ChoiceDialog from "@/components/ChoiceDialog";
import RequestChangeDialog from "@/components/RequestChangeDialog";
import EmptyState from "@/components/EmptyState";
import FadeInStagger from "@/components/FadeInStagger";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { compareTasks, currentSiblingIndex } from "@/lib/taskOrderCompare";
import { compareColumns } from "@/lib/columnOrderCompare";
import { useIsMounted } from "@/lib/clientAsync";
import { applyColumnOrder } from "@/lib/columnReorder";
import { useColumnDragReorder } from "@/lib/useColumnDragReorder";
import { useCollapsedColumns } from "@/lib/useCollapsedColumns";
import { COLLAPSED_COLUMN_WIDTH, COLLAPSE_MS, COLLAPSE_EASE } from "@/lib/collapsedColumns";

// Name used when the user opts into creating a Completed column from the
// "task completed, but this board has no Completed column yet" prompt —
// see handleCreateCompletedColumnAndMove below. Purely a starting label;
// like any other column, it can be renamed afterwards.
const NEW_DONE_COLUMN_NAME = "Completed";

export default function KanbanBoard({ projectId, columns, tasks, onChanged, assignableUsers, canEdit = true }) {
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
  // Task ids currently playing their "removed" exit animation (see
  // TaskCard's `exiting` prop / .tf-exit) — held for one short beat after
  // the DELETE actually succeeds, purely cosmetic, before the refetch in
  // confirmTaskDelete() drops them from `tasks` for real.
  const [removingTaskIds, setRemovingTaskIds] = useState(() => new Set());
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState(null);
  const [deleteColumnError, setDeleteColumnError] = useState("");
  const [deleting, setDeleting] = useState(false);
  // The task a "Request change" dialog is currently open for (see
  // RequestChangeDialog) — set either from a task card's checkbox (via
  // handleToggleComplete, below) or from the task detail dialog's own
  // "Request change" button, when `canEdit` is false.
  const [requestChangeTask, setRequestChangeTask] = useState(null);
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

  // Step 1 of task completion: confirm before marking it completed at all.
  const [completingTask, setCompletingTask] = useState(null);
  const [completingBusy, setCompletingBusy] = useState(false);
  const [completingError, setCompletingError] = useState("");

  // Step 2, case A: a Completed column already exists — ask whether to
  // move the now-completed task there. Holds { task, column }.
  const [moveStep, setMoveStep] = useState(null);
  const [moveStepBusy, setMoveStepBusy] = useState(false);
  const [moveStepError, setMoveStepError] = useState("");

  // Step 2, case B: no Completed column exists yet — optionally offer to
  // create one and move the task into it. Holds { task }. Tracks the
  // column it creates so a failed move can be retried without creating a
  // second "Completed" column.
  const [noDoneColumnStep, setNoDoneColumnStep] = useState(null);
  const [noDoneColumnBusy, setNoDoneColumnBusy] = useState(false);
  const [noDoneColumnError, setNoDoneColumnError] = useState("");
  const createdDoneColumnId = useRef(null);

  const [notice, setNotice] = useState("");

  // Column reordering. `localOrder` is the optimistic order shown between
  // a drop and the server confirming it (null = just show the server's
  // order). It is never left in place after a failed save — see
  // handleReorderColumns.
  const [localOrder, setLocalOrder] = useState(null);
  const savingOrder = useRef(false);
  const boardRef = useRef(null);
  const dropMarkerRef = useRef(null);
  const liveRegionRef = useRef(null);

  const serverSortedColumns = useMemo(() => [...columns].sort(compareColumns), [columns]);
  const serverOrderKey = serverSortedColumns.map((c) => c.id).join(",");
  const sortedColumns = useMemo(
    () => (localOrder ? applyColumnOrder(serverSortedColumns, localOrder) : serverSortedColumns),
    [serverSortedColumns, localOrder]
  );
  const orderedColumnIds = useMemo(() => sortedColumns.map((c) => c.id), [sortedColumns]);

  // Collapsed columns: purely a view preference (see lib/collapsedColumns.js).
  // Nothing here touches tasks, columns, or the server.
  const { isCollapsed, toggle: toggleCollapsedState } = useCollapsedColumns(projectId);
  const pendingToggleFocus = useRef(null); // { id, collapsed } — keep keyboard focus on the live control

  function handleToggleCollapsed(column) {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const fromToggleControl = !!active?.closest?.("[data-collapse-toggle]");
    const nowCollapsed = toggleCollapsedState(column.id, orderedColumnIds);
    pendingToggleFocus.current = fromToggleControl ? { id: column.id, collapsed: nowCollapsed } : null;
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `Column ${column.name} ${nowCollapsed ? "collapsed" : "expanded"}`;
    }
  }

  // The control that was just used is about to be hidden (the column swaps
  // between its header button and its rail button), so hand focus to the
  // one that replaces it.
  useEffect(() => {
    const pending = pendingToggleFocus.current;
    if (!pending || !boardRef.current) return;
    pendingToggleFocus.current = null;
    const target = boardRef.current.querySelector(
      `[data-collapse-toggle="${pending.id}"][aria-expanded="${pending.collapsed ? "false" : "true"}"]`
    );
    target?.focus({ preventScroll: true });
  });

  // Once fresh data arrives from the server, it is the source of truth
  // again (unless a save is still in flight).
  useEffect(() => {
    if (!savingOrder.current) setLocalOrder(null);
  }, [serverOrderKey]);

  const { columnRef, handleRef, onHandlePointerDown, onHandleKeyDown, captureRects, scheduleFlip } = useColumnDragReorder({
    containerRef: boardRef,
    placeholderRef: dropMarkerRef,
    enabled: canEdit && sortedColumns.length > 1,
    isBusy: () => savingOrder.current,
    orderedIds: orderedColumnIds,
    onReorder: handleReorderColumns,
    onAnnounce: (message) => {
      if (liveRegionRef.current) liveRegionRef.current.textContent = message;
    },
  });

  // Ids that have already played their entrance animation. Moving a
  // column moves its DOM nodes, and browsers restart a CSS animation on
  // any node that is removed and re-inserted — this keeps a reorder from
  // replaying the fade-in on every column and card.
  const seenIds = useRef(new Set());
  useEffect(() => {
    const timer = setTimeout(() => {
      columns.forEach((c) => seenIds.current.add(c.id));
      tasks.forEach((t) => seenIds.current.add(t.id));
    }, 450);
    return () => clearTimeout(timer);
  }, [columns, tasks]);

  const existingDoneColumn = sortedColumns.find((c) => c.isDoneColumn) || null;
  const openTask = tasks.find((t) => t.id === openTaskId) || null;

  // Optimistic column reorder: show the new order immediately, save it
  // in one request, and put the previous order back (animated) if the
  // save fails. Called by the drag hook with the complete new id order.
  async function handleReorderColumns(newIds) {
    if (!canEdit || savingOrder.current) return;
    const previousLocalOrder = localOrder;
    savingOrder.current = true;
    setLocalOrder(newIds);
    try {
      const result = await apiFetch(`/api/projects/${projectId}/columns/order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnOrder: newIds }),
      });
      if (!isMounted()) return;
      // Hold the server's confirmed order until the refetch below lands,
      // so the board never flashes back to the old order in between.
      if (Array.isArray(result?.columns)) setLocalOrder(result.columns.map((c) => c.id));
      savingOrder.current = false;
      onChanged();
    } catch (err) {
      savingOrder.current = false;
      if (!isMounted()) return;
      // Restore the last order the server actually has, sliding the
      // columns back rather than snapping.
      scheduleFlip(captureRects());
      setLocalOrder(previousLocalOrder);
      setError(errorMessage(err, "Couldn't save the new column order. It has been put back."));
      // A 409 means the board's columns changed underneath us.
      if (err?.status === 409) onChanged();
    } finally {
      savingOrder.current = false;
    }
  }

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
  // the pointer is over the column's background but not over a card (cards
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
    if (!canEdit) return;
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
      const deletedId = confirmDeleteTask.id;
      await apiFetch(`/api/tasks/${deletedId}`, { method: "DELETE" });
      if (!isMounted()) return;
      setConfirmDeleteTask(null);
      // Play the exit animation for one short beat before the refetch
      // (onChanged) removes the task from `tasks` for real — the DELETE
      // has already succeeded at this point, so this is purely cosmetic,
      // never a "does this look deleted" guess.
      setRemovingTaskIds((prev) => new Set(prev).add(deletedId));
      setTimeout(() => {
        if (!isMounted()) return;
        setRemovingTaskIds((prev) => {
          if (!prev.has(deletedId)) return prev;
          const next = new Set(prev);
          next.delete(deletedId);
          return next;
        });
        onChanged();
      }, 150);
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

  // Clicking the checkmark on an already-completed task reopens it
  // directly — the two-step confirmation flow below is only for *marking*
  // a task completed (per the product requirement); reversing that is a
  // plain, immediate toggle, same bar as any other field edit in this app.
  async function handleToggleComplete(task) {
    if (!canEdit) {
      setRequestChangeTask(task);
      return;
    }
    if (task.completed) {
      try {
        await apiFetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: false }),
        });
        if (isMounted()) onChanged();
      } catch (err) {
        if (isMounted()) setError(errorMessage(err, "Couldn't reopen the task. Please try again."));
      }
      return;
    }
    setCompletingError("");
    setCompletingTask(task);
  }

  // Step 1: the task is marked completed here — independent of column,
  // and this is the only thing this step does. Whether/where to move it
  // is decided afterwards (step 2), never assumed.
  async function confirmCompleteTask() {
    if (!completingTask || completingBusy) return;
    setCompletingBusy(true);
    setCompletingError("");
    try {
      await apiFetch(`/api/tasks/${completingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      const justCompleted = completingTask;
      if (!isMounted()) return;
      setCompletingTask(null);
      // Progress/dashboard stats must reflect the completion immediately,
      // regardless of what happens in step 2 (or whether there even is
      // one) — see the requirement that a completed task always counts
      // toward progress, in every column.
      onChanged();

      if (existingDoneColumn) {
        if (justCompleted.columnId === existingDoneColumn.id) {
          // Already sitting in the Completed column — nothing to ask.
          setNotice("Task completed.");
        } else {
          setMoveStepError("");
          setMoveStep({ task: justCompleted, column: existingDoneColumn });
        }
      } else {
        setNoDoneColumnError("");
        createdDoneColumnId.current = null;
        setNoDoneColumnStep({ task: justCompleted });
      }
    } catch (err) {
      if (isMounted()) setCompletingError(errorMessage(err, "Couldn't complete the task. Please try again."));
    } finally {
      if (isMounted()) setCompletingBusy(false);
    }
  }

  // Step 2, case A — "Move to Completed" for an existing Completed column.
  async function handleMoveToCompleted() {
    if (!moveStep || moveStepBusy) return;
    setMoveStepBusy(true);
    setMoveStepError("");
    try {
      await apiFetch(`/api/tasks/${moveStep.task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: moveStep.column.id }),
      });
      if (!isMounted()) return;
      setMoveStep(null);
      setNotice("Task moved to Completed.");
      onChanged();
    } catch (err) {
      if (isMounted()) setMoveStepError(errorMessage(err, "Couldn't move the task. Please try again."));
    } finally {
      if (isMounted()) setMoveStepBusy(false);
    }
  }

  function handleKeepTaskHere() {
    setMoveStep(null);
    setNotice("Task completed and kept in the current column.");
  }

  // Step 2, case B — no Completed column exists. Creating one is always
  // optional, never automatic (see the column-management requirements
  // above). If a retry lands after the column was already created but the
  // move failed, this reuses that column instead of creating a second one.
  async function handleCreateCompletedColumnAndMove() {
    if (!noDoneColumnStep || noDoneColumnBusy) return;
    setNoDoneColumnBusy(true);
    setNoDoneColumnError("");
    try {
      let doneColumnId = createdDoneColumnId.current;
      if (!doneColumnId) {
        const created = await apiFetch(`/api/projects/${projectId}/columns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: NEW_DONE_COLUMN_NAME }),
        });
        await apiFetch(`/api/projects/${projectId}/columns/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isDoneColumn: true }),
        });
        doneColumnId = created.id;
        createdDoneColumnId.current = doneColumnId;
      }
      await apiFetch(`/api/tasks/${noDoneColumnStep.task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: doneColumnId }),
      });
      if (!isMounted()) return;
      setNoDoneColumnStep(null);
      createdDoneColumnId.current = null;
      setNotice("Task moved to Completed.");
      onChanged();
    } catch (err) {
      if (isMounted()) setNoDoneColumnError(errorMessage(err, "Couldn't create the Completed column. Please try again."));
    } finally {
      if (isMounted()) setNoDoneColumnBusy(false);
    }
  }

  function handleKeepHereNoColumn() {
    setNoDoneColumnStep(null);
    createdDoneColumnId.current = null;
    setNotice("Task completed and kept in the current column.");
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

  // A project with no columns yet has no board at all — Kanban is a
  // feature the user opts into, not the default shape of every project
  // (see the POST /api/projects route, which no longer creates any
  // columns). Adding the first column *is* adding the board.
  const hasBoard = sortedColumns.length > 0;

  if (!hasBoard && !addingColumn) {
    return (
      <>
        <EmptyState
          title="No board yet"
          description={
            canEdit
              ? "This project doesn't have a board. Add one to start organizing its work into columns."
              : "This project doesn't have a board yet. Ask the project manager to add one, or use \"Request a change\" above."
          }
          action={
            canEdit ? (
              <Button variant="contained" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={() => setAddingColumn(true)}>
                Add board
              </Button>
            ) : null
          }
        />
        <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError("")}>
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        </Snackbar>
      </>
    );
  }

  return (
    <>
      <Box
        ref={boardRef}
        role="region"
        aria-label="Kanban board columns"
        tabIndex={0}
        sx={{
          position: "relative",
          isolation: "isolate",
          containerType: "inline-size", // lets a column's content be sized as 84cqw, matching its 84% flex-basis on phones
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          pb: 1.5,
          alignItems: "flex-start",
          "&::-webkit-scrollbar": { height: 8 },
          "&::-webkit-scrollbar-thumb": { bgcolor: "line.strong", borderRadius: 4 },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
        }}
      >
        <Box
          ref={dropMarkerRef}
          aria-hidden="true"
          sx={(theme) => ({
            display: "none",
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: -1,
            pointerEvents: "none",
            borderRadius: 2,
            border: "1.5px dashed",
            borderColor: theme.palette.primary.main,
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.07),
          })}
        />
        <Box
          ref={liveRegionRef}
          role="status"
          aria-live="polite"
          sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
        />
        {sortedColumns.map((column, columnIndex) => {
          const colTasks = tasks.filter((t) => t.columnId === column.id).sort(compareTasks);
          const isOver = dragOverCol === column.id;
          const colDropTarget = dropTarget && dropTarget.columnId === column.id ? dropTarget : null;
          const collapsed = isCollapsed(column.id);
          const layerFade = `opacity ${Math.round(COLLAPSE_MS * 0.6)}ms ease`;
          // A layer that is being hidden stays visible until its fade/size
          // transition has finished; a layer being shown appears at once.
          const layerVisibility = (visible) => `visibility 0s linear ${visible ? "0ms" : `${COLLAPSE_MS}ms`}`;
          return (
            <FadeInStagger
              key={column.id}
              index={columnIndex}
              base={40}
              animate={!seenIds.current.has(column.id)}
              sx={{
                flex: collapsed ? `0 0 ${COLLAPSED_COLUMN_WIDTH}px` : { xs: "0 0 84%", sm: "0 0 288px" },
                minWidth: 0,
                transition: `flex-basis ${COLLAPSE_MS}ms ${COLLAPSE_EASE}`,
              }}
            >
            <Box
              ref={columnRef(column.id)}
              data-column-id={column.id}
              data-collapsed={collapsed ? "true" : undefined}
              onDragOver={collapsed ? undefined : (e) => (canEdit ? handleColumnDragOver(e, column.id) : e.preventDefault())}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={collapsed ? undefined : (e) => handleDrop(e, column.id)}
              sx={(theme) => ({
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                overflow: "hidden",
                minHeight: 160,
                borderRadius: 2,
                bgcolor: isOver ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.12 : 0.08) : theme.palette.surface.sunken,
                boxShadow: isOver ? `inset 0 0 0 1.5px ${theme.palette.primary.main}` : "none",
                transition: "background-color .12s ease, box-shadow .12s ease",
                willChange: "auto",
                // Column being reordered (see lib/useColumnDragReorder.js,
                // which sets this attribute): lifted with the theme's
                // "raised" shadow and a hairline border so it reads as
                // picked up in both light and dark mode. Colour is never
                // the only cue — the lift, the border and the dashed
                // drop slot all change too.
                "&[data-column-drag='dragging']": {
                  boxShadow: `${theme.tf.shadow.raised}, 0 0 0 1px ${theme.palette.line.strong}`,
                  opacity: 0.96,
                  cursor: "grabbing",
                },
                "&[data-column-drag='dragging'] *": { cursor: "grabbing" },
                "&[data-column-drag='dragging'], &[data-column-drag='shifted'], &[data-column-drag='settling']": {
                  willChange: "transform",
                },
                // Other columns ignore the pointer mid-drag so hover
                // states don't flicker as they slide past it (the
                // dragged column keeps receiving events via pointer
                // capture on its handle).
                "&[data-column-drag='shifted'], &[data-column-drag='settling']": { pointerEvents: "none" },
              })}
            >
              <Box
                sx={{
                  gridArea: "1 / 1",
                  maxHeight: collapsed ? 280 : 0,
                  overflow: "hidden",
                  opacity: collapsed ? 1 : 0,
                  visibility: collapsed ? "visible" : "hidden",
                  transition: `max-height ${COLLAPSE_MS}ms ${COLLAPSE_EASE}, ${layerFade}, ${layerVisibility(collapsed)}`,
                  "@media (prefers-reduced-motion: reduce)": { transitionDelay: "0s" },
                }}
              >
                <CollapsedColumnRail column={column} taskCount={colTasks.length} onExpand={() => handleToggleCollapsed(column)} />
              </Box>
              <Box
                sx={{
                  gridArea: "1 / 1",
                  minWidth: 0,
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gridTemplateRows: collapsed ? "0fr" : "1fr",
                  opacity: collapsed ? 0 : 1,
                  visibility: collapsed ? "hidden" : "visible",
                  transition: `grid-template-rows ${COLLAPSE_MS}ms ${COLLAPSE_EASE}, ${layerFade}, ${layerVisibility(!collapsed)}`,
                  "@media (prefers-reduced-motion: reduce)": { transitionDelay: "0s" },
                }}
              >
                <Box sx={{ minHeight: 0, overflow: "hidden" }}>
                  {/* Fixed to the expanded column width so the content never re-wraps while the column animates. */}
                  <Box sx={{ width: { xs: "84cqw", sm: 288 }, boxSizing: "border-box", p: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1, pl: canEdit && sortedColumns.length > 1 ? 0.25 : 1, pr: 0.25, minHeight: 32 }}>
                      {canEdit && sortedColumns.length > 1 && (
                        <Tooltip title="Drag to reorder column (or use the ← → keys)" enterDelay={500}>
                          <IconButton
                            ref={handleRef(column.id)}
                            size="small"
                            aria-label={`Reorder column ${column.name}`}
                            aria-keyshortcuts="ArrowLeft ArrowRight"
                            onPointerDown={(e) => onHandlePointerDown(e, column.id)}
                            onKeyDown={(e) => onHandleKeyDown(e, column.id)}
                            onContextMenu={(e) => e.preventDefault()}
                            sx={{
                              p: 0.25,
                              ml: 0,
                              color: "text.secondary",
                              cursor: "grab",
                              touchAction: "none", // only the handle; the rest of the board still scrolls by touch
                              flexShrink: 0,
                              "&:hover": { color: "text.primary" },
                              "&:active": { cursor: "grabbing" },
                            }}
                          >
                            <DragIndicatorIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {column.isDoneColumn && (
                        <Tooltip title="Final column — tasks here count as “done” in the progress report">
                          <CheckCircleIcon aria-label="Final column" sx={{ fontSize: 16, color: "success.main", flexShrink: 0 }} />
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
                          role={canEdit ? "button" : undefined}
                          tabIndex={canEdit ? 0 : undefined}
                          variant="subtitle2"
                          noWrap
                          title={column.name}
                          aria-label={canEdit ? `Rename column ${column.name}` : undefined}
                          onClick={
                            canEdit
                              ? () => {
                                  setRenamingId(column.id);
                                  setRenameValue(column.name);
                                }
                              : undefined
                          }
                          onKeyDown={
                            canEdit
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setRenamingId(column.id);
                                    setRenameValue(column.name);
                                  }
                                }
                              : undefined
                          }
                          sx={{
                            flexGrow: 1,
                            minWidth: 0,
                            cursor: canEdit ? "text" : "default",
                            transition: "color .12s ease",
                            "&:hover": canEdit ? { color: "primary.main" } : undefined,
                            "&:focus-visible": canEdit ? { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px", borderRadius: 0.5 } : undefined,
                          }}
                        >
                          {column.name}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", px: 0.25 }} aria-label={`${colTasks.length} ${colTasks.length === 1 ? "task" : "tasks"}`}>
                        {colTasks.length}
                      </Typography>
                      <Tooltip title="Collapse column" enterDelay={500}>
                        <IconButton
                          size="small"
                          data-collapse-toggle={column.id}
                          aria-expanded={!collapsed}
                          aria-label={`Collapse column ${column.name}`}
                          onClick={() => handleToggleCollapsed(column)}
                          sx={{ color: "text.secondary", "&:hover": { color: "text.primary" } }}
                        >
                          <ChevronLeftIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      </Tooltip>
                      {canEdit && (
                        <IconButton
                          size="small"
                          aria-label={`${column.name} column options`}
                          aria-haspopup="true"
                          onClick={(e) => {
                            setMenuAnchor(e.currentTarget);
                            setMenuColumn(column);
                          }}
                        >
                          <MoreHorizIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      )}
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                      {colTasks.map((task, taskIndex) => (
                        <FadeInStagger key={task.id} index={taskIndex} base={25} duration={0.22} animate={!seenIds.current.has(task.id)}>
                          <TaskCard
                            task={task}
                            canEdit={canEdit}
                            onDragStart={handleDragStart}
                            onDragOverCard={(e, t) => (canEdit ? handleCardDragOver(e, column.id, t) : e.preventDefault())}
                            onDelete={(t) => {
                              setDeleteTaskError("");
                              setConfirmDeleteTask(t);
                            }}
                            onOpen={(t) => setOpenTaskId(t.id)}
                            onToggleComplete={handleToggleComplete}
                            dropIndicator={colDropTarget?.taskId === task.id ? colDropTarget.position : null}
                            exiting={removingTaskIds.has(task.id)}
                          />
                        </FadeInStagger>
                      ))}
                      {colTasks.length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, py: 1.5 }}>
                          No tasks yet
                        </Typography>
                      )}
                      {colDropTarget?.position === "end" && colTasks.length > 0 && (
                        <Box sx={{ height: 2, bgcolor: "primary.main", borderRadius: 1 }} />
                      )}
                    </Box>

                    {canEdit && (
                      <Button
                        size="small"
                        color="inherit"
                        fullWidth
                        startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                        onClick={() => setNewTaskColumnId(column.id)}
                        aria-label={`Add task to ${column.name}`}
                        sx={{ mt: 0.5, justifyContent: "flex-start", color: "text.secondary", fontWeight: 500, "&:hover": { color: "text.primary" } }}
                      >
                        Add task
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            </Box>
            </FadeInStagger>
          );
        })}

        {canEdit && (
        <Box sx={{ flex: { xs: "0 0 84%", sm: "0 0 240px" } }}>
          {addingColumn ? (
            <Box
              component="form"
              onSubmit={handleAddColumn}
              sx={(theme) => ({ p: 1, borderRadius: 2, bgcolor: theme.palette.surface.sunken })}
            >
              <TextField
                autoFocus
                fullWidth
                size="small"
                placeholder="Column name"
                inputProps={{ "aria-label": hasBoard ? "New column name" : "First column name" }}
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
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Button type="submit" size="small" variant="contained" disabled={addingColumnSubmitting}>
                  {addingColumnSubmitting ? "Adding..." : hasBoard ? "Add column" : "Create board"}
                </Button>
                <Button type="button" size="small" color="inherit" disabled={addingColumnSubmitting} onClick={() => setAddingColumn(false)}>
                  Cancel
                </Button>
              </Box>
            </Box>
          ) : (
            <Button
              type="button"
              color="inherit"
              fullWidth
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={() => setAddingColumn(true)}
              sx={{ justifyContent: "flex-start", height: 40, px: 1.5, color: "text.secondary", fontWeight: 500, "&:hover": { color: "text.primary" } }}
            >
              New column
            </Button>
          )}
        </Box>
        )}
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
              <CheckCircleIcon fontSize="small" sx={{ mr: 1, color: "success.main" }} /> Unmark as final column
            </>
          ) : (
            <>
              <CheckCircleOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Mark as final column
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
          canEdit={canEdit}
          onClose={() => setOpenTaskId(null)}
          onChanged={onChanged}
          onToggleComplete={handleToggleComplete}
          onRequestChange={(t) => setRequestChangeTask(t)}
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

      {/* Step 1 — confirm before marking a task completed at all. */}
      <ConfirmDialog
        open={!!completingTask}
        title="Complete task"
        message={completingTask ? `Are you sure you want to mark “${completingTask.title}” as completed?` : ""}
        confirmLabel="Confirm"
        confirmColor="primary"
        loadingLabel="Completing..."
        onConfirm={confirmCompleteTask}
        onClose={() => {
          setCompletingTask(null);
          setCompletingError("");
        }}
        loading={completingBusy}
        error={completingError}
      />

      {/* Step 2, case A — a Completed column exists: move it there, or keep it here. */}
      <ChoiceDialog
        open={!!moveStep}
        title="Move to Completed?"
        message={moveStep ? `Do you want to move “${moveStep.task.title}” to the “${moveStep.column.name}” column?` : ""}
        primaryLabel="Move to Completed"
        primaryLoadingLabel="Moving..."
        onPrimary={handleMoveToCompleted}
        secondaryLabel="Keep Here"
        onSecondary={handleKeepTaskHere}
        loading={moveStepBusy}
        error={moveStepError}
      />

      {/* Step 2, case B — no Completed column exists: creating one is optional. */}
      <ChoiceDialog
        open={!!noDoneColumnStep}
        title="No Completed column yet"
        message={
          noDoneColumnStep
            ? `“${noDoneColumnStep.task.title}” is completed and stays in its current column. This board doesn't have a Completed column — you can create one and move it there, or leave things as they are.`
            : ""
        }
        primaryLabel="Create Completed Column & Move"
        primaryLoadingLabel="Creating..."
        onPrimary={handleCreateCompletedColumnAndMove}
        secondaryLabel="Keep Here"
        onSecondary={handleKeepHereNoColumn}
        loading={noDoneColumnBusy}
        error={noDoneColumnError}
      />

      {requestChangeTask && (
        <RequestChangeDialog
          open={!!requestChangeTask}
          onClose={() => setRequestChangeTask(null)}
          projectId={projectId}
          task={requestChangeTask}
          columns={sortedColumns}
          onSubmitted={() => setNotice("Your request was sent to the project manager.")}
        />
      )}

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError("")}>
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar open={!!notice} autoHideDuration={3000} onClose={() => setNotice("")} message={notice} />
    </>
  );
}
