import { createTheme, responsiveFontSizes } from "@mui/material/styles";

// Design direction: a warm, neutral paper base carries the interface, with
// a single solid ochre accent reserved for primary actions and focus
// states. No gradients, no colored glow shadows, no backdrop blur — flat
// surfaces, hairline borders, and a serif display face for headings do
// the work of giving the product a personality. Pastel hues are kept
// only where they carry information (avatars, team badges, task labels).

export const INK_TOKENS = {
  light: "#1E1B16",
  dark: "#F2EFE8",
};

const LIGHT = {
  ink: "#1E1B16",
  subtle: "#6F6A5F",
  border: "#E3DFD3",
  canvas: "#FAFAF6",
  paper: "#FFFFFF",
  accentTint: "rgba(168,117,46,0.08)",
  accentBorderLight: "#D6B78A",
  progressTrack: "#EFEBE2",
  grey: { 50: "#F7F5EF", 100: "#F1EDE3", 200: "#E3DFD3", 300: "#CFC9B9", 400: "#A19A87", 500: "#6F6A5F" },
};

const DARK = {
  ink: "#F2EFE8",
  subtle: "#B6AF9E",
  border: "#3A362C",
  canvas: "#1A1814",
  paper: "#221F1A",
  accentTint: "rgba(201,154,74,0.14)",
  accentBorderLight: "#7A5F32",
  progressTrack: "#332E22",
  grey: { 50: "#241F1A", 100: "#2B261F", 200: "#3A362C", 300: "#4A4436", 400: "#8A8371", 500: "#B6AF9E" },
};

export function buildTheme(mode) {
  const t = mode === "dark" ? DARK : LIGHT;
  const accentMain = mode === "dark" ? "#C99A4A" : "#A8752E";
  const secondaryMain = mode === "dark" ? "#8FA98F" : "#4F7A5A";

  const theme = createTheme({
    direction: "ltr",
    palette: {
      mode,
      primary: { main: accentMain, dark: mode === "dark" ? "#A8752E" : "#8F5F22", light: mode === "dark" ? "#DCB878" : "#C79857" },
      secondary: { main: secondaryMain },
      success: { main: mode === "dark" ? "#8FC29E" : "#3F7A52" },
      warning: { main: mode === "dark" ? "#E0BC7A" : "#A8752E" },
      error: { main: mode === "dark" ? "#E29B93" : "#B23B2E" },
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
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { fontWeight: 600, paddingInline: 18, borderRadius: 8 },
          outlined: { borderColor: t.border, "&:hover": { borderColor: accentMain, backgroundColor: t.accentTint } },
          containedPrimary: {
            backgroundColor: accentMain,
            color: "#FFFFFF",
            "&:hover": { backgroundColor: mode === "dark" ? "#DCB878" : "#8F5F22" },
            "&.Mui-disabled": { backgroundColor: t.grey[200] },
          },
        },
      },
      MuiFab: {
        styleOverrides: {
          primary: { backgroundColor: accentMain, "&:hover": { backgroundColor: mode === "dark" ? "#DCB878" : "#8F5F22" } },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: "none",
            borderBottom: `1px solid ${t.border}`,
            backgroundColor: t.paper,
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
            transition: "border-color .15s ease",
          },
        },
      },
      MuiCardActionArea: {
        styleOverrides: {
          root: {
            "&:hover": { backgroundColor: "transparent" },
            "&:hover .MuiCard-root": { borderColor: t.accentBorderLight },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 6, maxWidth: "100%" },
          outlined: { borderColor: t.border },
          label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 10, boxShadow: mode === "dark" ? "0 12px 32px rgba(0,0,0,0.45)" : "0 12px 32px rgba(30,27,22,0.14)" },
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
