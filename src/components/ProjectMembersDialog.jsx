"use client";

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Avatar, Alert, CircularProgress,
  Divider, RadioGroup, FormControlLabel, Radio,
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
// Below that, a second, independent section covers who can *edit* rather
// than just view — see lib/authz.js's canEditProject. The two lists
// overlap (an editor must already have access) but aren't the same thing,
// which is why they're two separate controls rather than one.
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
    try {
      const data = canEdit
        ? await apiFetch(`/api/projects/${projectId}/editors?userId=${member.id}`, { method: "DELETE" })
        : await apiFetch(`/api/projects/${projectId}/editors`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: member.id }),
          });
      onChanged(data);
    } catch (err) {
      setEditorError(errorMessage(err, "Couldn't update this member's editing permission. Please try again."));
    } finally {
      setEditorPendingId(null);
    }
  }

  const rowSx = { display: "flex", alignItems: "center", gap: 1.5, py: 1.25, borderBottom: "1px solid", borderColor: "divider", minHeight: 52 };
  const listSx = { listStyle: "none", m: 0, p: 0, borderTop: "1px solid", borderColor: "divider" };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
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

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Editing permission
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Controls who can directly edit tasks and columns in this project. This is separate from who can view it, above.
        </Typography>
        <RadioGroup value={editingMode} onChange={handleModeChange}>
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
            label={<Typography variant="body2">Manager approval required</Typography>}
          />
        </RadioGroup>
        {modeError && (
          <Alert severity="error" className="tf-shake" sx={{ mt: 1.5 }}>
            {modeError}
          </Alert>
        )}

        {isManagerApproval && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Everyone else can still view the project and submit change requests.
            </Typography>
            <Box component="ul" sx={listSx}>
              <Box component="li" sx={rowSx}>
                <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(manager.id, mode) }}>
                  {avatarInitial(manager.name)}
                </Avatar>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: "anywhere" }}>
                  {manager.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Can always edit
                </Typography>
              </Box>
              {others
                .filter((m) => (isRestricted ? memberIds.has(m.id) : true))
                .map((m) => {
                  const canEdit = editorIds.has(m.id);
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
                        color={canEdit ? "error" : "primary"}
                        aria-label={canEdit ? `Remove ${m.name}'s editing permission` : `Grant ${m.name} editing permission`}
                        disabled={!!editorPendingId}
                        onClick={() => toggleEditor(m, canEdit)}
                      >
                        {editorPendingId === m.id ? <CircularProgress size={14} aria-label="Saving…" /> : canEdit ? "Revoke" : "Grant"}
                      </Button>
                    </Box>
                  );
                })}
            </Box>
            {editorError && (
              <Alert severity="error" className="tf-shake" sx={{ mt: 1.5 }}>
                {editorError}
              </Alert>
            )}
          </Box>
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
