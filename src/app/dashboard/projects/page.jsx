"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  MenuItem, CircularProgress, Alert, Skeleton, Link as MuiLink,
} from "@mui/material";
import ProjectCard from "@/components/ProjectCard";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import Field from "@/components/FormField";
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
      <PageHeader
        title="Projects"
        description="Each project is a board that belongs to one team."
        actions={
          teamsIManage.length > 0 && (
            <Button variant="contained" onClick={() => setShowForm(true)}>
              New project
            </Button>
          )
        }
      />

      <Dialog open={showForm} onClose={() => setShowForm(false)} fullWidth maxWidth="xs">
        <form onSubmit={handleCreate}>
          <DialogTitle>New project</DialogTitle>
          <DialogContent>
            {teamsIManage.length === 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                To create a project, you need to manage a team. Head over to the{" "}
                <MuiLink component={Link} href="/dashboard/teams" color="inherit" sx={{ fontWeight: 600 }}>
                  Teams
                </MuiLink>{" "}
                page and create one.
              </Alert>
            ) : (
              <>
                <Field
                  autoFocus
                  label="Project name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={{ mb: 2.5, mt: 1 }}
                />
                <Field
                  label="Description"
                  optional
                  multiline
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  sx={{ mb: 2.5 }}
                />
                <Field
                  select
                  label="Team"
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
                </Field>
                {formError && (
                  <Alert severity="error" sx={{ mt: 2.5 }}>
                    {formError}
                  </Alert>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
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
        <Box aria-busy="true" aria-label="Loading projects">
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider", display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 200px" }, columnGap: 6, rowGap: 1.5 }}>
              <Box>
                <Skeleton variant="text" width="40%" height={24} />
                <Skeleton variant="text" width="22%" height={18} />
              </Box>
              <Box>
                <Skeleton variant="rounded" height={4} sx={{ mt: 1 }} />
                <Skeleton variant="text" width="45%" height={18} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : loadError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
          {loadError}
        </Alert>
      ) : projects.length === 0 ? (
        teamsIManage.length > 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create a project to give your team a board to work from."
            action={
              <Button variant="contained" onClick={() => setShowForm(true)}>
                New project
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No projects yet"
            description="Projects belong to teams. Create a team first, then add a project to it."
            action={
              <Button component={Link} href="/dashboard/teams" variant="contained">
                Go to teams
              </Button>
            }
          />
        )
      ) : (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, borderTop: "1px solid", borderColor: "divider" }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress size={28} aria-label="Loading" />
        </Box>
      }
    >
      <ProjectsPageInner />
    </Suspense>
  );
}
