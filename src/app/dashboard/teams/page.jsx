"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box, Button, Dialog, DialogTitle,
  DialogContent, DialogActions,
  Checkbox, FormControlLabel, Collapse, Divider, Skeleton, Alert,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import Field from "@/components/FormField";
import TeamCard from "@/components/TeamCard";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";

// Circles keep their own size (each card caps at 272px and centers in its
// cell), so the grid only decides how many fit per row: two across on a
// phone, then as many as the width allows. Row gap is larger than column
// gap because circles leave more empty space above and below than beside.
const TEAM_GRID_SX = {
  display: "grid",
  columnGap: { xs: 2, sm: 3 },
  rowGap: { xs: 3, sm: 4 },
  gridTemplateColumns: { xs: "repeat(auto-fill, minmax(148px, 1fr))", sm: "repeat(auto-fill, minmax(216px, 1fr))" },
};

export default function TeamsPage() {
  const router = useRouter();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [addProject, setAddProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const isCurrent = nextRequest();
    setLoading(true);
    setLoadError("");
    try {
      const data = await apiFetch("/api/teams");
      if (!isMounted() || !isCurrent()) return;
      setTeams(data);
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      if (err.status === 401) {
        router.push("/login");
        return;
      }
      setLoadError(errorMessage(err, "Couldn't load your teams. Please try again."));
    } finally {
      if (isMounted() && isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setShowForm(false);
    setName("");
    setAddProject(false);
    setProjectName("");
    setProjectDescription("");
    setFormError("");
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError("");

    let team;
    try {
      team = await apiFetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch (err) {
      if (isMounted()) setFormError(errorMessage(err, "Couldn't create the team. Please try again."));
      if (isMounted()) setSubmitting(false);
      return;
    }

    // The team now exists even if what follows fails — resetForm()/load()
    // run regardless below so a retry can't submit this same team again,
    // and any project failure is reported separately (as a notice, since
    // the dialog is already gone) instead of being mislabeled as the team
    // creation failing.
    if (addProject && projectName.trim()) {
      try {
        const project = await apiFetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: projectName, description: projectDescription, teamId: team.id }),
        });
        if (!isMounted()) return;
        resetForm();
        router.push(`/dashboard/projects/${project.id}`);
        return;
      } catch (err) {
        if (!isMounted()) return;
        resetForm();
        setNotice(
          `"${team.name}" was created, but the project couldn't be created: ${errorMessage(err, "please try again from the Projects page.")}`
        );
        load();
        setSubmitting(false);
        return;
      }
    }

    if (!isMounted()) return;
    resetForm();
    load();
    setSubmitting(false);
  }

  return (
    <Box>
      <PageHeader
        title="Teams"
        description="Every project belongs to a team. To create a project, you'll first need to manage a team."
        actions={
          <Button variant="contained" onClick={() => setShowForm(true)}>
            New team
          </Button>
        }
      />

      {notice && (
        <Alert severity="warning" sx={{ mb: 3 }} onClose={() => setNotice("")}>
          {notice}
        </Alert>
      )}

      <Dialog open={showForm} onClose={resetForm} fullWidth maxWidth="xs">
        <form onSubmit={handleCreate}>
          <DialogTitle>New team</DialogTitle>
          <DialogContent>
            <Field
              autoFocus
              label="Team name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ mt: 1 }}
            />

            <FormControlLabel
              control={<Checkbox size="small" checked={addProject} onChange={(e) => setAddProject(e.target.checked)} />}
              label="Also create a project for this team"
              sx={{ mt: 1.5, ml: -0.75 }}
            />

            <Collapse in={addProject}>
              <Divider sx={{ my: 1.5 }} />
              <Field
                label="Project name"
                required={addProject}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                sx={{ mb: 2.5 }}
              />
              <Field
                label="Description"
                optional
                multiline
                rows={3}
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
              />
            </Collapse>
            {formError && (
              <Alert severity="error" sx={{ mt: 2.5 }}>
                {formError}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={resetForm} color="inherit">
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? "Creating..." : addProject ? "Create team & project" : "Create team"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {loading ? (
        <Box aria-busy="true" aria-label="Loading teams" sx={TEAM_GRID_SX}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ width: "100%", maxWidth: 272, justifySelf: "center" }}>
              <Skeleton variant="circular" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
            </Box>
          ))}
        </Box>
      ) : loadError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
          {loadError}
        </Alert>
      ) : teams.length === 0 ? (
        <EmptyState
          title="No teams yet"
          description="Create a team to invite people and start adding projects."
          action={
            <Button variant="contained" onClick={() => setShowForm(true)}>
              New team
            </Button>
          }
        />
      ) : (
        <Box sx={TEAM_GRID_SX}>
          {teams.map((t, i) => (
            <TeamCard key={t.id} team={t} index={i} />
          ))}
        </Box>
      )}
    </Box>
  );
}
