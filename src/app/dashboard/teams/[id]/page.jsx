"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Box, Typography, Button, Stack, Chip, Avatar, TextField, Alert, CircularProgress,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import CloseIcon from "@mui/icons-material/Close";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import { useSession } from "next-auth/react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";

export default function TeamDetailPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const { mode } = useThemeMode();
  const [team, setTeam] = useState(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [cancelingInviteId, setCancelingInviteId] = useState(null);

  async function load() {
    const res = await fetch(`/api/teams/${id}`);
    if (res.ok) setTeam(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isManager = team && session?.user?.id === team.manager.id;

  async function handleInvite(e) {
    e.preventDefault();
    setInviting(true);
    setError("");
    setSuccess("");
    const res = await fetch(`/api/teams/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setInviting(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setSuccess(
      data.status === "invited"
        ? `${email} doesn't have an account yet — an invitation email was sent. They'll join automatically once they sign up.`
        : `${email} was added to the team.`
    );
    setEmail("");
    load();
  }

  async function confirmRemoveMember() {
    if (!confirmRemove) return;
    setRemoving(true);
    await fetch(`/api/teams/${id}/members?userId=${confirmRemove.id}`, { method: "DELETE" });
    setRemoving(false);
    setConfirmRemove(null);
    load();
  }

  async function cancelInvitation(invitationId) {
    setCancelingInviteId(invitationId);
    await fetch(`/api/teams/${id}/invitations/${invitationId}`, { method: "DELETE" });
    setCancelingInviteId(null);
    load();
  }

  if (!team) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
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
        {team.members.map((m) => (
          <Chip
            key={m.id}
            avatar={<Avatar sx={{ fontSize: 12, bgcolor: pastelForString(m.id, mode), color: mode === "dark" ? "#F2EFEA" : "#1C1B19" }}>{m.name.slice(0, 1)}</Avatar>}
            label={m.id === team.manager.id ? `${m.name} · Manager` : m.name}
            variant="outlined"
            color={m.id === team.manager.id ? "primary" : "default"}
            onDelete={isManager && m.id !== team.manager.id ? () => setConfirmRemove(m) : undefined}
            deleteIcon={<CloseIcon />}
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
            {team.pendingInvitations.map((inv) => (
              <Chip
                key={inv.id}
                icon={<ScheduleSendIcon sx={{ fontSize: 16 }} />}
                label={inv.email}
                variant="outlined"
                onDelete={() => cancelInvitation(inv.id)}
                deleteIcon={cancelingInviteId === inv.id ? <CircularProgress size={14} /> : <CloseIcon />}
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
        onClose={() => setConfirmRemove(null)}
        loading={removing}
      />
    </Box>
  );
}
