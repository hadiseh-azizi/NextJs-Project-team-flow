"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  FormControl, Select, OutlinedInput, Checkbox, ListItemText, Chip,
  List, ListItem, ListItemIcon, ListItemText as MuiListItemText, IconButton, Divider,
  CircularProgress, Alert, MenuItem, useMediaQuery, TextField,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import ConfirmDialog from "@/components/ConfirmDialog";
import ColorSwatchPicker from "@/components/ColorSwatchPicker";
import Field, { FieldLabel } from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";
import { formatDateOnly } from "@/lib/dateOnly";
import {
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE_MB,
  MAX_ATTACHMENTS_PER_TASK,
  ALLOWED_TYPES_SUMMARY,
  ATTACHMENT_ACCEPT,
  isAllowedAttachmentExtension,
} from "@/lib/attachmentPolicy";
import { MAX_TASK_DESCRIPTION_LENGTH } from "@/lib/fieldLimits";
import { formatSize } from "@/lib/formatSize";

// Due dates are stored as UTC midnight (see lib/dateOnly.js), so the day the
// person picked is the first ten characters of the ISO string — the same
// value a date input uses.
function toDateInputValue(dueDate) {
  return dueDate ? String(dueDate).slice(0, 10) : "";
}

// A date input reports "" while it is half-typed and, in some browsers,
// passes through years like 0002 on the way to 2026. Only a complete,
// plausible date is ever sent to the server.
function isPlausibleDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2100 && !Number.isNaN(new Date(value).getTime());
}

