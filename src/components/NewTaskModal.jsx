"use client";

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, MenuItem, Grid, Select, InputLabel, FormControl, Checkbox,
  ListItemText, Chip, Box, OutlinedInput, Typography,
} from "@mui/material";
import ColorSwatchPicker from "@/components/ColorSwatchPicker";

export default function NewTaskModal({ projectId, columnId, columnName, assignableUsers, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [color, setColor] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/tasks", {
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
    setSubmitting(false);
    onCreated();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          New task
          {columnName && (
            <Typography variant="body2" color="text.secondary" fontWeight={400} sx={{ mt: 0.25 }}>
              In column "{columnName}"
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Title"
            fullWidth
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            label="Description (optional)"
            fullWidth
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={7}>
              <FormControl fullWidth>
                <InputLabel id="assignees-label">Assignees</InputLabel>
                <Select
                  labelId="assignees-label"
                  multiple
                  value={assigneeIds}
                  onChange={(e) => setAssigneeIds(e.target.value)}
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
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                type="date"
                label="Due date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Grid>
          </Grid>

          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: "block", mt: 2.5, mb: 1 }}>
            COLOR (OPTIONAL)
          </Typography>
          <ColorSwatchPicker value={color} onChange={setColor} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} color="inherit">
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
