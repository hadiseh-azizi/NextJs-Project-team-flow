"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box, Typography, Button, Grid, Card, CardActionArea, CardContent, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, AvatarGroup, Avatar,
  Checkbox, FormControlLabel, Collapse, Divider, Skeleton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import FadeInStagger from "@/components/FadeInStagger";

export default function TeamsPage() {
  const router = useRouter();
  const { mode } = useThemeMode();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [addProject, setAddProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/teams");
    setTeams(await res.json());
    setLoading(false);
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
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);

    const teamRes = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const team = await teamRes.json();

    // Creating the team's first project right here saves a trip to the
    // Projects page and back — most people creating a team are about to
    // start a project for it anyway.
    if (addProject && projectName.trim()) {
      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, description: projectDescription, teamId: team.id }),
      });
      const project = await projectRes.json();
      setSubmitting(false);
      resetForm();
      router.push(`/dashboard/projects/${project.id}`);
      return;
    }

    setSubmitting(false);
    resetForm();
    load();
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 4, flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="overline" color="primary" fontWeight={700}>
            Teams
          </Typography>
          <Typography variant="h4" fontWeight={700}>
            My teams
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowForm(true)}>
          New team
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Every project belongs to a team. To create a new project, you'll first need to manage a team.
      </Typography>

      <Dialog open={showForm} onClose={resetForm} fullWidth maxWidth="xs">
        <form onSubmit={handleCreate}>
          <DialogTitle sx={{ fontWeight: 700 }}>New team</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Team name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ mt: 1, mb: 1 }}
            />

            <FormControlLabel
              control={<Checkbox checked={addProject} onChange={(e) => setAddProject(e.target.checked)} />}
              label="Also create a project for this team"
              sx={{ mt: 0.5 }}
            />

            <Collapse in={addProject}>
              <Divider sx={{ my: 1.5 }} />
              <TextField
                label="Project name"
                fullWidth
                required={addProject}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                sx={{ mb: 2 }}
              />
              <TextField
                label="Description (optional)"
                fullWidth
                multiline
                rows={2}
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
              />
            </Collapse>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
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
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => (
            <Grid item xs={12} md={6} lg={4} key={i}>
              <Skeleton variant="rounded" height={128} sx={{ borderRadius: 3 }} />
            </Grid>
          ))}
        </Grid>
      ) : teams.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "grey.300", borderRadius: 2, py: 6, textAlign: "center" }}>
          <Typography color="text.secondary">You're not a member of any team yet.</Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {teams.map((t, i) => (
            <Grid item xs={12} md={6} lg={4} key={t.id}>
              <FadeInStagger index={i}>
                <Card variant="outlined">
                  <CardActionArea component={Link} href={`/dashboard/teams/${t.id}`}>
                    <CardContent>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                        <Typography variant="h6" fontWeight={700}>
                          {t.name}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        Manager: {t.manager?.name}
                      </Typography>
                      <AvatarGroup max={5} sx={{ justifyContent: "flex-end" }}>
                        {t.members.map((m) => (
                          <Avatar key={m.id} sx={{ width: 28, height: 28, fontSize: 12, bgcolor: pastelForString(m.id, mode), color: mode === "dark" ? "#F1EEFB" : "#221F2E" }}>
                            {m.name.slice(0, 1)}
                          </Avatar>
                        ))}
                      </AvatarGroup>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </FadeInStagger>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
