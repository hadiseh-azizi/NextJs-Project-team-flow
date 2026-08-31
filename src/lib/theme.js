import { createTheme, responsiveFontSizes } from "@mui/material/styles";

// Design direction: pastel and genuinely colorful rather than a single
// muted accent — a soft violet-to-rose gradient carries the primary
// actions, pastel hues show up throughout (avatars, team badges, task
// labels), and a serif display face keeps headings feeling considered.
// Light mode stays airy and pastel; dark mode reuses the same hues
// shifted deep and muted instead of glowing.

export const INK_TOKENS = {
  light: "#221F2E",
  dark: "#F1EEFB",
};

const LIGHT = {
  ink: "#221F2E",
  subtle: "#786F94",
  border: "#E4DEF5",
  canvas: "#F9F7FE",
  paper: "#FFFFFF",
  accentTint: "rgba(139,127,217,0.08)",
  accentBorderLight: "#C9BFF0",
  progressTrack: "#EDE8FA",
  gradient: "linear-gradient(135deg, #8B7FD9 0%, #E29FC4 100%)",
  grey: { 50: "#F5F2FC", 100: "#EFEAF9", 200: "#E4DEF5", 300: "#D3C9EC", 400: "#A79BC9", 500: "#786F94" },
};

const DARK = {
  ink: "#F1EEFB",
  subtle: "#B3A8D9",
  border: "#3A3450",
  canvas: "#1B1830",
  paper: "#24203D",
  accentTint: "rgba(179,164,240,0.14)",
  accentBorderLight: "#6C5FA8",
  progressTrack: "#332C55",
  gradient: "linear-gradient(135deg, #7C6BD1 0%, #C77FAE 100%)",
  grey: { 50: "#241F3D", 100: "#2B254A", 200: "#3A3450", 300: "#4A4266", 400: "#7C71A8", 500: "#B3A8D9" },
};

export function buildTheme(mode) {
  const t = mode === "dark" ? DARK : LIGHT;
  const accentMain = mode === "dark" ? "#B3A4F0" : "#8B7FD9";
  const secondaryMain = mode === "dark" ? "#E8A8CC" : "#D9679F";

  const theme = createTheme({
    direction: "ltr",
    palette: {
      mode,
      primary: { main: accentMain, dark: mode === "dark" ? "#8F7FD1" : "#6A5CB8", light: mode === "dark" ? "#CFC3F5" : "#B0A5E8" },
      secondary: { main: secondaryMain },
      success: { main: mode === "dark" ? "#8FE0AE" : "#4FAF77" },
      warning: { main: mode === "dark" ? "#F0D28C" : "#C98A1F" },
      error: { main: mode === "dark" ? "#F0A199" : "#D1594B" },
      text: { primary: t.ink, secondary: t.subtle },
      divider: t.border,
      background: { default: t.canvas, paper: t.paper },
      grey: t.grey,
    },
    typography: {
      fontFamily: "'Plus Jakarta Sans', Roboto, Arial, sans-serif",
      h3: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      h4: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      h5: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      h6: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      subtitle2: { fontWeight: 700 },
      overline: { letterSpacing: "0.06em", fontWeight: 700 },
      button: { fontWeight: 600, textTransform: "none" },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { fontWeight: 600, paddingInline: 18, borderRadius: 8 },
          outlined: { borderColor: t.border, "&:hover": { borderColor: accentMain, backgroundColor: t.accentTint } },
          containedPrimary: {
            backgroundImage: t.gradient,
            color: "#FFFFFF",
            boxShadow: mode === "dark" ? "0 4px 16px rgba(124,107,209,0.35)" : "0 4px 14px rgba(139,127,217,0.3)",
            "&:hover": {
              backgroundImage: t.gradient,
              filter: "brightness(1.06)",
              boxShadow: mode === "dark" ? "0 6px 20px rgba(124,107,209,0.45)" : "0 6px 20px rgba(139,127,217,0.4)",
            },
            "&.Mui-disabled": { backgroundImage: "none" },
          },
        },
      },
      MuiFab: {
        styleOverrides: {
          primary: { backgroundImage: t.gradient, "&:hover": { backgroundImage: t.gradient, filter: "brightness(1.06)" } },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: "none",
            borderBottom: `1px solid ${t.border}`,
            backgroundColor: mode === "dark" ? "rgba(27,24,48,0.9)" : "rgba(249,247,254,0.9)",
            backdropFilter: "blur(8px)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
          outlined: { borderColor: t.border },
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: {
            borderColor: t.border,
            transition: "border-color .15s ease, box-shadow .15s ease, background-color .15s ease",
          },
        },
      },
      MuiCardActionArea: {
        styleOverrides: {
          root: {
            "&:hover": { backgroundColor: "transparent" },
            "&:hover .MuiCard-root": { borderColor: t.accentBorderLight, boxShadow: mode === "dark" ? "0 4px 14px rgba(0,0,0,0.35)" : "0 4px 14px rgba(139,127,217,0.15)" },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 6 },
          outlined: { borderColor: t.border },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 14, boxShadow: mode === "dark" ? "0 20px 60px rgba(0,0,0,0.5)" : "0 20px 60px rgba(139,127,217,0.22)" },
        },
      },
      MuiDialogTitle: {
        styleOverrides: { root: { fontFamily: "'Fraunces', serif", fontSize: "1.2rem", fontWeight: 600, paddingBottom: 4 } },
      },
      MuiTextField: {
        defaultProps: { size: "small" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            "& fieldset": { borderColor: t.border },
            "&:hover fieldset": { borderColor: t.accentBorderLight },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { backgroundColor: t.progressTrack },
        },
      },
      MuiListItem: {
        styleOverrides: { root: { borderColor: t.border } },
      },
    },
  });

  return responsiveFontSizes(theme);
}
