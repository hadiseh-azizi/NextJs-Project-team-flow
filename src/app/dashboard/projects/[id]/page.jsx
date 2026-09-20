"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Box, Typography, Button, Stack, Chip, Skeleton, Grid, Alert,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KanbanBoard from "@/components/KanbanBoard";
import ConfirmDialog from "@/components/ConfirmDialog";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [project, setProject] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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

  if (loadError && !project) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
        {loadError}
      </Alert>
    );
  }

  if (!project) {
    return (
      <Box>
        <Skeleton variant="text" width={80} height={20} />
        <Skeleton variant="text" width="45%" height={48} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="65%" height={24} sx={{ mb: 3 }} />
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => (
            <Grid item xs={12} md={4} key={i}>
              <Skeleton variant="rounded" height={340} sx={{ borderRadius: 3 }} />
            </Grid>
          ))}
        </Grid>
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

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="overline" color="primary" fontWeight={700}>
            Project
          </Typography>
          <Typography variant="h4" fontWeight={700}>
            {project.name}
          </Typography>
          {project.description && (
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {project.description}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" fontFamily="monospace" sx={{ mt: 1, display: "block" }}>
            {done}/{total} tasks done — {total ? Math.round((done / total) * 100) : 0}%
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            component={Link}
            href={`/dashboard/teams/${project.team.id}`}
            variant="outlined"
            startIcon={<GroupsIcon />}
          >
            Team: {project.team.name}
          </Button>
          {isManager && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete project
            </Button>
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
        <Chip
          label={`Project manager: ${project.manager.name}`}
          size="small"
          color="primary"
          variant="outlined"
        />
        {project.team.members.map((m, i) => (
          <Chip
            key={m.id}
            label={m.name}
            size="small"
            variant="outlined"
          />
        ))}
      </Stack>

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
    </Box>
  );
}
