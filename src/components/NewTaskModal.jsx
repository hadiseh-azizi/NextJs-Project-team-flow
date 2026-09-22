"use client";

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, MenuItem, Grid, Select, FormControl, Checkbox,
  ListItemText, Chip, Box, OutlinedInput, Typography, Alert, useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ColorSwatchPicker from "@/components/ColorSwatchPicker";
import Field, { FieldLabel } from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

export default function NewTaskModal({ projectId, columnId, columnName, assignableUsers, onClose, onCreated }) {
  const isMounted = useIsMounted();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [color, setColor] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          columnId,
          title,
          description,
          assigneeIds,
          dueDate: dueDate || null,
          color,
        }),
      });
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
          {error && (
            <Alert severity="error" sx={{ mt: 2.5 }}>
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
