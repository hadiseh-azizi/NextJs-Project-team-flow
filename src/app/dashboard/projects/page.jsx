"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  MenuItem, Alert, Link as MuiLink,
} from "@mui/material";
import ProjectCard from "@/components/ProjectCard";
import ProjectCardSkeleton from "@/components/ProjectCardSkeleton";
import TeamFlowLoader from "@/components/TeamFlowLoader";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";
import { PROJECT_GRID_SX } from "@/lib/projectGrid";
import { readRememberedProjectCount, readStoredProjectCount, rememberProjectCount } from "@/lib/projectCountCache";

// The branded loader only appears if loading is still going after this
// long, so a fast response does not flash a spinner for a few frames.
const LOADER_DELAY_MS = 200;

// Dialog that fits a phone: 16px from each edge instead of MUI's 32px, the
// form inside is the flex column the paper scrolls (title and actions stay
// put, the fields scroll), and long text wraps instead of widening it.
const DIALOG_SX = {
  "& .MuiDialog-paper": {
    m: { xs: 2, sm: 4 },
    width: { xs: "calc(100% - 32px)", sm: "100%" },
    maxHeight: { xs: "calc(100% - 32px)", sm: "calc(100% - 64px)" },
    overflowWrap: "anywhere",
  },
  "& .MuiDialogTitle-root": { px: { xs: 2, sm: 3 } },
  "& .MuiDialogContent-root": { px: { xs: 2, sm: 3 } },
  "& .MuiDialogActions-root": { px: { xs: 2, sm: 3 }, flexWrap: "wrap" },
};
const DIALOG_FORM_SX = { display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" };

function ProjectsPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [projects, setProjects] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  // True once a load has succeeded in this visit. After that, a reload
  // (a project was just created) keeps the cards on screen instead of
  // swapping them for placeholders.
  const [hasLoaded, setHasLoaded] = useState(false);
  const userId = session?.user?.id;
  // How many projects the last load returned (this tab, this account), or
  // null if there is none to go on. Only ever a count we actually saw.
  const [rememberedCount, setRememberedCount] = useState(() => readRememberedProjectCount(userId));
  const [showLoader, setShowLoader] = useState(false);
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
      setHasLoaded(true);
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

  // After a full page reload the in-memory count is gone but the tab's
  // sessionStorage copy is not. Read it once the session (and so the user
  // id) is known — never during render, which would not match the server.
  useEffect(() => {
    if (rememberedCount === null && userId) setRememberedCount(readStoredProjectCount(userId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Remember the count after every successful load. This is an effect (not
  // part of load()) because on a full reload the user id can arrive after
  // the first response does.
  useEffect(() => {
    if (hasLoaded && userId) rememberProjectCount(userId, projects.length);
  }, [hasLoaded, userId, projects.length]);

  // Delay the branded loader slightly (see LOADER_DELAY_MS).
  const waitingWithoutCount = loading && !hasLoaded && !(rememberedCount > 0);
  useEffect(() => {
    if (!waitingWithoutCount) {
      setShowLoader(false);
      return undefined;
    }
    const t = setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => clearTimeout(t);
  }, [waitingWithoutCount]);

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

      <Dialog open={showForm} onClose={() => setShowForm(false)} fullWidth maxWidth="xs" sx={DIALOG_SX}>
        <Box component="form" onSubmit={handleCreate} sx={DIALOG_FORM_SX}>
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
        </Box>
      </Dialog>

      {loading && !hasLoaded ? (
        // Count remembered from the last load -> exactly that many
        // placeholders, in the real grid. Not known -> the Team Flow loader
        // (after a short delay) and no placeholders: we do not guess.
        rememberedCount > 0 ? (
          <Box role="status" aria-busy="true" aria-label="Loading projects" className="tf-fade-in" sx={PROJECT_GRID_SX}>
            {Array.from({ length: rememberedCount }, (_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </Box>
        ) : showLoader ? (
          <TeamFlowLoader label="Loading projects" />
        ) : (
          <Box aria-busy="true" sx={{ minHeight: 240 }} />
        )
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
        <Box sx={PROJECT_GRID_SX}>
          {projects.map((p, i) => (
            <ProjectCard key={p.id} project={p} index={i} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<TeamFlowLoader label="Loading projects" />}>
      <ProjectsPageInner />
    </Suspense>
  );
}
