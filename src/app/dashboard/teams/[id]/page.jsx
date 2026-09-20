"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Box, Typography, Button, Stack, Chip, Avatar, TextField, Alert, CircularProgress, Skeleton,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import CloseIcon from "@mui/icons-material/Close";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
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
      <Box>
        <Skeleton variant="text" width={60} height={20} />
        <Skeleton variant="text" width="35%" height={48} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="25%" height={24} sx={{ mb: 3 }} />
        <Stack direction="row" spacing={1}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" width={100} height={32} sx={{ borderRadius: 5 }} />
          ))}
        </Stack>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="overline" color="primary" fontWeight={700}>
        Team
      </Typography>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
        {team.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Team manager: {team.manager.name}
      </Typography>

      {isManager && (
        <Box
          component="form"
          onSubmit={handleInvite}
          sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 3, flexWrap: "wrap" }}
        >
          <TextField
            label="New member's email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            sx={{ width: { xs: "100%", sm: "auto" }, minWidth: { sm: 260 } }}
          />
          <Button type="submit" variant="contained" startIcon={<PersonAddIcon />} disabled={inviting} sx={{ width: { xs: "100%", sm: "auto" } }}>
            {inviting ? "Adding..." : "Add member"}
          </Button>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 3, maxWidth: 480 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3, maxWidth: 480 }} onClose={() => setSuccess("")}>
          {success}
        </Alert>
      )}

      <Typography variant="h6" fontWeight={700} gutterBottom>
        Team members
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: isManager && team.pendingInvitations?.length > 0 ? 4 : 0 }}>
        {team.members.map((m, i) => (
          <Chip
            key={m.id}
            avatar={<Avatar sx={{ fontSize: 12, bgcolor: pastelForString(m.id, mode), color: mode === "dark" ? "#F2EFE8" : "#1E1B16" }}>{avatarInitial(m.name)}</Avatar>}
            label={m.id === team.manager.id ? `${m.name} · Manager` : m.name}
            variant="outlined"
            color={m.id === team.manager.id ? "primary" : "default"}
            onDelete={
              isManager && m.id !== team.manager.id
                ? () => {
                    setRemoveError("");
                    setConfirmRemove(m);
                  }
                : undefined
            }
            deleteIcon={<CloseIcon titleAccess={`Remove ${m.name} from the team`} />}
          />
        ))}
      </Stack>

      {isManager && team.pendingInvitations?.length > 0 && (
        <Box>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Pending invitations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            These people have been invited by email but haven't created an account yet.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {team.pendingInvitations.map((inv, i) => (
              <Chip
                key={inv.id}
                icon={<ScheduleSendIcon sx={{ fontSize: 16 }} />}
                label={inv.email}
                variant="outlined"
                onDelete={cancelingInviteId ? undefined : () => cancelInvitation(inv.id)}
                deleteIcon={
                  cancelingInviteId === inv.id ? (
                    <CircularProgress size={14} aria-label="Cancelling…" />
                  ) : (
                    <CloseIcon titleAccess={`Cancel invitation to ${inv.email}`} />
                  )
                }
              />
            ))}
          </Stack>
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
