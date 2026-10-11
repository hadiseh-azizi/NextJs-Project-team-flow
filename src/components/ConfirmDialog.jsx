"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Alert } from "@mui/material";
import Field from "@/components/FormField";

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
  // When set, the confirm button stays disabled until this exact text is
  // typed (used for deletions that take other things with them).
  requireText = "",
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const blocked = !!requireText && typed.trim() !== requireText.trim();

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ overflowWrap: "anywhere" }}>{message}</DialogContentText>
        {requireText && (
          <Field
            label={`Type “${requireText}” to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={loading}
            autoComplete="off"
            sx={{ mt: 2 }}
          />
        )}
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
        <Button onClick={onConfirm} color={confirmColor} variant="contained" disabled={loading || blocked}>
          {loading ? loadingLabel : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
