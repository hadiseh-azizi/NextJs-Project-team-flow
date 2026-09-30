"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, TextField, Alert, CircularProgress } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { apiFetch, errorMessage } from "@/lib/apiFetch";

// Lets the project manager turn the "Share Board" link on/off and copy or
// regenerate it — the three actions in the spec's mock (Copy Link /
// Regenerate Link / Disable Sharing), plus the initial "Enable Sharing"
// state before a link exists yet. Fetches the current status itself on
// open rather than trusting anything already in `project` — the share
// link/token is deliberately left out of the main project DTO (see
// app/api/projects/[id]/share/route.js), so this is the only place it's
// ever loaded.
export default function ShareProjectDialog({ open, onClose, projectId }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null); // { shareEnabled, shareUrl }
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError("");
    setActionError("");
    setCopied(false);
    apiFetch(`/api/projects/${projectId}/share`)
      .then((data) => setStatus(data))
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load sharing settings. Please try again.")))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const fullUrl = status?.shareUrl && typeof window !== "undefined" ? `${window.location.origin}${status.shareUrl}` : status?.shareUrl || "";

  async function handleEnableOrRegenerate() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setCopied(false);
    try {
      const data = await apiFetch(`/api/projects/${projectId}/share`, { method: "POST" });
      setStatus(data);
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't create a share link. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const data = await apiFetch(`/api/projects/${projectId}/share`, { method: "DELETE" });
      setStatus(data);
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't disable sharing. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the field itself is
      // still selectable text, so this just skips the "Copied" feedback
      // rather than showing an error for something non-essential.
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Share project board</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={22} aria-label="Loading sharing settings…" />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : status.shareEnabled ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Anyone with this link can view this project board in read-only mode — no account required.
            </Typography>
            <TextField
              fullWidth
              size="small"
              label="Shared board link"
              value={fullUrl}
              InputProps={{ readOnly: true }}
              onFocus={(e) => e.target.select()}
            />
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 2 }}>
              <Button size="small" variant="contained" startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={handleCopy}>
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button size="small" color="inherit" disabled={busy} onClick={handleEnableOrRegenerate}>
                {busy ? "Regenerating..." : "Regenerate link"}
              </Button>
              <Button size="small" color="error" disabled={busy} onClick={handleDisable}>
                {busy ? "Disabling..." : "Disable sharing"}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              Regenerating replaces this link — anyone using the old one loses access immediately.
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Generate a link that lets anyone view this project's board — read-only, no sign-in — even while offline once they've opened it once.
            </Typography>
            <Button variant="contained" disabled={busy} onClick={handleEnableOrRegenerate}>
              {busy ? "Enabling..." : "Enable sharing"}
            </Button>
          </>
        )}
        {actionError && (
          <Alert severity="error" className="tf-shake" sx={{ mt: 2 }}>
            {actionError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
