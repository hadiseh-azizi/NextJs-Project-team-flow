"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert, RadioGroup, FormControlLabel, Radio, Typography, MenuItem } from "@mui/material";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

const MAX_DESCRIPTION_LENGTH = 1000;

// Lets a project member without edit permission (see
// lib/authz.js's canEditProject) propose a change instead of being simply
// blocked. `task` is the task this is about, if any — omitting it (e.g.
// from the board toolbar, for something like "please add a Blocked
// column") makes this a general, untargeted request. When a task is
// given, the two structured options ("Move to another column" and "Mark
// as done") are things the manager's approval can apply automatically
// (see the change-requests approval route); "Something else" is always
// just a description for the manager to read and act on by hand.
export default function RequestChangeDialog({ open, onClose, projectId, task, columns, onSubmitted }) {
  const isMounted = useIsMounted();
  const [actionType, setActionType] = useState("other");
  const [targetColumnId, setTargetColumnId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const showMoveOption = !!task && (columns || []).length > 0;
  const showCompleteOption = !!task && !task.completed;
  const otherColumns = task ? (columns || []).filter((c) => c.id !== task.columnId) : [];

  // Reset to a clean draft each time the dialog opens, and default to the
  // most likely structured option when one applies — a member opening
  // this from a task usually has something specific in mind, not "other".
  useEffect(() => {
    if (!open) return;
    setDescription("");
    setError("");
    if (showMoveOption) {
      setActionType("moveTask");
      setTargetColumnId(otherColumns[0]?.id || "");
    } else if (showCompleteOption) {
      setActionType("toggleComplete");
    } else {
      setActionType(task ? "editTask" : "other");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Please describe the change you'd like.");
      return;
    }
    if (actionType === "moveTask" && !targetColumnId) {
      setError("Please choose a destination column.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await apiFetch(`/api/projects/${projectId}/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          description: trimmed,
          targetTaskId: task ? task.id : undefined,
          targetColumnId: actionType === "moveTask" ? targetColumnId : undefined,
        }),
      });
      if (!isMounted()) return;
      onSubmitted(created);
      onClose();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't submit the request. Please try again."));
    } finally {
      if (isMounted()) setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Request a change</DialogTitle>
        <DialogContent>
          {task && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, overflowWrap: "anywhere" }}>
              About: {task.title}
            </Typography>
          )}

          {(showMoveOption || showCompleteOption) && (
            <RadioGroup value={actionType} onChange={(e) => setActionType(e.target.value)} sx={{ mb: 2 }}>
              {showMoveOption && (
                <FormControlLabel value="moveTask" control={<Radio size="small" />} label={<Typography variant="body2">Move to another column</Typography>} />
              )}
              {showCompleteOption && (
                <FormControlLabel value="toggleComplete" control={<Radio size="small" />} label={<Typography variant="body2">Mark as done</Typography>} />
              )}
              <FormControlLabel
                value={task ? "editTask" : "other"}
                control={<Radio size="small" />}
                label={<Typography variant="body2">Something else</Typography>}
              />
            </RadioGroup>
          )}

          {actionType === "moveTask" && (
            <Field
              select
              label="Destination column"
              value={targetColumnId}
              onChange={(e) => setTargetColumnId(e.target.value)}
              disabled={submitting}
              sx={{ mb: 2 }}
            >
              {otherColumns.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Field>
          )}

          <Field
            label="Description"
            placeholder="Describe what you'd like changed and why"
            multiline
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
            disabled={submitting}
            required
            autoFocus={!showMoveOption && !showCompleteOption}
          />

          {error && (
            <Alert severity="error" className="tf-shake" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Sending..." : "Send request"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
