"use client";

import { useEffect, useState } from "react";
import { Box, Button, Typography, CircularProgress } from "@mui/material";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

// Team invitations addressed to the signed-in user. Joining a team is only
// ever done from here (or by registering with the invited address) — a
// manager entering someone's email never adds an existing account directly.
// Renders nothing at all when there is nothing pending or the list can't be
// loaded; the rest of the Teams page doesn't depend on it.
export default function PendingInvitations({ onJoined }) {
  const isMounted = useIsMounted();
  const [invitations, setInvitations] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/invitations")
      .then((data) => {
        if (isMounted()) setInvitations(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function respond(invitation, accept) {
    if (busyId) return;
    setBusyId(invitation.id);
    setError("");
    try {
      await apiFetch(`/api/invitations/${invitation.id}`, { method: accept ? "POST" : "DELETE" });
      if (!isMounted()) return;
      setInvitations((list) => list.filter((i) => i.id !== invitation.id));
      if (accept) onJoined?.();
    } catch (err) {
      if (!isMounted()) return;
      if (err?.status === 404) {
        // Withdrawn or expired in the meantime — it's gone either way.
        setInvitations((list) => list.filter((i) => i.id !== invitation.id));
      } else {
        setError(errorMessage(err, "Something went wrong. Please try again."));
      }
    } finally {
      if (isMounted()) setBusyId(null);
    }
  }

  if (invitations.length === 0) return null;

  return (
    <Box component="section" aria-labelledby="my-invitations-heading" sx={{ mb: 4 }}>
      <Typography id="my-invitations-heading" variant="h6" component="h2" sx={{ mb: 1 }}>
        Invitations
      </Typography>
      {error && (
        <Typography role="alert" variant="body2" color="error" sx={{ mb: 1 }}>
          {error}
        </Typography>
      )}
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, borderTop: 1, borderColor: "divider" }}>
        {invitations.map((inv) => (
          <Box
            component="li"
            key={inv.id}
            sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", py: 1.25, borderBottom: 1, borderColor: "divider" }}
          >
            <Typography variant="body2" sx={{ flex: 1, minWidth: 200, overflowWrap: "anywhere" }}>
              <strong>{inv.inviterName}</strong> invited you to join <strong>{inv.teamName}</strong>
            </Typography>
            <Button size="small" variant="contained" disabled={!!busyId} onClick={() => respond(inv, true)}>
              {busyId === inv.id ? <CircularProgress size={14} aria-label="Working…" /> : "Accept"}
            </Button>
            <Button size="small" color="inherit" disabled={!!busyId} onClick={() => respond(inv, false)} sx={{ color: "text.secondary" }}>
              Decline
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
