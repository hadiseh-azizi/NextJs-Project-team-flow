"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box, Typography, Button, Grid, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, CircularProgress, Alert, Skeleton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ProjectCard from "@/components/ProjectCard";
import FadeInStagger from "@/components/FadeInStagger";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";

function ProjectsPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [projects, setProjects] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    const isCurrent = nextRequest();
    setLoading(true);
    setLoadError("");
    try {
      const [projectsData, teamsData] = await Promise.all([apiFetch("/api/projects"), apiFetch("/api/teams")]);
      if (!isMounted() || !isCurrent()) return;
      setProjects(projectsData);
      setMyTeams(teamsData);
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      if (err.status === 401) {
        router.push("/login");
        return;
      }
      setLoadError(errorMessage(err, "Couldn't load your projects. Please try again."));
    } finally {
      if (isMounted() && isCurrent()) setLoading(false);
    }
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
    if (submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, teamId }),
      });
      if (!isMounted()) return;
      setShowForm(false);
      setName("");
      setDescription("");
      setTeamId("");
      load();
    } catch (err) {
      if (isMounted()) setFormError(errorMessage(err, "Couldn't create the project. Please try again."));
    } finally {
      if (isMounted()) setSubmitting(false);
    }
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
                {formError && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {formError}
                  </Alert>
                )}
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
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => (
            <Grid item xs={12} md={6} lg={4} key={i}>
              <Skeleton variant="rounded" height={148} sx={{ borderRadius: 3 }} />
            </Grid>
          ))}
        </Grid>
      ) : loadError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
          {loadError}
        </Alert>
      ) : projects.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "grey.300", borderRadius: 2, py: 6, textAlign: "center" }}>
          <Typography color="text.secondary">You haven't created any projects yet.</Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {projects.map((p, i) => (
            <Grid item xs={12} md={6} lg={4} key={p.id}>
              <FadeInStagger index={i}>
                <ProjectCard project={p} />
              </FadeInStagger>
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
