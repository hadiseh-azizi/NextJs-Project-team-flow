import Link from "next/link";
import { Box, Container, Typography, Button, AppBar, Toolbar, Grid, Stack, Chip } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

const FEATURES = [
  {
    title: "Kanban boards",
    desc: "Move tasks between To Do, In Progress, and Done columns.",
  },
  {
    title: "Teams & project managers",
    desc: "Every project belongs to one team — only that team's members can access it.",
  },
  {
    title: "Progress reports",
    desc: "See each project's completion percentage at a glance on the dashboard.",
  },
];

// A tiny, static illustration of the real Kanban board — shown instead of a
// generic icon grid, the way most real product landing pages preview the
// actual UI rather than describing it in the abstract.
function BoardPreview() {
  const cols = [
    { label: "To Do", color: "#9CA3AF", cards: ["Write final report", "Check sensors"] },
    { label: "In Progress", color: "#B45309", cards: ["Simulate in MATLAB"] },
    { label: "Done", color: "#15803D", cards: ["Mathematical modeling", "Controller design"] },
  ];
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 3,
        p: 2,
        bgcolor: "background.paper",
        boxShadow: "0 24px 60px -20px rgba(20,21,26,0.18)",
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, px: 0.5 }}>
        <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: "#F87171" }} />
        <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: "#FBBF24" }} />
        <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: "#34D399" }} />
      </Stack>
      <Grid container spacing={1.25}>
        {cols.map((c) => (
          <Grid item xs={12} sm={4} key={c.label}>
            <Box sx={{ bgcolor: "grey.50", borderRadius: 2, p: 1, height: "100%" }}>
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1, px: 0.5 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: c.color }} />
                <Typography variant="caption" fontWeight={700} color="text.secondary" noWrap>
                  {c.label}
                </Typography>
              </Stack>
              <Stack spacing={0.75}>
                {c.cards.map((card) => (
                  <Box
                    key={card}
                    sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 1.5, p: 0.9 }}
                  >
                    <Typography variant="caption" sx={{ fontSize: 11, lineHeight: 1.3, display: "block" }}>
                      {card}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export default function Home() {
  return (
    <Box>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ maxWidth: 1152, mx: "auto", width: "100%", py: 1, gap: { xs: 0.5, sm: 0 } }}>
          <Typography sx={{ flexGrow: 1, fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: { xs: "1rem", sm: "1.15rem" } }}>
            TeamFlow<Box component="span" sx={{ color: "primary.main" }}>.</Box>
          </Typography>
          <Button component={Link} href="/login" color="inherit" sx={{ mr: { xs: 0, sm: 1 }, px: { xs: 1, sm: 2 }, color: "text.secondary" }}>
            Sign in
          </Button>
          <Button component={Link} href="/register" variant="contained" sx={{ px: { xs: 1.5, sm: 2 } }}>
            Get started
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
        <Grid container spacing={6} alignItems="center">
          <Grid item xs={12} md={6}>
            <Chip
              label="Built for small teams"
              size="small"
              sx={{ bgcolor: "rgba(139,127,217,0.1)", color: "primary.main", mb: 2.5, fontWeight: 700 }}
            />
            <Typography
              variant="h3"
              sx={{ fontWeight: 800, letterSpacing: "-0.02em", fontSize: { xs: "2rem", md: "2.6rem" }, mb: 2.5, lineHeight: 1.25 }}
            >
              Run your projects with the precision of an engineering drawing
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 4, maxWidth: 440, fontSize: "1.05rem" }}>
              Kanban boards, isolated teams, and progress reports — all in one simple workspace.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
              <Button component={Link} href="/register" variant="contained" size="large" endIcon={<ArrowForwardIcon />}>
                Create your first project
              </Button>
              <Button component={Link} href="/login" size="large" sx={{ color: "text.secondary" }}>
                I already have an account
              </Button>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <BoardPreview />
          </Grid>
        </Grid>

        <Box sx={{ mt: { xs: 8, md: 12 } }}>
          <Grid container spacing={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
            {FEATURES.map((f, i) => (
              <Grid
                item
                xs={12}
                md={4}
                key={f.title}
                sx={{
                  p: 3.5,
                  borderTop: { xs: i > 0 ? "1px solid" : "none", md: "none" },
                  borderLeft: { md: i > 0 ? "1px solid" : "none" },
                  borderColor: "divider",
                }}
              >
                <Typography
                  sx={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "1.5rem", color: "primary.main", mb: 1.5, lineHeight: 1 }}
                >
                  {String(i + 1).padStart(2, "0")}
                </Typography>
                <Typography fontWeight={700} sx={{ mb: 0.5 }}>
                  {f.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {f.desc}
                </Typography>
              </Grid>
            ))}
          </Grid>
        </Box>
      </Container>

      <Typography variant="caption" color="text.disabled" align="center" display="block" sx={{ py: 4, borderTop: "1px solid", borderColor: "divider", mt: 4 }}>
        TeamFlow — Final year project
      </Typography>
    </Box>
  );
}
