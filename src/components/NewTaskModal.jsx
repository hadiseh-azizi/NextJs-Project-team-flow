"use client";

import { useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, MenuItem, Grid, Select, FormControl, Checkbox,
  ListItemText, Chip, Box, OutlinedInput, Typography, Alert, useMediaQuery,
  Divider, List, ListItem, ListItemIcon, IconButton,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CloseIcon from "@mui/icons-material/Close";
import ColorSwatchPicker from "@/components/ColorSwatchPicker";
import Field, { FieldLabel } from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";
import {
  MAX_FILE_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  ALLOWED_TYPES_SUMMARY,
  ATTACHMENT_ACCEPT,
  isAllowedAttachmentExtension,
} from "@/lib/attachmentPolicy";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);
const MAX_TOTAL_SIZE_MB = MAX_TOTAL_ATTACHMENTS_SIZE / (1024 * 1024);

export default function NewTaskModal({ projectId, columnId, columnName, assignableUsers, onClose, onCreated }) {
  const isMounted = useIsMounted();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [color, setColor] = useState(null);
  // Held client-side until submit — nothing is uploaded until "Create
  // task" is pressed, since these files only become real attachments
  // once a task exists for them to belong to (see handleSubmit).
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  function handleFilesSelected(e) {
    const picked = Array.from(e.target.files || []);
    // Reset immediately so picking the same file again later (e.g. after
    // removing it, or after fixing what got it rejected) fires another
    // change event.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (picked.length === 0) return;

    setFileError("");
    let nextFiles = files;
    let runningTotal = files.reduce((sum, f) => sum + f.size, 0);

    for (const file of picked) {
      if (!isAllowedAttachmentExtension(file.name)) {
        setFileError(`"${file.name}" isn't a supported file type.`);
        continue;
      }
      if (nextFiles.length >= MAX_ATTACHMENTS_PER_TASK) {
        setFileError(`A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments.`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`"${file.name}" is larger than the ${MAX_FILE_SIZE_MB}MB limit per file.`);
        continue;
      }
      if (runningTotal + file.size > MAX_TOTAL_ATTACHMENTS_SIZE) {
        setFileError(`Adding "${file.name}" would exceed the ${MAX_TOTAL_SIZE_MB}MB total attachment limit.`);
        continue;
      }
      runningTotal += file.size;
      nextFiles = [...nextFiles, file];
    }
    setFiles(nextFiles);
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const fields = {
        projectId,
        columnId,
        title,
        description,
        assigneeIds,
        dueDate: dueDate || null,
        color,
      };
      // Only sent as multipart when there are files to carry — a plain
      // JSON body (the original, still-supported request shape) is used
      // for every task created without attachments.
      if (files.length > 0) {
        const formData = new FormData();
        formData.append("data", JSON.stringify(fields));
        for (const file of files) formData.append("files", file);
        await apiFetch("/api/tasks", { method: "POST", body: formData });
      } else {
        await apiFetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
      }
      onCreated();
      onClose();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't create the task. Please try again."));
    } finally {
      if (isMounted()) setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          New task
          {columnName && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mt: 0.25, fontFamily: "'Plus Jakarta Sans', sans-serif", letterSpacing: 0, overflowWrap: "anywhere" }}>
              In column "{columnName}"
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Field
            autoFocus
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            sx={{ mb: 2.5, mt: 1 }}
          />
          <Field
            label="Description"
            optional
            multiline
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mb: 2.5 }}
          />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={7}>
              <FieldLabel id="assignees-label" component="div" optional>Assignees</FieldLabel>
              <FormControl fullWidth>
                <Select
                  labelId="assignees-label"
                  multiple
                  displayEmpty
                  value={assigneeIds}
                  onChange={(e) => setAssigneeIds(e.target.value)}
                  input={<OutlinedInput />}
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
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={5}>
              <Field
                type="date"
                label="Due date"
                optional
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Grid>
          </Grid>

          <FieldLabel component="div" optional sx={{ mt: 2.5 }}>Color</FieldLabel>
          <ColorSwatchPicker value={color} onChange={setColor} />

          <Divider sx={{ mt: 2.5, mb: 2 }} />

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
            <Typography variant="h6" component="h3" sx={{ fontSize: "0.9375rem" }}>
              Attachments
            </Typography>
            <Button
              size="small"
              color="primary"
              component="label"
              startIcon={<UploadFileIcon sx={{ fontSize: 18 }} />}
              disabled={files.length >= MAX_ATTACHMENTS_PER_TASK}
            >
              Add files
              <input ref={fileInputRef} type="file" hidden multiple accept={ATTACHMENT_ACCEPT} onChange={handleFilesSelected} />
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {ALLOWED_TYPES_SUMMARY} · up to {MAX_FILE_SIZE_MB}MB per file · {MAX_TOTAL_SIZE_MB}MB total
            {files.length > 0 && ` · ${files.length}/${MAX_ATTACHMENTS_PER_TASK} files`}
          </Typography>

          {fileError && (
            <Alert severity="error" className="tf-shake" sx={{ mb: 1 }} onClose={() => setFileError("")}>
              {fileError}
            </Alert>
          )}

          {files.length > 0 && (
            <List dense disablePadding sx={{ mb: 1 }}>
              {files.map((file, index) => (
                <ListItem
                  key={`${file.name}-${file.size}-${index}`}
                  disableGutters
                  secondaryAction={
                    <IconButton
                      size="small"
                      onClick={() => removeFile(index)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                  sx={{ pr: 5 }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <InsertDriveFileIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={file.name}
                    secondary={formatSize(file.size)}
                    primaryTypographyProps={{ variant: "body2", sx: { overflowWrap: "anywhere" } }}
                    secondaryTypographyProps={{ variant: "caption" }}
                  />
                </ListItem>
              ))}
            </List>
          )}

          {error && (
            <Alert severity="error" className="tf-shake" sx={{ mt: 2.5 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Creating..." : "Create task"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