// `onPatched(taskId, fields)` lets the board apply a saved change to its own
// copy of the task instead of refetching the whole project. When the parent
// doesn't provide it, every save falls back to `onChanged` (a full reload).
// `onMoved(task)` does the same for a column change: the response is the
// moved task (with the new order, and any renumbered siblings).
export default function TaskDetailDialog({ task, columns, assignableUsers, canEdit = true, onClose, onChanged, onPatched, onMoved, onDeleted, onToggleComplete }) {
  const isMounted = useIsMounted();
  // Each of these fields (color/column/assignees) saves on every change,
  // with no "submit" step — so a second change can start before the
  // first one's request has resolved (e.g. clicking two assignees in
  // quick succession). Each field gets its own ticket so that if the
  // first (now-stale) request's response — success or failure — arrives
  // after a newer one has already started, it's ignored instead of
  // clobbering the newer optimistic value with its own rollback or
  // refetch. See lib/clientAsync.js.
  const columnRequest = useLatestRequest();
  const colorRequest = useLatestRequest();
  const assigneesRequest = useLatestRequest();
  const titleRequest = useLatestRequest();
  const descriptionRequest = useLatestRequest();
  const dueDateRequest = useLatestRequest();
  // Upload and delete both replace the task's attachment list with the
  // server's; only the most recently started of the two may apply its
  // list, so an older response can't bring back a file just deleted.
  const attachmentsRequest = useLatestRequest();
  // The title field commits on both blur and Enter, which can fire close
  // enough together (Enter, then the resulting blur) to both reach
  // saveTitle() before the first request finishes — mirrors the same
  // guard column rename uses in KanbanBoard.jsx.
  const titleSaveInFlight = useRef(false);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [assigneeIds, setAssigneeIds] = useState(task.assignees.map((a) => a.id));
  const [savingAssignees, setSavingAssignees] = useState(false);
  const [columnId, setColumnId] = useState(task.columnId);
  const [color, setColor] = useState(task.color);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [savingDescription, setSavingDescription] = useState(false);
  const descriptionSaveInFlight = useRef(false);
  const [dueDateDraft, setDueDateDraft] = useState(toDateInputValue(task.dueDate));
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [dueDateError, setDueDateError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false);
  const [deleteTaskError, setDeleteTaskError] = useState("");
  const [confirmDeleteAttachment, setConfirmDeleteAttachment] = useState(null);
  const [deleteAttachmentError, setDeleteAttachmentError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const fileInputRef = useRef(null);

  // Keep the date field in step with the task when it changes underneath
  // (a save landing, or the board refreshing).
  const savedDueDate = toDateInputValue(task.dueDate);
  useEffect(() => {
    setDueDateDraft(savedDueDate);
    setDueDateError("");
  }, [savedDueDate]);

  // Hands a saved change back to the board. Called even if this dialog has
  // since been closed: the save did happen, and the board should show it.
  function reportPatch(fields) {
    if (onPatched) onPatched(task.id, fields);
    else onChanged();
  }

  function startEditingTitle() {
    setTitleDraft(task.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    // No real change (including "typed it back to the same thing") — just
    // close the field, nothing to persist.
    if (!trimmed || trimmed === task.title) {
      setEditingTitle(false);
      return;
    }
    if (titleSaveInFlight.current) return;
    titleSaveInFlight.current = true;
    const isCurrent = titleRequest();
    setSavingTitle(true);
    try {
      const updated = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (isCurrent()) reportPatch({ title: updated.title });
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      setActionError(errorMessage(err, "Couldn't rename the task. Please try again."));
    } finally {
      titleSaveInFlight.current = false;
      if (isMounted() && isCurrent()) {
        setSavingTitle(false);
        setEditingTitle(false);
      }
    }
  }

  async function saveColor(newColor) {
    const previous = color;
    const isCurrent = colorRequest();
    setColor(newColor);
    try {
      const updated = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: newColor }),
      });
      if (isCurrent()) reportPatch({ color: updated.color });
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      setColor(previous);
      setActionError(errorMessage(err, "Couldn't update the color. Please try again."));
    }
  }

  async function saveAssignees(newIds) {
    const previous = assigneeIds;
    const isCurrent = assigneesRequest();
    setAssigneeIds(newIds);
    setSavingAssignees(true);
    try {
      const updated = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeIds: newIds }),
      });
      if (isCurrent()) reportPatch({ assignees: updated.assignees });
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      setAssigneeIds(previous);
      setActionError(errorMessage(err, "Couldn't update assignees. Please try again."));
    } finally {
      // Unlike the state above, it's fine for this to run even when a
      // newer request has superseded this one: the newer save also sets
      // `savingAssignees` true at its own start and clears it in its own
      // `finally`, so as long as this stale call doesn't fire *after*
      // that newer `finally`, clearing it here is harmless. If it did
      // fire after, this could only prematurely hide a still-in-flight
      // "Saving..." indicator, not cause any data loss.
      if (isMounted()) setSavingAssignees(false);
    }
  }

  function startEditingDescription() {
    setDescriptionDraft(task.description ?? "");
    setEditingDescription(true);
  }

  async function saveDescription() {
    const next = descriptionDraft.trim();
    // Nothing changed (an empty draft on an empty description counts):
    // just close the editor.
    if (next === (task.description ?? "")) {
      setEditingDescription(false);
      return;
    }
    if (descriptionSaveInFlight.current) return;
    descriptionSaveInFlight.current = true;
    const isCurrent = descriptionRequest();
    setSavingDescription(true);
    try {
      // An empty string clears the description (the API stores null).
      const updated = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: next }),
      });
      if (isCurrent()) reportPatch({ description: updated.description });
      if (isMounted() && isCurrent()) setEditingDescription(false);
    } catch (err) {
      // Stay in the editor with the text intact so nothing typed is lost.
      if (!isMounted() || !isCurrent()) return;
      setActionError(errorMessage(err, "Couldn't save the description. Please try again."));
    } finally {
      descriptionSaveInFlight.current = false;
      if (isMounted()) setSavingDescription(false);
    }
  }

  // `value` is a "YYYY-MM-DD" string, or null to clear the due date.
  async function persistDueDate(value) {
    const isCurrent = dueDateRequest();
    setSavingDueDate(true);
    setDueDateError("");
    try {
      const updated = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: value }),
      });
      if (isCurrent()) reportPatch({ dueDate: updated.dueDate });
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      setDueDateDraft(savedDueDate);
      setActionError(errorMessage(err, "Couldn't update the due date. Please try again."));
    } finally {
      if (isMounted() && isCurrent()) setSavingDueDate(false);
    }
  }

  // Saved when the field is left or Enter is pressed, not on every change:
  // a date input fires change events while a date is still being typed.
  function commitDueDate() {
    if (savingDueDate) return;
    if (dueDateDraft === savedDueDate) {
      setDueDateError("");
      return;
    }
    // An emptied field is not a request to clear — that is the Clear
    // button — so a half-edited date goes back to what is saved.
    if (dueDateDraft === "") {
      setDueDateDraft(savedDueDate);
      return;
    }
    if (!isPlausibleDate(dueDateDraft)) {
      setDueDateError("Enter a valid date.");
      return;
    }
    persistDueDate(dueDateDraft);
  }

  function clearDueDate() {
    setDueDateDraft("");
    persistDueDate(null);
  }

  // Closing right after picking a date must not drop it.
  function handleClose() {
    if (canEdit && dueDateDraft && dueDateDraft !== savedDueDate && isPlausibleDate(dueDateDraft)) {
      persistDueDate(dueDateDraft);
    }
    onClose();
  }

  async function saveColumn(newColumnId) {
    const previous = columnId;
    const isCurrent = columnRequest();
    setColumnId(newColumnId);
    try {
      const moved = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: newColumnId }),
      });
      if (isMounted() && isCurrent()) {
        if (onMoved) onMoved(moved);
        else onChanged();
      }
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      setColumnId(previous);
      setActionError(errorMessage(err, "Couldn't move the task. Please try again."));
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    // Reset the input immediately so selecting the same file again later
    // (e.g. after fixing the problem that rejected it) reliably fires
    // another change event.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    // Belt-and-braces against a double submission: the "Add file" button
    // is disabled while `uploading` is true, but the underlying <input>
    // could still receive a stray second change event (e.g. a very fast
    // second selection) before that disabled state re-renders.
    if (uploading) return;

    setUploadError("");

    if (!isAllowedAttachmentExtension(file.name)) {
      setUploadError(`"${file.name}" isn't a supported file type.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadError(`"${file.name}" is larger than the ${MAX_FILE_SIZE_MB}MB limit per file.`);
      return;
    }
    if (task.attachments.length >= MAX_ATTACHMENTS_PER_TASK) {
      setUploadError(`This task already has the maximum of ${MAX_ATTACHMENTS_PER_TASK} attachments.`);
      return;
    }
    const currentTotal = task.attachments.reduce((sum, a) => sum + a.size, 0);
    if (currentTotal + file.size > MAX_TOTAL_ATTACHMENTS_SIZE) {
      setUploadError(`This task has reached its ${MAX_TOTAL_ATTACHMENTS_SIZE_MB}MB total attachment limit. Remove a file before adding another.`);
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const isCurrentAttachments = attachmentsRequest();
    try {
      // The response is the task with its attachment list (metadata only).
      const updated = await apiFetch(`/api/tasks/${task.id}/attachments`, { method: "POST", body: formData });
      // Superseded by a newer upload/delete: reconcile with a reload
      // rather than apply a list that may already be out of date.
      if (isCurrentAttachments()) reportPatch({ attachments: updated.attachments });
      else onChanged();
    } catch (err) {
      if (isMounted()) setUploadError(errorMessage(err, "Error uploading file"));
    } finally {
      if (isMounted()) setUploading(false);
    }
  }

  async function confirmAttachmentDelete() {
    if (!confirmDeleteAttachment || deleting) return;
    setDeleting(true);
    setDeleteAttachmentError("");
    const isCurrentAttachments = attachmentsRequest();
    try {
      const updated = await apiFetch(`/api/tasks/${task.id}/attachments/${confirmDeleteAttachment.id}`, { method: "DELETE" });
      // Superseded by a newer upload/delete: reconcile with a reload
      // rather than apply a list that may already be out of date.
      if (isCurrentAttachments()) reportPatch({ attachments: updated.attachments });
      else onChanged();
      if (!isMounted()) return;
      setConfirmDeleteAttachment(null);
    } catch (err) {
      // Stay open and show why — closing here would leave the file
      // looking un-deletable with no visible explanation.
      if (isMounted()) setDeleteAttachmentError(errorMessage(err, "Couldn't delete the file. Please try again."));
    } finally {
      if (isMounted()) setDeleting(false);
    }
  }

  async function confirmTaskDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteTaskError("");
    try {
      await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      if (!isMounted()) return;
      setDeleteTaskError(errorMessage(err, "Couldn't delete the task. Please try again."));
      setDeleting(false);
    }
  }

  return (
    <Dialog open onClose={handleClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle sx={{ overflowWrap: "anywhere", display: "flex", alignItems: "flex-start", gap: 1 }}>
        <IconButton
          size="small"
          disabled={!canEdit}
          onClick={() => onToggleComplete(task)}
          aria-label={
            canEdit
              ? task.completed
                ? `Mark "${task.title}" as not completed`
                : `Mark "${task.title}" as completed`
              : task.completed
                ? "Completed"
                : "Not completed"
          }
          sx={{
            p: 0.5, mt: 0.25, color: task.completed ? "success.main" : "text.secondary", flexShrink: 0,
            "&.Mui-disabled": { color: task.completed ? "success.main" : "text.secondary" },
          }}
        >
          {task.completed ? <CheckCircleIcon sx={{ fontSize: 22 }} /> : <RadioButtonUncheckedIcon sx={{ fontSize: 22 }} />}
        </IconButton>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        {editingTitle ? (
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveTitle();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingTitle(false);
              }
            }}
            disabled={savingTitle}
            inputProps={{ "aria-label": "Task title", maxLength: 200 }}
            sx={{ "& .MuiInputBase-input": { fontSize: "1.25rem", fontWeight: 500 } }}
          />
        ) : (
          <Typography
            component="span"
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            variant="inherit"
            title={canEdit ? "Click to rename" : undefined}
            aria-label={canEdit ? `Rename task ${task.title}` : undefined}
            onClick={canEdit ? startEditingTitle : undefined}
            onKeyDown={
              canEdit
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startEditingTitle();
                    }
                  }
                : undefined
            }
            sx={{
              display: "inline-block",
              cursor: canEdit ? "text" : "default",
              borderRadius: 0.5,
              textDecoration: task.completed ? "line-through" : "none",
              color: task.completed ? "text.secondary" : "text.primary",
              "&:hover": canEdit ? { color: "primary.main" } : undefined,
              "&:focus-visible": canEdit ? { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } : undefined,
            }}
          >
            {task.title}
          </Typography>
        )}
        </Box>
      </DialogTitle>
      <DialogContent>
        {editingDescription ? (
          <Box sx={{ mb: 3 }}>
            <Field
              label="Description"
              multiline
              minRows={3}
              maxRows={12}
              autoFocus
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Cancel the edit, not the whole dialog.
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingDescription(false);
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveDescription();
                }
              }}
              disabled={savingDescription}
              inputProps={{ maxLength: MAX_TASK_DESCRIPTION_LENGTH }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}>
              <Button size="small" color="inherit" onClick={() => setEditingDescription(false)} disabled={savingDescription}>
                Cancel
              </Button>
              <Button size="small" variant="contained" onClick={saveDescription} disabled={savingDescription}>
                {savingDescription ? "Saving..." : "Save"}
              </Button>
            </Box>
          </Box>
        ) : task.description ? (
          <Typography
            variant="body2"
            color="text.secondary"
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            title={canEdit ? "Click to edit" : undefined}
            aria-label={canEdit ? "Edit description" : undefined}
            onClick={canEdit ? startEditingDescription : undefined}
            onKeyDown={
              canEdit
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startEditingDescription();
                    }
                  }
                : undefined
            }
            sx={{
              mb: 3,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              borderRadius: 0.5,
              cursor: canEdit ? "text" : "default",
              "&:hover": canEdit ? { color: "text.primary" } : undefined,
              "&:focus-visible": canEdit ? { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } : undefined,
            }}
          >
            {task.description}
          </Typography>
        ) : (
          canEdit && (
            <Button size="small" color="inherit" onClick={startEditingDescription} sx={{ mb: 2.5, ml: -1, color: "text.secondary" }}>
              Add description
            </Button>
          )
        )}

        {actionError && (
          <Alert severity="error" className="tf-shake" sx={{ mb: 2.5 }} onClose={() => setActionError("")}>
            {actionError}
          </Alert>
        )}

        <FieldLabel id="edit-column-label" component="div">Column</FieldLabel>
        <FormControl fullWidth size="small" sx={{ mb: 2.5 }}>
          <Select
            labelId="edit-column-label"
            value={columnId}
            onChange={(e) => saveColumn(e.target.value)}
            disabled={!canEdit}
          >
            {columns.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FieldLabel id="edit-assignees-label" component="div">Assignees</FieldLabel>
        <FormControl fullWidth sx={{ mb: 2.5 }}>
          <Select
            labelId="edit-assignees-label"
            multiple
            displayEmpty
            value={assigneeIds}
            onChange={(e) => saveAssignees(e.target.value)}
            input={<OutlinedInput />}
            disabled={!canEdit}
            renderValue={(selected) =>
              selected.length === 0 ? (
                <Typography component="span" variant="body2" color="text.secondary">Nobody</Typography>
              ) : (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.map((id) => {
                    const u = assignableUsers.find((u) => u.id === id);
                    return <Chip key={id} label={u?.name} size="small" />;
                  })}
                </Box>
              )
            }
          >
            {assignableUsers.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                <Checkbox checked={assigneeIds.includes(u.id)} size="small" />
                <ListItemText primary={u.name} />
              </MenuItem>
            ))}
          </Select>
          {savingAssignees && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite">
              Saving...
            </Typography>
          )}
        </FormControl>

        {canEdit ? (
          <Box sx={{ mb: 2.5 }}>
            <Field
              type="date"
              label="Due date"
              size="small"
              value={dueDateDraft}
              onChange={(e) => {
                setDueDateDraft(e.target.value);
                setDueDateError("");
              }}
              onBlur={commitDueDate}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDueDate();
                }
              }}
              disabled={savingDueDate}
              error={!!dueDateError}
              helperText={dueDateError || undefined}
              inputProps={{ min: "1900-01-01", max: "2100-12-31" }}
              InputProps={{
                endAdornment: savedDueDate ? (
                  <Button size="small" color="inherit" onClick={clearDueDate} disabled={savingDueDate} sx={{ ml: 1, flexShrink: 0 }}>
                    Clear
                  </Button>
                ) : undefined,
              }}
            />
          </Box>
        ) : (
          <Box sx={{ mb: 2.5 }}>
            <FieldLabel component="div">Due date</FieldLabel>
            <Typography variant="body2" color={task.dueDate ? "text.primary" : "text.secondary"}>
              {task.dueDate ? formatDateOnly(task.dueDate, { year: "numeric", month: "short", day: "numeric" }) : "No due date"}
            </Typography>
          </Box>
        )}

        <FieldLabel component="div">Color</FieldLabel>
        <Box sx={{ mb: 3 }}>
          <ColorSwatchPicker value={color} onChange={saveColor} disabled={!canEdit} />
        </Box>

        <Divider sx={{ mb: 2.5 }} />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
          <Typography variant="h6" component="h3" sx={{ fontSize: "0.9375rem" }}>
            Attachments
          </Typography>
          {canEdit && (
            <Button
              size="small"
              color="primary"
              component="label"
              startIcon={uploading ? <CircularProgress size={14} /> : <UploadFileIcon sx={{ fontSize: 18 }} />}
              disabled={uploading || task.attachments.length >= MAX_ATTACHMENTS_PER_TASK}
            >
              {uploading ? "Uploading..." : "Add file"}
              <input ref={fileInputRef} type="file" hidden accept={ATTACHMENT_ACCEPT} onChange={handleUpload} />
            </Button>
          )}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {ALLOWED_TYPES_SUMMARY} · up to {MAX_FILE_SIZE_MB}MB per file · {MAX_TOTAL_ATTACHMENTS_SIZE_MB}MB total per task
          {task.attachments.length > 0 && ` · ${task.attachments.length}/${MAX_ATTACHMENTS_PER_TASK} files`}
        </Typography>

        {uploadError && (
          <Alert severity="error" className="tf-shake" sx={{ mb: 1 }} onClose={() => setUploadError("")}>
            {uploadError}
          </Alert>
        )}

        {task.attachments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No files attached yet.
          </Typography>
        ) : (
          <List dense disablePadding>
            {task.attachments.map((a) => (
              <ListItem
                key={a.id}
                disableGutters
                secondaryAction={
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    <IconButton
                      size="small"
                      component="a"
                      href={`/api/tasks/${task.id}/attachments/${a.id}`}
                      // A failed request here (expired session, file
                      // deleted by someone else, etc.) returns a plain
                      // JSON error body with no Content-Disposition — if
                      // this navigated the current tab, that error would
                      // replace the entire app instead of just failing
                      // the download. Opening in a new tab means a
                      // failure only affects that tab; the app underneath
                      // is untouched. Successful downloads are unaffected
                      // since the route always sets
                      // Content-Disposition: attachment (see
                      // buildContentDisposition in lib/attachmentPolicy.js),
                      // so the browser downloads the file rather than
                      // rendering it in the new tab.
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Download ${a.filename}`}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    {canEdit && (
                      <IconButton
                        size="small"
                        onClick={() => {
                          setDeleteAttachmentError("");
                          setConfirmDeleteAttachment(a);
                        }}
                        aria-label={`Delete ${a.filename}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                }
                sx={{ pr: 10 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <InsertDriveFileIcon fontSize="small" />
                </ListItemIcon>
                <MuiListItemText
                  primary={a.filename}
                  secondary={formatSize(a.size)}
                  primaryTypographyProps={{ variant: "body2", sx: { overflowWrap: "anywhere" } }}
                  secondaryTypographyProps={{ variant: "caption" }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        {canEdit ? (
          <Button
            color="error"
            onClick={() => {
              setDeleteTaskError("");
              setConfirmDeleteTask(true);
            }}
          >
            Delete task
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={handleClose} variant="outlined" color="inherit">
          Close
        </Button>
      </DialogActions>

      <ConfirmDialog
        open={confirmDeleteTask}
        title="Delete task"
        message={`“${task.title}” will be permanently deleted — this can't be undone. Are you sure?`}
        onConfirm={confirmTaskDelete}
        onClose={() => {
          setConfirmDeleteTask(false);
          setDeleteTaskError("");
        }}
        loading={deleting}
        error={deleteTaskError}
      />
      <ConfirmDialog
        open={!!confirmDeleteAttachment}
        title="Delete file"
        message={confirmDeleteAttachment ? `“${confirmDeleteAttachment.filename}” will be deleted. Are you sure?` : ""}
        onConfirm={confirmAttachmentDelete}
        onClose={() => {
          setConfirmDeleteAttachment(null);
          setDeleteAttachmentError("");
        }}
        loading={deleting}
        error={deleteAttachmentError}
      />
    </Dialog>
  );
}
