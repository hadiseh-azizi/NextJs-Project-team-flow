"use client";

import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Alert } from "@mui/material";

// Mirrors ConfirmDialog's shape exactly (title/message/loading/error), but
// for prompts where neither option is a "Cancel" — e.g. "Move to Completed"
// vs. "Keep Here" are both legitimate outcomes, not an escape hatch. Used
// by the second step of task completion in KanbanBoard.jsx.
export default function ChoiceDialog({
  open,
  title,
  message,
  primaryLabel,
  primaryLoadingLabel = "Working...",
  onPrimary,
  secondaryLabel,
  onSecondary,
  loading = false,
  error = "",
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onSecondary} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ overflowWrap: "anywhere" }}>{message}</DialogContentText>
        {error && (
          <Alert severity="error" className="tf-shake" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onSecondary} color="inherit" disabled={loading} autoFocus>
          {secondaryLabel}
        </Button>
        <Button onClick={onPrimary} color="primary" variant="contained" disabled={loading}>
          {loading ? primaryLoadingLabel : primaryLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
