"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Alert } from "@mui/material";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

// Account deletion needs the current password and the account's email typed
// back. The server enforces both (api/account); this dialog only collects
// them. If the person still manages a team the server refuses and says which,
// and that message is shown here as is.
export default function DeleteAccountDialog({ open, email, onClose }) {
  const isMounted = useIsMounted();
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmEmail("");
      setError("");
    }
  }, [open]);

  const ready = password && confirmEmail.trim().toLowerCase() === (email || "").toLowerCase();

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading || !ready) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmEmail }),
      });
      // The account is gone, so the session is already invalid; this clears the cookie.
      await signOut({ callbackUrl: "/" });
    } catch (err) {
      if (!isMounted()) return;
      setError(errorMessage(err, "Couldn't delete your account. Please try again."));
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Delete account</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This permanently deletes your account and removes you from every team you belong to. Work you did in those teams stays with them. This can't be undone.
          </DialogContentText>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            sx={{ mb: 2 }}
          />
          <Field
            label={`Type ${email} to confirm`}
            autoComplete="off"
            required
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            disabled={loading}
          />
          {error && (
            <Alert severity="error" className="tf-shake" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={loading} autoFocus>
            Cancel
          </Button>
          <Button type="submit" color="error" variant="contained" disabled={loading || !ready}>
            {loading ? "Deleting..." : "Delete account"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
