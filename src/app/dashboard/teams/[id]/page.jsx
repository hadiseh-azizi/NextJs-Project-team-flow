"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Box, Typography, Button, Stack, Chip, Avatar, TextField, Alert, CircularProgress, IconButton,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import CloseIcon from "@mui/icons-material/Close";
import { useSession } from "next-auth/react";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function TeamDetailPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const [team, setTeam] = useState(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving] = useState(false);

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
    const res = await fetch(`/api/teams/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setInviting(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
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
        <Alert severity="error" sx={{ mb: 3, maxWidth: 400 }}>
          {error}
        </Alert>
      )}

      <Typography variant="h6" fontWeight={700} gutterBottom>
        Team members
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {team.members.map((m) => (
          <Chip
            key={m.id}
            avatar={<Avatar sx={{ fontSize: 12 }}>{m.name.slice(0, 1)}</Avatar>}
            label={m.id === team.manager.id ? `${m.name} · Manager` : m.name}
            variant="outlined"
            color={m.id === team.manager.id ? "primary" : "default"}
            onDelete={isManager && m.id !== team.manager.id ? () => setConfirmRemove(m) : undefined}
            deleteIcon={<CloseIcon />}
          />
        ))}
      </Stack>

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
