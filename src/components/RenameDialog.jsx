"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert } from "@mui/material";
import Field from "@/components/FormField";

// A small, single-field dialog for renaming an entity (project, team...).
// Mirrors ConfirmDialog's shape (title/content/actions, loading + error
// states) so renaming feels like the same family of interaction as the
// app's other dialogs, rather than a one-off.
export default function RenameDialog({ open, title, label, value, onSave, onClose, loading = false, error = "" }) {
  const [name, setName] = useState(value || "");

  // Reset the draft to the current name each time the dialog opens, so a
  // cancelled edit never leaves a stale draft behind for next time.
  useEffect(() => {
    if (open) setName(value || "");
  }, [open, value]);

  function handleSubmit(e) {
    e.preventDefault();
    if (loading || !name.trim()) return;
    onSave(name.trim());
  }

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Field
            autoFocus
            label={label}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            sx={{ mt: 1 }}
          />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading || !name.trim()}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
