"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Box, Typography, Button, Skeleton, Alert, Avatar, AvatarGroup, Tooltip,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { projectColorForId } from "@/lib/entityColor";
import { avatarInitial } from "@/lib/avatarInitial";
import GradientProgress from "@/components/GradientProgress";
import KanbanBoard from "@/components/KanbanBoard";
import ConfirmDialog from "@/components/ConfirmDialog";
import RenameDialog from "@/components/RenameDialog";
import ProjectMembersDialog from "@/components/ProjectMembersDialog";
import ShareProjectDialog from "@/components/ShareProjectDialog";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";
import { projectProgress } from "@/lib/taskCompletion";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { mode } = useThemeMode();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [project, setProject] = useState(null);
  useDocumentTitle(project?.name, "Project");
  const [loadError, setLoadError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // KanbanBoard triggers this same reload after every task/column change
  // (drag, add, rename, delete...). Those can fire in quick succession —
  // a slow response to an earlier reload should never overwrite state from
  // a faster, more recent one, so each call is tagged and only the latest
  // is allowed to apply its result.
  async function load() {
    const isCurrent = nextRequest();
    try {
      const data = await apiFetch(`/api/projects/${id}`);
      if (!isMounted() || !isCurrent()) return;
      setProject(data);
      setLoadError("");
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      if (err.status === 401) {
        router.push("/login");
        return;
      }
      setLoadError(errorMessage(err, "Couldn't load this project. Please try again."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function confirmDeleteProject() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      router.push("/dashboard/projects");
    } catch (err) {
      // Stay open with the reason visible, same pattern used for every
      // other destructive action in the app (task/column/member delete) —
      // closing here would surface the error on the page underneath,
      // which the dialog had been covering.
      if (!isMounted()) return;
      setDeleteError(errorMessage(err, "Couldn't delete this project. Please try again."));
      setDeleting(false);
    }
  }

  async function handleRenameProject(newName) {
    if (renaming) return;
    setRenaming(true);
    setRenameError("");
    try {
      const data = await apiFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!isMounted()) return;
      // The route returns the full project DTO, so the new name (and
      // everything else) shows up immediately without a separate reload.
      setProject(data);
      setRenameOpen(false);
    } catch (err) {
      if (!isMounted()) return;
      setRenameError(errorMessage(err, "Couldn't rename the project. Please try again."));
    } finally {
      if (isMounted()) setRenaming(false);
    }
  }

  if (loadError && !project) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
        {loadError}
      </Alert>
    );
  }

  if (!project) {
    return (
      <Box aria-busy="true" aria-label="Loading project">
        <Skeleton variant="text" width={64} height={20} />
        <Skeleton variant="text" width="40%" height={44} />
        <Skeleton variant="text" width="60%" height={22} sx={{ mb: 3 }} />
        <Box sx={{ display: "flex", gap: 2, overflow: "hidden" }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={280} sx={{ flex: "0 0 288px", borderRadius: 2 }} />
          ))}
        </Box>
      </Box>
    );
  }

  const { total, done, pct } = projectProgress(project.tasks);
  const isManager = session?.user?.id === project.manager.id;
  // `project.members` is `null` for a project that predates per-project
  // access (every team member currently has access to it) and an array
  // otherwise (only the manager and whoever's listed) — see
  // lib/serialize.js. Assignable people always match who can actually see
  // the project, so a task is never handed to someone who can't open it.
  const projectRoster = project.members ?? project.team.members;
  const assignableUsers = [
    project.manager,
    ...projectRoster.filter((m) => m.id !== project.manager.id),
  ];
  // Whether the current user can directly edit tasks/columns here, as
  // opposed to only being able to view them — mirrors
  // lib/authz.js's canEditProject exactly, using the same DTO fields.
  const canEdit =
    isManager ||
    project.editingMode !== "manager_approval" ||
    project.editors.some((e) => e.id === session?.user?.id);

  return (
    <Box>
      <PageHeader
        back={{ href: "/dashboard/projects", label: "Projects" }}
        accent={projectColorForId(project.id, mode).strong}
        title={project.name}
        description={project.description}
        sx={{ mb: 3 }}
        actions={
          <>
            {isManager && (
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
            )}
            <Button component={Link} href={`/dashboard/teams/${project.team.id}`} variant="outlined" color="inherit">
              Team: {project.team.name}
            </Button>
            {isManager && (
              <Button
                color="inherit"
                startIcon={<GroupOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => setMembersOpen(true)}
              >
                Manage access
              </Button>
            )}
            {isManager && (
              <Button
                color="inherit"
                startIcon={<ShareOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => setShareOpen(true)}
              >
                Share
              </Button>
            )}
            {isManager && (
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                Delete project
              </Button>
            )}
          </>
        }
      />

      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 1.5, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <GradientProgress value={pct} done={pct === 100} label="Project progress" width={140} />
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {done} of {total} tasks done
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <AvatarGroup max={6} sx={{ "& .MuiAvatar-root": { width: 24, height: 24, fontSize: 11, borderColor: "background.default" } }}>
            {assignableUsers.map((m) => (
              <Tooltip key={m.id} title={m.id === project.manager.id ? `${m.name} (manager)` : m.name}>
                <Avatar aria-label={m.name} sx={{ bgcolor: pastelForString(m.id, mode) }}>
                  {avatarInitial(m.name)}
                </Avatar>
              </Tooltip>
            ))}
          </AvatarGroup>
          <Typography variant="body2" color="text.secondary">
            Managed by {project.manager.name}
          </Typography>
        </Box>
      </Box>

      {!canEdit && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You can view this project but not edit it. {project.manager.name} controls who can edit.
        </Typography>
      )}

      <KanbanBoard
        projectId={project.id}
        columns={project.columns}
        tasks={project.tasks}
        onChanged={load}
        assignableUsers={assignableUsers}
        canEdit={canEdit}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project"
        message={`“${project.name}” and all of its tasks will be permanently deleted — this can't be undone. Are you sure?`}
        onConfirm={confirmDeleteProject}
        onClose={() => {
          setConfirmDelete(false);
          setDeleteError("");
        }}
        loading={deleting}
        error={deleteError}
      />

      <RenameDialog
        open={renameOpen}
        title="Rename project"
        label="Project name"
        value={project.name}
        onSave={handleRenameProject}
        onClose={() => {
          setRenameOpen(false);
          setRenameError("");
        }}
        loading={renaming}
        error={renameError}
      />

      {isManager && (
        <ProjectMembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          projectId={project.id}
          manager={project.manager}
          teamMembers={project.team.members}
          projectMembers={project.members}
          editingMode={project.editingMode}
          editors={project.editors}
          onChanged={setProject}
        />
      )}

      {isManager && (
        <ShareProjectDialog open={shareOpen} onClose={() => setShareOpen(false)} projectId={project.id} />
      )}

    </Box>
  );
}
