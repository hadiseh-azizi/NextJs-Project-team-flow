"use client";

import { useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  FormControl, InputLabel, Select, OutlinedInput, Checkbox, ListItemText, Chip,
  List, ListItem, ListItemIcon, ListItemText as MuiListItemText, IconButton, Divider,
  CircularProgress, Alert, MenuItem, useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ConfirmDialog from "@/components/ConfirmDialog";
import ColorSwatchPicker from "@/components/ColorSwatchPicker";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";
import {
  MAX_FILE_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  ALLOWED_TYPES_SUMMARY,
} from "@/lib/attachmentPolicy";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);
const MAX_TOTAL_SIZE_MB = MAX_TOTAL_ATTACHMENTS_SIZE / (1024 * 1024);

export default function TaskDetailDialog({ task, columns, assignableUsers, onClose, onChanged, onDeleted }) {
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
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [assigneeIds, setAssigneeIds] = useState(task.assignees.map((a) => a.id));
  const [savingAssignees, setSavingAssignees] = useState(false);
  const [columnId, setColumnId] = useState(task.columnId);
  const [color, setColor] = useState(task.color);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false);
  const [deleteTaskError, setDeleteTaskError] = useState("");
  const [confirmDeleteAttachment, setConfirmDeleteAttachment] = useState(null);
  const [deleteAttachmentError, setDeleteAttachmentError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const fileInputRef = useRef(null);

  async function saveColor(newColor) {
    const previous = color;
    const isCurrent = colorRequest();
    setColor(newColor);
    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: newColor }),
      });
      if (isMounted() && isCurrent()) onChanged();
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
      await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeIds: newIds }),
      });
      if (isMounted() && isCurrent()) onChanged();
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

  async function saveColumn(newColumnId) {
    const previous = columnId;
    const isCurrent = columnRequest();
    setColumnId(newColumnId);
    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: newColumnId }),
      });
      if (isMounted() && isCurrent()) onChanged();
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
      setUploadError(`This task has reached its ${MAX_TOTAL_SIZE_MB}MB total attachment limit. Remove a file before adding another.`);
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await apiFetch(`/api/tasks/${task.id}/attachments`, { method: "POST", body: formData });
      if (isMounted()) onChanged();
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
    try {
      await apiFetch(`/api/tasks/${task.id}/attachments/${confirmDeleteAttachment.id}`, { method: "DELETE" });
      if (!isMounted()) return;
      setConfirmDeleteAttachment(null);
      onChanged();
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
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{task.title}</DialogTitle>
      <DialogContent>
        {task.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {task.description}
          </Typography>
        )}

        {actionError && (
          <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setActionError("")}>
            {actionError}
          </Alert>
        )}

        <FormControl fullWidth size="small" sx={{ mb: 2.5 }}>
          <InputLabel id="edit-column-label">Column</InputLabel>
          <Select
            labelId="edit-column-label"
            value={columnId}
            label="Column"
            onChange={(e) => saveColumn(e.target.value)}
          >
            {columns.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
                {c.isDoneColumn && (
                  <Typography component="span" variant="caption" color="success.main" sx={{ mr: 1 }}>
                    (final)
                  </Typography>
                )}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel id="edit-assignees-label">Assignees</InputLabel>
          <Select
            labelId="edit-assignees-label"
            multiple
            value={assigneeIds}
            onChange={(e) => saveAssignees(e.target.value)}
            input={<OutlinedInput label="Assignees" />}
            renderValue={(selected) => (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {selected.map((id) => {
                  const u = assignableUsers.find((u) => u.id === id);
                  return <Chip key={id} label={u?.name} size="small" />;
                })}
              </Box>
            )}
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

        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: "block", mb: 1 }}>
          COLOR
        </Typography>
        <Box sx={{ mb: 3 }}>
          <ColorSwatchPicker value={color} onChange={saveColor} />
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Attachments
          </Typography>
          <Button
            size="small"
            component="label"
            startIcon={uploading ? <CircularProgress size={14} /> : <UploadFileIcon />}
            disabled={uploading || task.attachments.length >= MAX_ATTACHMENTS_PER_TASK}
          >
            {uploading ? "Uploading..." : "Add file"}
            <input ref={fileInputRef} type="file" hidden onChange={handleUpload} />
          </Button>
        </Box>

        <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 1 }}>
          {ALLOWED_TYPES_SUMMARY} · up to {MAX_FILE_SIZE_MB}MB per file · {MAX_TOTAL_SIZE_MB}MB total per task
          {task.attachments.length > 0 && ` · ${task.attachments.length}/${MAX_ATTACHMENTS_PER_TASK} files`}
        </Typography>

        {uploadError && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setUploadError("")}>
            {uploadError}
          </Alert>
        )}

        {task.attachments.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
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
      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: "space-between" }}>
        <Button
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => {
            setDeleteTaskError("");
            setConfirmDeleteTask(true);
          }}
        >
          Delete task
        </Button>
        <Button onClick={onClose} variant="contained">
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
