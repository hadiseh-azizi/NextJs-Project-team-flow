"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box, Typography, Button, Grid, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, CircularProgress, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ProjectCard from "@/components/ProjectCard";

function ProjectsPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [projectsRes, teamsRes] = await Promise.all([fetch("/api/projects"), fetch("/api/teams")]);
    setProjects(await projectsRes.json());
    setMyTeams(await teamsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Coming from a link like /dashboard/projects?new=1 (e.g. the "Create
  // your first project" button on the dashboard) opens the dialog right
  // away instead of just landing on an empty list.
  useEffect(() => {
    if (searchParams.get("new")) {
      setShowForm(true);
      router.replace("/dashboard/projects");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Only teams the current user manages can receive new projects — the
  // server enforces this too, this is just for a cleaner picker.
  const teamsIManage = myTeams.filter((t) => t.manager?.id === session?.user?.id);

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, teamId }),
    });
    setSubmitting(false);
    setShowForm(false);
    setName("");
    setDescription("");
    setTeamId("");
    load();
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 4, flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="overline" color="primary" fontWeight={700}>
            Projects
          </Typography>
          <Typography variant="h4" fontWeight={700}>
            All my projects
          </Typography>
        </Box>
        {teamsIManage.length > 0 && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowForm(true)}>
            New project
          </Button>
        )}
      </Box>

      <Dialog open={showForm} onClose={() => setShowForm(false)} fullWidth maxWidth="sm">
        <form onSubmit={handleCreate}>
          <DialogTitle sx={{ fontWeight: 700 }}>New project</DialogTitle>
          <DialogContent>
            {teamsIManage.length === 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                To create a project, you need to manage a team. Head over to the{" "}
                <Link href="/dashboard/teams" style={{ color: "inherit", fontWeight: 700 }}>
                  Teams
                </Link>{" "}
                page and create one.
              </Alert>
            ) : (
              <>
                <TextField
                  autoFocus
                  label="Project name"
                  fullWidth
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={{ mb: 2, mt: 1 }}
                />
                <TextField
                  label="Description (optional)"
                  fullWidth
                  multiline
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  sx={{ mb: 2 }}
                />
                <TextField
                  select
                  label="Team"
                  fullWidth
                  required
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  helperText="The project will belong to this team — only its members will have access"
                >
                  {teamsIManage.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setShowForm(false)} color="inherit">
              Cancel
            </Button>
            {teamsIManage.length > 0 && (
              <Button type="submit" variant="contained" disabled={submitting || !teamId}>
                {submitting ? "Creating..." : "Create project"}
              </Button>
            )}
          </DialogActions>
        </form>
      </Dialog>

      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : projects.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "grey.300", borderRadius: 2, py: 6, textAlign: "center" }}>
          <Typography color="text.secondary">You haven't created any projects yet.</Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {projects.map((p) => (
            <Grid item xs={12} md={6} lg={4} key={p.id}>
              <ProjectCard project={p} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      }
    >
      <ProjectsPageInner />
    </Suspense>
  );
}
