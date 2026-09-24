import Link from "next/link";
import { Box, Container, Typography, Button, Grid, Avatar } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import Wordmark from "@/components/Wordmark";
import ThemeToggleButton from "@/components/ThemeToggleButton";

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

// A small, static picture of the real board — same columns, cards and
// colors as the app itself, so what you see here is what you get.
function BoardPreview() {
  const cols = [
    {
      label: "To Do",
      cards: [
        { title: "Write final report", due: "Due Oct 12" },
        { title: "Check sensors" },
      ],
    },
    {
      label: "In Progress",
      cards: [{ title: "Simulate in MATLAB", who: "M", whoColor: "#F8E0CA" }],
    },
    {
      label: "Done",
      done: true,
      cards: [{ title: "Mathematical modeling" }, { title: "Controller design", who: "A", whoColor: "#D6EBDB" }],
    },
  ];
  return (
    <Box aria-hidden sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
      {cols.map((c) => (
        <Box key={c.label} sx={{ flex: 1, minWidth: 0, bgcolor: "surface.sunken", borderRadius: 2, p: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 0.5, pb: 1, minHeight: 24 }}>
            {c.done && <CheckCircleIcon sx={{ fontSize: 14, color: "success.main" }} />}
            <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
              {c.label}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: "auto", pr: 0.5 }}>
              {c.cards.length}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {c.cards.map((card) => (
              <Box
                key={card.title}
                sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, boxShadow: "0 1px 2px rgba(30,27,22,0.07)" }}
              >
                <Typography sx={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.35 }}>{card.title}</Typography>
                {(card.due || card.who) && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 0.75 }}>
                    <Typography sx={{ fontSize: 11.5 }} color="text.secondary">
                      {card.due || ""}
                    </Typography>
                    {card.who && (
                      <Avatar sx={{ width: 18, height: 18, fontSize: 10, bgcolor: card.whoColor, color: "#1E1B16" }}>{card.who}</Avatar>
                    )}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default function Home() {
  return (
    <Box>
      <Container maxWidth="lg" component="header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 2.5 }}>
        <Wordmark />
        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.5, sm: 1 } }}>
          <ThemeToggleButton />
          <Button component={Link} href="/login" color="inherit" sx={{ color: "text.secondary" }}>
            Sign in
          </Button>
          <Button component={Link} href="/register" variant="outlined" color="inherit">
            Get started
          </Button>
        </Box>
      </Container>

      <Container maxWidth="lg" component="main" sx={{ pt: { xs: 5, md: 10 }, pb: { xs: 6, md: 8 } }}>
        <Grid container spacing={{ xs: 6, md: 8 }} alignItems="center">
          <Grid item xs={12} md={6}>
            <Typography variant="h3" component="h1" sx={{ fontSize: { xs: "2.125rem", md: "2.75rem" }, mb: 2.5 }}>
              Run your projects with the precision of an engineering drawing
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 4, maxWidth: 440, fontSize: "1.0625rem" }}>
              Kanban boards, isolated teams, and progress reports — all in one simple workspace.
            </Typography>
            <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1.5, alignItems: { xs: "stretch", sm: "center" } }}>
              <Button component={Link} href="/register" variant="contained" size="large">
                Create your first project
              </Button>
              <Button component={Link} href="/login" size="large" color="inherit" sx={{ color: "text.secondary" }}>
                I already have an account
              </Button>
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <BoardPreview />
          </Grid>
        </Grid>

        <Grid container spacing={{ xs: 3, md: 6 }} sx={{ mt: { xs: 8, md: 12 } }} component="section" aria-label="Features">
          {FEATURES.map((f) => (
            <Grid item xs={12} md={4} key={f.title}>
              <Box sx={{ borderTop: "1px solid", borderColor: "line.strong", pt: 2 }}>
                <Typography variant="subtitle1" component="h2" sx={{ mb: 0.5 }}>
                  {f.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {f.desc}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Container
        maxWidth="lg"
        component="footer"
        sx={{ py: 3, borderTop: "1px solid", borderColor: "divider", textAlign: "center" }}
      >
        <Typography variant="caption" color="text.secondary" component="p" sx={{ lineHeight: 1.8 }}>
          Designed by Hadiseh Azizi
          <br />
          Supervised by Dr. Ghanbarpur
          <br />
          Sistan and Baluchestan University
        </Typography>
      </Container>
    </Box>
  );
}
