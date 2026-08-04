"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Box, Typography, Button, Stack, Chip, CircularProgress,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KanbanBoard from "@/components/KanbanBoard";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [project, setProject] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) setProject(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function confirmDeleteProject() {
    setDeleting(true);
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setDeleting(false);
    router.push("/dashboard/projects");
  }

  if (!project) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
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
        <Chip label={`Project manager: ${project.manager.name}`} size="small" color="primary" variant="outlined" />
        {project.team.members.map((m) => (
          <Chip key={m.id} label={m.name} size="small" variant="outlined" />
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
        onClose={() => setConfirmDelete(false)}
        loading={deleting}
      />
    </Box>
  );
}
