import Link from "next/link";
import { Box, Container, Typography, Button, Grid, Avatar } from "@mui/material";
import TeamFlowBrand from "@/components/TeamFlowBrand";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import { BRAND } from "@/lib/brand";
import { pastelForString } from "@/lib/pastelColor";

const FEATURES = [
  {
    title: "Kanban boards",
    desc: "Organize work into columns you name yourself, and move tasks between them.",
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
      cards: [{ title: "Simulate in MATLAB", who: "M" }],
    },
    {
      label: "Review",
      hideOnPhone: true,
      cards: [{ title: "Mathematical modeling" }, { title: "Controller design", who: "A" }],
    },
  ];
  return (
    <Box aria-hidden sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
      {cols.map((c) => (
        <Box
          key={c.label}
          // The third column is dropped on phones: three would be ~90px wide each.
          sx={{ flex: 1, minWidth: 0, bgcolor: "var(--brand-surface-tint)", borderRadius: 1, p: 1, display: c.hideOnPhone ? { xs: "none", sm: "block" } : "block" }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 0.5, pb: 1, minHeight: 24 }}>
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
                sx={{
                  position: "relative",
                  bgcolor: "background.paper",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 1,
                  pl: 1.5,
                  boxShadow: "var(--brand-shadow-card)",
                  overflow: "hidden",
                  // A 3px brand-gradient edge on the left of each card.
                  "&::before": { content: '""', position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--brand-gradient-strong)", opacity: 0.9 },
                }}
              >
                <Typography sx={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.35 }}>{card.title}</Typography>
                {(card.due || card.who) && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 0.75 }}>
                    <Typography sx={{ fontSize: 11.5 }} color="text.secondary">
                      {card.due || ""}
                    </Typography>
                    {card.who && (
                      <Avatar sx={{ width: 18, height: 18, fontSize: 10, bgcolor: pastelForString(card.who, "light"), color: BRAND.light.text }}>{card.who}</Avatar>
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
    <Box sx={{ overflowX: "clip" }}>
      <Container maxWidth="lg" component="header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 2.5, gap: 1 }}>
        <TeamFlowBrand size="lg" collapseOnNarrow />
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
            {/* The preview sits on a framed panel; two soft color fields
                behind it (see .tf-hero-glow) are the only decoration. */}
            <Box sx={{ position: "relative", isolation: "isolate" }}>
              <Box aria-hidden className="tf-hero-glow" sx={{ inset: { xs: "-6% 0", md: "-14% -8%" } }} />
              <Box
                className="tf-ring"
                sx={{
                  position: "relative",
                  zIndex: 1,
                  bgcolor: "background.paper",
                  borderRadius: 1.5,
                  p: { xs: 1.25, sm: 2 },
                  boxShadow: "var(--brand-shadow-raised), var(--brand-glow)",
                }}
              >
                <BoardPreview />
              </Box>
            </Box>
          </Grid>
        </Grid>

        <Grid container spacing={{ xs: 2.5, md: 3 }} sx={{ mt: { xs: 8, md: 12 } }} component="section" aria-label="Features">
          {FEATURES.map((f) => (
            <Grid item xs={12} md={4} key={f.title}>
              <Box
                className="tf-topline"
                sx={{
                  height: "100%",
                  bgcolor: "background.paper",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 2.5,
                  pt: 3,
                  transition: "border-color .15s ease",
                  "&:hover": { borderColor: "var(--brand-border-hover)" },
                }}
              >
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

      <Container maxWidth="lg" component="footer" sx={{ py: 3, borderTop: "1px solid", borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">
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
