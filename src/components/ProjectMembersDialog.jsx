"use client";

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Avatar, Alert, CircularProgress,
  Divider, RadioGroup, FormControlLabel, Radio, Switch,
} from "@mui/material";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";
import { apiFetch, errorMessage } from "@/lib/apiFetch";

// Lets the project manager decide, one team member at a time, who besides
// them can open this project — team membership on its own no longer grants
// that. `projectMembers` is `null` for a project that predates this
// feature (every team member currently has access) or an array otherwise
// (only the manager and whoever's listed) — see lib/serialize.js. Either
// way, every row here reflects the project's actual current access, and
// touching Add/Remove on a still-`null` project is what turns it
// restricted (see applyProjectMembership in lib/authz.js), seeded with
// everyone who already had access so nobody but the person just removed
// loses anything.
//
// Below that, a second, independent section ("Project edit access")
// covers who can *edit* rather than just view — see lib/authz.js's
// canEditProject. The manager picks "everyone" or "only selected
// members", and in the latter case switches each eligible member on or
// off. The two lists overlap (an editor must already have access) but
// aren't the same thing, which is why they're two separate controls.
export default function ProjectMembersDialog({
  open, onClose, projectId, manager, teamMembers, projectMembers, editingMode, editors, onChanged,
}) {
  const { mode } = useThemeMode();
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState("");
  const [editorPendingId, setEditorPendingId] = useState(null);
  const [editorError, setEditorError] = useState("");

  const isRestricted = Array.isArray(projectMembers);
  const memberIds = isRestricted ? new Set(projectMembers.map((m) => m.id)) : null;
  const others = teamMembers.filter((m) => m.id !== manager.id);
  const editorIds = new Set((editors || []).map((e) => e.id));
  const isManagerApproval = editingMode === "manager_approval";
  // Only team members who can already open the project are eligible for
  // edit access (the editors route enforces the same rule server-side).
  const eligible = others.filter((m) => (isRestricted ? memberIds.has(m.id) : true));
  const [editorNotice, setEditorNotice] = useState("");

  async function toggleAccess(member, hasAccess) {
    if (pendingId) return;
    setPendingId(member.id);
    setError("");
    try {
      const data = hasAccess
        ? await apiFetch(`/api/projects/${projectId}/members?userId=${member.id}`, { method: "DELETE" })
        : await apiFetch(`/api/projects/${projectId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: member.id }),
          });
      onChanged(data);
    } catch (err) {
      setError(errorMessage(err, "Couldn't update this member's access. Please try again."));
    } finally {
      setPendingId(null);
    }
  }

  async function handleModeChange(e) {
    const value = e.target.value;
    if (modeSaving || value === editingMode) return;
    setModeSaving(true);
    setModeError("");
    try {
      const data = await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editingMode: value }),
      });
      onChanged(data);
    } catch (err) {
      setModeError(errorMessage(err, "Couldn't update the editing mode. Please try again."));
    } finally {
      setModeSaving(false);
    }
  }

  async function toggleEditor(member, canEdit) {
    if (editorPendingId) return;
    setEditorPendingId(member.id);
    setEditorError("");
    setEditorNotice("");
    try {
      const data = canEdit
        ? await apiFetch(`/api/projects/${projectId}/editors?userId=${member.id}`, { method: "DELETE" })
        : await apiFetch(`/api/projects/${projectId}/editors`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: member.id }),
          });
      onChanged(data);
      setEditorNotice(canEdit ? `${member.name} can no longer edit this project.` : `${member.name} can now edit this project.`);
    } catch (err) {
      setEditorError(errorMessage(err, "Couldn't update this member's editing permission. Please try again."));
    } finally {
      setEditorPendingId(null);
    }
  }

  const rowSx = { display: "flex", alignItems: "center", gap: 1.5, py: 1.25, borderBottom: "1px solid", borderColor: "divider", minHeight: 52 };
  const listSx = { listStyle: "none", m: 0, p: 0, borderTop: "1px solid", borderColor: "divider" };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Project access</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {isRestricted
            ? "Only the people below can open this project."
            : "This project hasn't been restricted yet — every team member can currently open it. Adding or removing someone below starts managing access individually."}
        </Typography>

        <Box component="ul" sx={listSx}>
          <Box component="li" sx={rowSx}>
            <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(manager.id, mode) }}>
              {avatarInitial(manager.name)}
            </Avatar>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: "anywhere" }}>
              {manager.name}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
                Project manager
              </Typography>
            </Typography>
          </Box>

          {others.length === 0 ? (
            <Box component="li" sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No other team members yet.
              </Typography>
            </Box>
          ) : (
            others.map((m) => {
              const hasAccess = isRestricted ? memberIds.has(m.id) : true;
              return (
                <Box component="li" key={m.id} sx={rowSx}>
                  <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(m.id, mode) }}>
                    {avatarInitial(m.name)}
                  </Avatar>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: "anywhere" }}>
                    {m.name}
                  </Typography>
                  <Button
                    size="small"
                    color={hasAccess ? "error" : "primary"}
                    aria-label={hasAccess ? `Remove ${m.name} from this project` : `Add ${m.name} to this project`}
                    disabled={!!pendingId}
                    onClick={() => toggleAccess(m, hasAccess)}
                  >
                    {pendingId === m.id ? <CircularProgress size={14} aria-label="Saving…" /> : hasAccess ? "Remove" : "Add"}
                  </Button>
                </Box>
              );
            })
          )}
        </Box>

        {error && (
          <Alert severity="error" className="tf-shake" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        <Divider sx={{ mt: 3, mb: 2.5 }} />

        <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
          Project edit access
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Decides who can change tasks and columns. Everyone with access can always view the project.
        </Typography>
        <RadioGroup value={editingMode} onChange={handleModeChange} aria-label="Who can edit this project">
          <FormControlLabel
            value="everyone"
            disabled={modeSaving}
            control={<Radio size="small" />}
            label={<Typography variant="body2">Everyone with access can edit</Typography>}
          />
          <FormControlLabel
            value="manager_approval"
            disabled={modeSaving}
            control={<Radio size="small" />}
            label={<Typography variant="body2">Only members I select can edit</Typography>}
          />
        </RadioGroup>
        {modeError && (
          <Alert severity="error" className="tf-shake" sx={{ mt: 1.5 }}>
            {modeError}
          </Alert>
        )}

        <Box component="ul" sx={{ ...listSx, mt: 2 }} aria-label="Edit access by member">
          <Box component="li" sx={rowSx}>
            <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(manager.id, mode) }}>
              {avatarInitial(manager.name)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>{manager.name}</Typography>
              {manager.email && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                  {manager.email}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">Always can edit</Typography>
          </Box>
          {eligible.map((m) => {
            const canEdit = isManagerApproval ? editorIds.has(m.id) : true;
            const saving = editorPendingId === m.id;
            return (
              <Box component="li" key={m.id} sx={rowSx}>
                <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(m.id, mode) }}>
                  {avatarInitial(m.name)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>{m.name}</Typography>
                  {m.email && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                      {m.email}
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color={canEdit ? "text.primary" : "text.secondary"} sx={{ whiteSpace: "nowrap" }}>
                  {canEdit ? "Can edit" : "View only"}
                </Typography>
                {saving ? (
                  <CircularProgress size={18} aria-label="Saving…" sx={{ mx: 1.25 }} />
                ) : (
                  <Switch
                    size="small"
                    checked={canEdit}
                    disabled={!isManagerApproval || !!editorPendingId}
                    onChange={() => toggleEditor(m, canEdit)}
                    inputProps={{ "aria-label": `Edit access for ${m.name}` }}
                  />
                )}
              </Box>
            );
          })}
          {eligible.length === 0 && (
            <Box component="li" sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No other team members have access to this project yet.
              </Typography>
            </Box>
          )}
        </Box>
        {!isManagerApproval && eligible.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Switches are locked while everyone can edit. Choose “Only members I select can edit” to set them individually.
          </Typography>
        )}
        <Box role="status" aria-live="polite" sx={{ mt: 1.5, minHeight: 0 }}>
          {editorNotice && <Alert severity="success" sx={{ py: 0 }}>{editorNotice}</Alert>}
        </Box>
        {editorError && (
          <Alert severity="error" className="tf-shake" sx={{ mt: 1.5 }}>
            {editorError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
