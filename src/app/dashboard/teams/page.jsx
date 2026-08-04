"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Box, Typography, Button, Grid, Card, CardActionArea, CardContent, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, AvatarGroup, Avatar,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
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

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSubmitting(false);
    setShowForm(false);
    setName("");
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

      <Dialog open={showForm} onClose={() => setShowForm(false)} fullWidth maxWidth="xs">
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
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setShowForm(false)} color="inherit">
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? "Creating..." : "Create team"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : teams.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "grey.300", borderRadius: 2, py: 6, textAlign: "center" }}>
          <Typography color="text.secondary">You're not a member of any team yet.</Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {teams.map((t) => (
            <Grid item xs={12} md={6} lg={4} key={t.id}>
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
                        <Avatar key={m.id} sx={{ width: 28, height: 28, fontSize: 12 }}>
                          {m.name.slice(0, 1)}
                        </Avatar>
                      ))}
                    </AvatarGroup>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
