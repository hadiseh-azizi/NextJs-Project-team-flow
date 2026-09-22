"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Box, Typography, Button, Avatar, Alert, CircularProgress, Skeleton,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import Field from "@/components/FormField";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";

export default function TeamDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { mode } = useThemeMode();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [team, setTeam] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [cancelingInviteId, setCancelingInviteId] = useState(null);

  async function load() {
    const isCurrent = nextRequest();
    try {
      const data = await apiFetch(`/api/teams/${id}`);
      if (!isMounted() || !isCurrent()) return;
      setTeam(data);
      setLoadError("");
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      if (err.status === 401) {
        router.push("/login");
        return;
      }
      setLoadError(errorMessage(err, "Couldn't load this team. Please try again."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isManager = team && session?.user?.id === team.manager.id;

  async function handleInvite(e) {
    e.preventDefault();
    if (inviting) return;
    setInviting(true);
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch(`/api/teams/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!isMounted()) return;
      setSuccess(
        data.status === "invited"
          ? `${email} doesn't have an account yet — an invitation email was sent. They'll join automatically once they sign up.`
          : `${email} was added to the team.`
      );
      setEmail("");
      load();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't add this member. Please try again."));
    } finally {
      if (isMounted()) setInviting(false);
    }
  }

  async function confirmRemoveMember() {
    if (!confirmRemove || removing) return;
    setRemoving(true);
    setRemoveError("");
    try {
      await apiFetch(`/api/teams/${id}/members?userId=${confirmRemove.id}`, { method: "DELETE" });
      if (!isMounted()) return;
      setConfirmRemove(null);
      await load();
    } catch (err) {
      // Keep the confirmation open on failure and show the error in it —
      // closing here (and only surfacing the error on the page underneath,
      // which the dialog was covering) would look like nothing happened.
      if (isMounted()) setRemoveError(errorMessage(err, "Couldn't remove this member. Please try again."));
    } finally {
      if (isMounted()) setRemoving(false);
    }
  }

  async function cancelInvitation(invitationId) {
    // Guards against a double-click firing two DELETEs for the same
    // invitation while the first is still in flight.
    if (cancelingInviteId) return;
    setCancelingInviteId(invitationId);
    setError("");
    try {
      await apiFetch(`/api/teams/${id}/invitations/${invitationId}`, { method: "DELETE" });
      if (!isMounted()) return;
      await load();
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't cancel this invitation. Please try again."));
    } finally {
      if (isMounted()) setCancelingInviteId(null);
    }
  }

  if (loadError && !team) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
        {loadError}
      </Alert>
    );
  }

  if (!team) {
    return (
      <Box aria-busy="true" aria-label="Loading team">
        <Skeleton variant="text" width={64} height={20} />
        <Skeleton variant="text" width="35%" height={44} />
        <Skeleton variant="text" width="22%" height={22} sx={{ mb: 4 }} />
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.25 }}>
            <Skeleton variant="circular" width={28} height={28} />
            <Skeleton variant="text" width={140} height={22} />
          </Box>
        ))}
      </Box>
    );
  }

  const rowSx = { display: "flex", alignItems: "center", gap: 1.5, py: 1.25, borderBottom: "1px solid", borderColor: "divider", minHeight: 52 };
  const listSx = { listStyle: "none", m: 0, p: 0, borderTop: "1px solid", borderColor: "divider" };
  const hasInvites = isManager && team.pendingInvitations?.length > 0;

  return (
    <Box>
      <PageHeader
        back={{ href: "/dashboard/teams", label: "Teams" }}
        title={team.name}
        description={`Managed by ${team.manager.name}`}
      />

      {isManager && (
        <Box component="form" onSubmit={handleInvite} sx={{ display: "flex", gap: 1.5, alignItems: "flex-end", mb: 3, flexWrap: "wrap", maxWidth: 520 }}>
          <Field
            label="New member's email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ flex: "1 1 240px" }}
          />
          <Button type="submit" variant="contained" disabled={inviting} sx={{ width: { xs: "100%", sm: "auto" } }}>
            {inviting ? "Adding..." : "Add member"}
          </Button>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 3, maxWidth: 520 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3, maxWidth: 520 }} onClose={() => setSuccess("")}>
          {success}
        </Alert>
      )}

      <Box component="section" aria-labelledby="team-members-heading" sx={{ maxWidth: 520, mb: hasInvites ? 5 : 0 }}>
        <Typography id="team-members-heading" variant="h6" component="h2" sx={{ mb: 1 }}>
          Team members
        </Typography>
        <Box component="ul" sx={listSx}>
          {team.members.map((m) => (
            <Box component="li" key={m.id} sx={rowSx}>
              <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(m.id, mode) }}>{avatarInitial(m.name)}</Avatar>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: "anywhere" }}>
                {m.name}
                {m.id === team.manager.id && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
                    Manager
                  </Typography>
                )}
              </Typography>
              {isManager && m.id !== team.manager.id && (
                <Button
                  size="small"
                  color="error"
                  aria-label={`Remove ${m.name} from the team`}
                  onClick={() => {
                    setRemoveError("");
                    setConfirmRemove(m);
                  }}
                >
                  Remove
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {hasInvites && (
        <Box component="section" aria-labelledby="team-invites-heading" sx={{ maxWidth: 520 }}>
          <Typography id="team-invites-heading" variant="h6" component="h2">
            Pending invitations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            These people have been invited by email but haven't created an account yet.
          </Typography>
          <Box component="ul" sx={listSx}>
            {team.pendingInvitations.map((inv) => (
              <Box component="li" key={inv.id} sx={rowSx}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {inv.email}
                </Typography>
                <Button
                  size="small"
                  color="inherit"
                  aria-label={`Cancel invitation to ${inv.email}`}
                  disabled={!!cancelingInviteId}
                  onClick={() => cancelInvitation(inv.id)}
                  sx={{ color: "text.secondary" }}
                >
                  {cancelingInviteId === inv.id ? <CircularProgress size={14} aria-label="Cancelling…" /> : "Cancel invitation"}
                </Button>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove member"
        message={confirmRemove ? `“${confirmRemove.name}” will be removed from the team and will lose access to this team's projects.` : ""}
        onConfirm={confirmRemoveMember}
        onClose={() => {
          setConfirmRemove(null);
          setRemoveError("");
        }}
        loading={removing}
        error={removeError}
      />
    </Box>
  );
}
