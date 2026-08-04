"use client";

import { useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  FormControl, InputLabel, Select, OutlinedInput, Checkbox, ListItemText, Chip,
  List, ListItem, ListItemIcon, ListItemText as MuiListItemText, IconButton, Divider,
  CircularProgress, Alert, MenuItem,
} from "@mui/material";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ConfirmDialog from "@/components/ConfirmDialog";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskDetailDialog({ task, columns, assignableUsers, onClose, onChanged, onDeleted }) {
  const [assigneeIds, setAssigneeIds] = useState(task.assignees.map((a) => a.id));
  const [savingAssignees, setSavingAssignees] = useState(false);
  const [columnId, setColumnId] = useState(task.columnId);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false);
  const [confirmDeleteAttachment, setConfirmDeleteAttachment] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  async function saveAssignees(newIds) {
    setAssigneeIds(newIds);
    setSavingAssignees(true);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds: newIds }),
    });
    setSavingAssignees(false);
    onChanged();
  }

  async function saveColumn(newColumnId) {
    setColumnId(newColumnId);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: newColumnId }),
    });
    onChanged();
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/tasks/${task.id}/attachments`, { method: "POST", body: formData });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!res.ok) {
      const data = await res.json();
      setUploadError(data.error || "Error uploading file");
      return;
    }
    onChanged();
  }

  async function confirmAttachmentDelete() {
    if (!confirmDeleteAttachment) return;
    setDeleting(true);
    await fetch(`/api/tasks/${task.id}/attachments/${confirmDeleteAttachment.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDeleteAttachment(null);
    onChanged();
  }

  async function confirmTaskDelete() {
    setDeleting(true);
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    setDeleting(false);
    onDeleted();
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{task.title}</DialogTitle>
      <DialogContent>
        {task.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {task.description}
          </Typography>
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
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Saving...
            </Typography>
          )}
        </FormControl>

        <Divider sx={{ mb: 2 }} />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Attachments
          </Typography>
          <Button
            size="small"
            component="label"
            startIcon={uploading ? <CircularProgress size={14} /> : <UploadFileIcon />}
            disabled={uploading}
          >
            {uploading ? "Uploading..." : "Add file"}
            <input ref={fileInputRef} type="file" hidden onChange={handleUpload} />
          </Button>
        </Box>

        {uploadError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {uploadError}
          </Alert>
        )}

        {task.attachments.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
            No files attached yet — max size per file is 5MB.
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
                      aria-label="Download"
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => setConfirmDeleteAttachment(a)} aria-label="Delete">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <InsertDriveFileIcon fontSize="small" />
                </ListItemIcon>
                <MuiListItemText
                  primary={a.filename}
                  secondary={formatSize(a.size)}
                  primaryTypographyProps={{ variant: "body2" }}
                  secondaryTypographyProps={{ variant: "caption" }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: "space-between" }}>
        <Button color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmDeleteTask(true)}>
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
        onClose={() => setConfirmDeleteTask(false)}
        loading={deleting}
      />
      <ConfirmDialog
        open={!!confirmDeleteAttachment}
        title="Delete file"
        message={confirmDeleteAttachment ? `“${confirmDeleteAttachment.filename}” will be deleted. Are you sure?` : ""}
        onConfirm={confirmAttachmentDelete}
        onClose={() => setConfirmDeleteAttachment(null)}
        loading={deleting}
      />
    </Dialog>
  );
}
