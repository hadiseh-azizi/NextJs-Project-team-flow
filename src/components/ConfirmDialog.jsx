"use client";

import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Alert } from "@mui/material";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  // Most confirmations here guard a destructive action, hence the "error"
  // (red) default — but this dialog is also used for non-destructive
  // confirmations (e.g. marking a task completed), which pass
  // confirmColor="primary" and their own loadingLabel instead.
  confirmColor = "error",
  loadingLabel = "Deleting...",
  onConfirm,
  onClose,
  loading = false,
  error = "",
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
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
        {/* Cancel, not the destructive action, gets the initial focus —
            so pressing Enter right after the dialog opens can't confirm
            a delete by reflex. */}
        <Button onClick={onClose} color="inherit" disabled={loading} autoFocus>
          Cancel
        </Button>
        <Button onClick={onConfirm} color={confirmColor} variant="contained" disabled={loading}>
          {loading ? loadingLabel : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
