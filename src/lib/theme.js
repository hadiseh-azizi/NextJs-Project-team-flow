import { createTheme, responsiveFontSizes } from "@mui/material/styles";

// Design direction: warm and editorial rather than another blue/indigo SaaS
// template — cream canvas, warm ink text, and a single terracotta accent
// used sparingly (primary actions, progress, the one signal that matters),
// with a serif face for headings to give the UI a considered, human voice
// instead of the generic sans-everywhere look.

const INK = "#1C1B19";
const SUBTLE = "#78716C";
const BORDER = "#E7E2D9";
const CANVAS = "#FBF9F5";
const ACCENT = "#B54A2C"; // terracotta — deliberately not blue/indigo/violet
const ACCENT_TINT = "rgba(181,74,44,0.06)";
const ACCENT_BORDER_LIGHT = "#E8B8A3";

const theme = createTheme({
  direction: "ltr",
  palette: {
    mode: "light",
    primary: { main: ACCENT, dark: "#8F3B22", light: "#C97A5C" },
    secondary: { main: "#4D6B4D" },
    success: { main: "#4D6B4D" },
    warning: { main: "#A16207" },
    error: { main: "#A3402C" },
    text: { primary: INK, secondary: SUBTLE },
    divider: BORDER,
    background: { default: CANVAS, paper: "#FFFFFF" },
    grey: {
      50: "#F3F0E9",
      100: "#EDE9E0",
      200: BORDER,
      300: "#D6D0C4",
      400: "#A8A29E",
      500: SUBTLE,
    },
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
        outlined: { borderColor: BORDER, "&:hover": { borderColor: ACCENT, backgroundColor: ACCENT_TINT } },
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
          borderBottom: `1px solid ${BORDER}`,
          backgroundColor: "rgba(251,249,245,0.9)",
          backdropFilter: "blur(8px)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        outlined: { borderColor: BORDER },
      },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          borderColor: BORDER,
          transition: "border-color .15s ease, box-shadow .15s ease",
        },
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: {
          "&:hover": { backgroundColor: "transparent" },
          "&:hover .MuiCard-root": { borderColor: ACCENT_BORDER_LIGHT, boxShadow: "0 4px 14px rgba(28,27,25,0.06)" },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 5 },
        outlined: { borderColor: BORDER },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12, boxShadow: "0 20px 60px rgba(28,27,25,0.18)" },
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
          "& fieldset": { borderColor: BORDER },
          "&:hover fieldset": { borderColor: ACCENT_BORDER_LIGHT },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { backgroundColor: "#F1E4DD" },
      },
    },
    MuiListItem: {
      styleOverrides: { root: { borderColor: BORDER } },
    },
  },
});

export { ACCENT, ACCENT_TINT, ACCENT_BORDER_LIGHT };
export default responsiveFontSizes(theme);
