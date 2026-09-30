"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Alert, CircularProgress, Divider,
} from "@mui/material";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

const ACTION_LABELS = {
  moveTask: "Move task",
  toggleComplete: "Mark as done",
  editTask: "Edit task",
  other: "Other",
};

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// The project manager's queue for change requests submitted by members
// who don't have direct edit permission (see lib/authz.js's
// canEditProject and RequestChangeDialog). Only ever opened by the
// manager — the route this calls enforces that server-side too. Approving
// a `moveTask`/`toggleComplete` request re-applies it automatically (see
// the approval route); `applyError` on the result means that follow-through
// couldn't happen even though the request itself is now marked approved,
// and is shown rather than hidden so the manager knows to make the change
// by hand instead.
export default function ChangeRequestsPanel({ open, onClose, projectId, onApplied }) {
  const isMounted = useIsMounted();
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [decideError, setDecideError] = useState("");

  async function load() {
    setLoadError("");
    try {
      const data = await apiFetch(`/api/projects/${projectId}/change-requests?status=pending`);
      if (isMounted()) setRequests(data);
    } catch (err) {
      if (isMounted()) setLoadError(errorMessage(err, "Couldn't load change requests. Please try again."));
    }
  }

  useEffect(() => {
    if (open) {
      setRequests(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function decide(request, status) {
    if (decidingId) return;
    setDecidingId(request.id);
    setDecideError("");
    try {
      const updated = await apiFetch(`/api/projects/${projectId}/change-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!isMounted()) return;
      setRequests((prev) => (prev || []).filter((r) => r.id !== request.id));
      // A move/toggle that was actually re-applied changed a task, so the
      // board behind this dialog needs to reload to show it — a plain
      // reject or an edit/other approval never touches a task, and
      // reloading for those would just be wasted work.
      if (updated.status === "approved" && !updated.applyError && (updated.actionType === "moveTask" || updated.actionType === "toggleComplete")) {
        onApplied();
      }
    } catch (err) {
      if (isMounted()) setDecideError(errorMessage(err, "Couldn't update this request. Please try again."));
    } finally {
      if (isMounted()) setDecidingId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Change requests</DialogTitle>
      <DialogContent>
        {loadError && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>} sx={{ mb: 2 }}>
            {loadError}
          </Alert>
        )}

        {!requests && !loadError && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} aria-label="Loading change requests" />
          </Box>
        )}

        {requests && requests.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No pending requests right now.
          </Typography>
        )}

        {requests && requests.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {requests.map((r, i) => (
              <Box key={r.id}>
                {i > 0 && <Divider sx={{ mb: 2 }} />}
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.requester.name} · {ACTION_LABELS[r.actionType] || r.actionType}
                </Typography>
                {(r.targetTask || r.targetColumn) && (
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {r.targetTask ? `Task: ${r.targetTask.title}` : null}
                    {r.targetTask && r.actionType === "moveTask" ? " → " : null}
                    {r.actionType === "moveTask" ? (r.targetColumn ? r.targetColumn.name : "(column deleted)") : null}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                  {r.description}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {formatWhen(r.createdAt)}
                </Typography>
                <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                  <Button
                    size="small"
                    color="primary"
                    variant="outlined"
                    disabled={!!decidingId}
                    onClick={() => decide(r, "approved")}
                  >
                    {decidingId === r.id ? <CircularProgress size={14} aria-label="Working…" /> : "Approve"}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={!!decidingId}
                    onClick={() => decide(r, "rejected")}
                  >
                    Reject
                  </Button>
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {decideError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {decideError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
