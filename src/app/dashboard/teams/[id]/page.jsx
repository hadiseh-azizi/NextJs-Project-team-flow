"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Box, Typography, Button, Avatar, Alert, CircularProgress, Skeleton,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import Field from "@/components/FormField";
import EmptyState from "@/components/EmptyState";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import RenameDialog from "@/components/RenameDialog";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { teamColorForId } from "@/lib/entityColor";
import { avatarInitial } from "@/lib/avatarInitial";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import TeamMembersSkeleton, { TeamHeaderSkeleton, rowSx, listSx, panelSx } from "@/components/TeamMembersSkeleton";
import TeamFlowLoader from "@/components/TeamFlowLoader";
import { readRememberedShape, readStoredShape, rememberShape, teamShapeFromTeam } from "@/lib/loadShapeCache";

// The branded loader only appears if loading is still going after this
// long, so a fast response does not flash a spinner for a few frames.
const LOADER_DELAY_MS = 200;

export default function TeamDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { mode } = useThemeMode();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [team, setTeam] = useState(null);
  useDocumentTitle(team?.name, "Team");
  const [loadError, setLoadError] = useState("");
  // 404 (no such team) and 403 (not a member) are shown the same way.
  const [notFoundState, setNotFoundState] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [cancelingInviteId, setCancelingInviteId] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  // "delete" (manager) or "leave" (member): which confirmation is open.
  const [teamAction, setTeamAction] = useState(null);
  const [teamActionBusy, setTeamActionBusy] = useState(false);
  const [teamActionError, setTeamActionError] = useState("");
  const userId = session?.user?.id;
  // How this team looked the last time it loaded (this tab, this account):
  // member and invitation counts. null when there is nothing to go on.
  const [rememberedShape, setRememberedShape] = useState(() => readRememberedShape("team", userId, id));
  const [showLoader, setShowLoader] = useState(false);

  async function load() {
    const isCurrent = nextRequest();
    try {
      const data = await apiFetch(`/api/teams/${id}`);
      if (!isMounted() || !isCurrent()) return;
      setTeam(data);
      setLoadError("");
      setNotFoundState(false);
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      if (err.status === 401) {
        router.push("/login");
        return;
      }
      if (err.status === 404 || err.status === 403) {
        setNotFoundState(true);
        return;
      }
      setLoadError(errorMessage(err, "Couldn't load this team. Please try again."));
    }
  }

  useEffect(() => {
    setNotFoundState(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isManager = team && session?.user?.id === team.manager.id;

  // After a full reload the in-memory shape is gone but the tab's
  // sessionStorage copy is not; read it once the user id is known (never
  // during render, which would not match the server).
  useEffect(() => {
    setRememberedShape(readStoredShape("team", userId, id));
  }, [userId, id]);

  // Remember the shape after every successful load and change.
  useEffect(() => {
    if (team && userId) rememberShape("team", userId, id, teamShapeFromTeam(team, isManager));
  }, [team, userId, id, isManager]);

  // Delay the branded loader slightly (see LOADER_DELAY_MS). While the
  // session is still loading the user id is unknown, so a remembered shape
  // cannot be looked up yet: wait for it rather than flash the loader and
  // then swap it for the placeholder rows.
  const waitingWithoutShape = !team && !loadError && !rememberedShape && sessionStatus !== "loading";
  useEffect(() => {
    if (!waitingWithoutShape) {
      setShowLoader(false);
      return undefined;
    }
    const t = setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => clearTimeout(t);
  }, [waitingWithoutShape]);

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
      // The response is the same whether or not the address has an account
      // (see api/teams/[id]/members), so this message can't say which.
      setSuccess(`Invitation sent to ${email}. They'll join once they accept it, or when they sign up.`);
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

  async function confirmTeamAction() {
    if (!teamAction || teamActionBusy) return;
    setTeamActionBusy(true);
    setTeamActionError("");
    try {
      if (teamAction === "delete") {
        await apiFetch(`/api/teams/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmName: team.name }),
        });
      } else {
        await apiFetch(`/api/teams/${id}/leave`, { method: "POST" });
      }
      if (!isMounted()) return;
      router.push("/dashboard/teams");
    } catch (err) {
      if (!isMounted()) return;
      setTeamActionError(
        errorMessage(err, teamAction === "delete" ? "Couldn't delete the team. Please try again." : "Couldn't leave the team. Please try again.")
      );
      setTeamActionBusy(false);
    }
  }

  async function handleRenameTeam(newName) {
    if (renaming) return;
    setRenaming(true);
    setRenameError("");
    try {
      const data = await apiFetch(`/api/teams/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!isMounted()) return;
      // The route returns the full team DTO, so the new name shows up
      // immediately without a separate reload.
      setTeam(data);
      setRenameOpen(false);
    } catch (err) {
      if (!isMounted()) return;
      setRenameError(errorMessage(err, "Couldn't rename the team. Please try again."));
    } finally {
      if (isMounted()) setRenaming(false);
    }
  }

  if (notFoundState) {
    return (
      <EmptyState
        title="Team not found"
        description="It may have been deleted, or you may not be a member of it."
        action={
          <Button component={Link} href="/dashboard/teams" variant="contained">
            Back to teams
          </Button>
        }
      />
    );
  }

  if (loadError && !team) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
        {loadError}
      </Alert>
    );
  }

  // Whether this person manages the team comes from the session, so the
  // page waits for it rather than drawing manager controls as absent.
  if (!team || sessionStatus === "loading") {
    return (
      <Box>
        {rememberedShape ? (
          <TeamHeaderSkeleton shape={rememberedShape} />
        ) : (
          <Box aria-hidden>
            <Skeleton variant="text" width={64} height={20} />
            <Skeleton variant="text" width="35%" height={44} />
            <Skeleton variant="text" width="22%" height={22} sx={{ mb: 4 }} />
          </Box>
        )}
        {rememberedShape ? (
          // Counts remembered from the last load -> exactly that many rows,
          // in the real panels. Not known -> the Team Flow loader (after a
          // short delay) and no rows: we do not guess.
          <Box role="status" aria-busy="true" aria-label="Loading team" className="tf-fade-in">
            <TeamMembersSkeleton shape={rememberedShape} />
          </Box>
        ) : showLoader ? (
          <TeamFlowLoader label="Loading team" />
        ) : (
          <Box aria-busy="true" sx={{ minHeight: 240 }} />
        )}
      </Box>
    );
  }

  const hasInvites = isManager && team.pendingInvitations?.length > 0;

  return (
    <Box>
      <PageHeader
        back={{ href: "/dashboard/teams", label: "Teams" }}
        accent={teamColorForId(team.id, mode)}
        title={team.name}
        description={`Managed by ${team.manager.name}`}
        actions={
          isManager ? (
            <>
              <Button
                color="inherit"
                startIcon={<EditOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => {
                  setRenameError("");
                  setRenameOpen(true);
                }}
              >
                Rename
              </Button>
              <Button
                color="error"
                onClick={() => {
                  setTeamActionError("");
                  setTeamAction("delete");
                }}
              >
                Delete team
              </Button>
            </>
          ) : (
            <Button
              color="inherit"
              onClick={() => {
                setTeamActionError("");
                setTeamAction("leave");
              }}
            >
              Leave team
            </Button>
          )
        }
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
            {inviting ? "Inviting..." : "Invite member"}
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

      <Box component="section" aria-labelledby="team-members-heading" className="tf-topline" sx={{ ...panelSx, mb: hasInvites ? 3 : 0 }}>
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
        <Box component="section" aria-labelledby="team-invites-heading" className="tf-topline" sx={panelSx}>
          <Typography id="team-invites-heading" variant="h6" component="h2">
            Pending invitations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            These people have been invited by email and haven't joined yet.
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

      <ConfirmDialog
        open={teamAction === "delete"}
        title="Delete team"
        message={`This permanently deletes “${team.name}”, all of its projects, their boards and tasks (including attachments), and any pending invitations. Members keep their accounts. This can't be undone.`}
        confirmLabel="Delete team"
        loadingLabel="Deleting..."
        requireText={team.name}
        onConfirm={confirmTeamAction}
        onClose={() => setTeamAction(null)}
        loading={teamActionBusy}
        error={teamAction === "delete" ? teamActionError : ""}
      />

      <ConfirmDialog
        open={teamAction === "leave"}
        title="Leave team"
        message={`You'll lose access to “${team.name}” and its projects, and you'll be removed from any tasks assigned to you there. The manager can invite you again.`}
        confirmLabel="Leave team"
        loadingLabel="Leaving..."
        onConfirm={confirmTeamAction}
        onClose={() => setTeamAction(null)}
        loading={teamActionBusy}
        error={teamAction === "leave" ? teamActionError : ""}
      />

      <RenameDialog
        open={renameOpen}
        title="Rename team"
        label="Team name"
        value={team.name}
        onSave={handleRenameTeam}
        onClose={() => {
          setRenameOpen(false);
          setRenameError("");
        }}
        loading={renaming}
        error={renameError}
      />
    </Box>
  );
}
