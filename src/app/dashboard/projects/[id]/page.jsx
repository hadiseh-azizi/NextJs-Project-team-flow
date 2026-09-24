"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Box, Typography, Button, Skeleton, Alert, LinearProgress, Avatar, AvatarGroup, Tooltip,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";
import KanbanBoard from "@/components/KanbanBoard";
import ConfirmDialog from "@/components/ConfirmDialog";
import RenameDialog from "@/components/RenameDialog";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { mode } = useThemeMode();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [project, setProject] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

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

  const total = project.tasks.length;
  const doneColumnIds = new Set(project.columns.filter((c) => c.isDoneColumn).map((c) => c.id));
  const done = project.tasks.filter((t) => doneColumnIds.has(t.columnId)).length;
  const isManager = session?.user?.id === project.manager.id;
  // Anyone who can see this project can be assigned tasks: the team's
  // members plus the project's manager.
  const assignableUsers = [
    project.manager,
    ...project.team.members.filter((m) => m.id !== project.manager.id),
  ];

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Box>
      <PageHeader
        back={{ href: "/dashboard/projects", label: "Projects" }}
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
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                Delete project
              </Button>
            )}
          </>
        }
      />

      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 1.5, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={pct === 100 ? "success" : "primary"}
            aria-label="Project progress"
            sx={{ width: 140 }}
          />
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

      <KanbanBoard
        projectId={project.id}
        columns={project.columns}
        tasks={project.tasks}
        onChanged={load}
        assignableUsers={assignableUsers}
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
    </Box>
  );
}
