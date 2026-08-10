import { createTheme, responsiveFontSizes } from "@mui/material/styles";

// Design direction: warm and editorial rather than another blue/indigo SaaS
// template — a single terracotta accent used for primary actions/signal,
// pastel color built in for task labels and per-person/per-team variety,
// and a serif face for headings. Light mode stays soft and pastel; dark
// mode reuses the same hues but shifted deep and muted instead of bright.

const ACCENT = "#B54A2C"; // terracotta — deliberately not blue/indigo/violet

const LIGHT = {
  ink: "#1C1B19",
  subtle: "#78716C",
  border: "#E7E2D9",
  canvas: "#FBF9F5",
  paper: "#FFFFFF",
  accentTint: "rgba(181,74,44,0.06)",
  accentBorderLight: "#E8B8A3",
  progressTrack: "#F1E4DD",
  grey: { 50: "#F3F0E9", 100: "#EDE9E0", 200: "#E7E2D9", 300: "#D6D0C4", 400: "#A8A29E", 500: "#78716C" },
};

const DARK = {
  ink: "#F2EFEA",
  subtle: "#A79E93",
  border: "#3A362F",
  canvas: "#1A1815",
  paper: "#242220",
  accentTint: "rgba(224,131,98,0.12)",
  accentBorderLight: "#8F4A32",
  progressTrack: "#3A2C24",
  grey: { 50: "#2A2723", 100: "#332F29", 200: "#3A362F", 300: "#4C463D", 400: "#786F63", 500: "#A79E93" },
};

export function buildTheme(mode) {
  const t = mode === "dark" ? DARK : LIGHT;
  const accentMain = mode === "dark" ? "#D97A54" : ACCENT; // lighter terracotta reads better on dark backgrounds

  const theme = createTheme({
    direction: "ltr",
    palette: {
      mode,
      primary: { main: accentMain, dark: mode === "dark" ? "#B5633F" : "#8F3B22", light: mode === "dark" ? "#E8A184" : "#C97A5C" },
      secondary: { main: mode === "dark" ? "#7FA98A" : "#4D6B4D" },
      success: { main: mode === "dark" ? "#7FA98A" : "#4D6B4D" },
      warning: { main: mode === "dark" ? "#D6A94E" : "#A16207" },
      error: { main: mode === "dark" ? "#D9776A" : "#A3402C" },
      text: { primary: t.ink, secondary: t.subtle },
      divider: t.border,
      background: { default: t.canvas, paper: t.paper },
      grey: t.grey,
    },
    typography: {
      fontFamily: "Inter, Roboto, Arial, sans-serif",
      h3: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      h4: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      h5: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      h6: { fontFamily: "'Fraunces', serif", fontWeight: 600 },
      subtitle2: { fontWeight: 700 },
      overline: { letterSpacing: "0.06em", fontWeight: 700 },
      button: { fontWeight: 600, textTransform: "none" },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { fontWeight: 600, paddingInline: 16, borderRadius: 6 },
          outlined: { borderColor: t.border, "&:hover": { borderColor: accentMain, backgroundColor: t.accentTint } },
          containedPrimary: {
            boxShadow: "none",
            "&:hover": { boxShadow: "0 1px 2px rgba(0,0,0,0.08)" },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: "none",
            borderBottom: `1px solid ${t.border}`,
            backgroundColor: mode === "dark" ? "rgba(26,24,21,0.9)" : "rgba(251,249,245,0.9)",
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
            "&:hover .MuiCard-root": { borderColor: t.accentBorderLight, boxShadow: mode === "dark" ? "0 4px 14px rgba(0,0,0,0.35)" : "0 4px 14px rgba(28,27,25,0.06)" },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 5 },
          outlined: { borderColor: t.border },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 12, boxShadow: mode === "dark" ? "0 20px 60px rgba(0,0,0,0.5)" : "0 20px 60px rgba(28,27,25,0.18)" },
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
            borderRadius: 6,
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

export { ACCENT };
