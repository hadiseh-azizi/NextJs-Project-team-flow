import { createTheme, responsiveFontSizes, alpha } from "@mui/material/styles";

// Design direction: a warm paper canvas, hairline borders, and one deep
// ochre accent that is reserved for the primary action, focus, and the
// current location in navigation. Fraunces is used only where the product
// speaks in a headline voice (page titles, dialog titles, the wordmark);
// everything you read or operate is Plus Jakarta Sans.
//
// Token scale (used everywhere instead of ad-hoc values)
//   radius   4 chips / menu items / tooltips, 6 buttons / inputs / task cards,
//            8 columns / dialogs / menus
//   spacing  MUI 8px base — 4 (related), 8, 12, 16 (within a group),
//            24, 32, 40 (between sections)
//   type     12.5 caption, 14 body2 / controls, 15 body1, 16 section heading,
//            20 dialog title, 24 auth title, 30 page title
//   depth    three levels only: card (resting), raised (hover / menus),
//            overlay (dialogs). Surfaces step canvas < sunken < paper.

export const INK_TOKENS = {
  light: "#1E1B16",
  dark: "#F2EFE8",
};

const LIGHT = {
  ink: "#1E1B16",
  subtle: "#6F6A5F",
  disabled: "#9A9484",
  line: "#E3DFD3",
  lineStrong: "#CFC9B9",
  canvas: "#FAFAF6",
  paper: "#FFFFFF",
  overlay: "#FFFFFF",
  sunken: "#F3F0E8",
  input: "#FFFFFF",
  hover: "rgba(30,27,22,0.045)",
  progressTrack: "#ECE8DD",
  accent: "#96652A",
  accentHover: "#7F531E",
  accentSoft: "#B4834A",
  onAccent: "#FFFFFF",
  shadow: {
    card: "0 1px 2px rgba(30,27,22,0.07)",
    raised: "0 3px 10px rgba(30,27,22,0.10)",
    overlay: "0 12px 32px rgba(30,27,22,0.16)",
  },
  backdrop: "rgba(30,27,22,0.38)",
  grey: { 50: "#F7F5EF", 100: "#F1EDE3", 200: "#E3DFD3", 300: "#CFC9B9", 400: "#A19A87", 500: "#6F6A5F" },
};

const DARK = {
  ink: "#F2EFE8",
  subtle: "#B6AF9E",
  disabled: "#8A8371",
  line: "#37332B",
  lineStrong: "#4A4436",
  canvas: "#1A1814",
  paper: "#28241E",
  overlay: "#2E2A23",
  sunken: "#211E19",
  input: "#1F1C17",
  hover: "rgba(242,239,232,0.06)",
  progressTrack: "#332E22",
  accent: "#C99A4A",
  accentHover: "#DCB878",
  accentSoft: "#A8752E",
  onAccent: "#1A1814",
  shadow: {
    card: "0 1px 2px rgba(0,0,0,0.40)",
    raised: "0 4px 14px rgba(0,0,0,0.45)",
    overlay: "0 12px 32px rgba(0,0,0,0.55)",
  },
  backdrop: "rgba(8,7,5,0.62)",
  grey: { 50: "#241F1A", 100: "#2B261F", 200: "#3A362C", 300: "#4A4436", 400: "#8A8371", 500: "#B6AF9E" },
};

const SANS = "'Plus Jakarta Sans', Roboto, Arial, sans-serif";
const SERIF = "'Fraunces', Georgia, serif";

export function buildTheme(mode) {
  const dark = mode === "dark";
  const t = dark ? DARK : LIGHT;

  const focusRing = `2px solid ${t.accent}`;

  const theme = createTheme({
    direction: "ltr",
    palette: {
      mode,
      primary: { main: t.accent, dark: t.accentHover, light: t.accentSoft, contrastText: t.onAccent },
      secondary: { main: dark ? "#8FA98F" : "#4F7A5A" },
      success: { main: dark ? "#8FC29E" : "#3F7A52" },
      warning: { main: dark ? "#E0BC7A" : "#8A6100" },
      error: { main: dark ? "#E29B93" : "#B23B2E" },
      info: { main: dark ? "#9DB8C7" : "#3F6478" },
      text: { primary: t.ink, secondary: t.subtle, disabled: t.disabled },
      divider: t.line,
      background: { default: t.canvas, paper: t.paper },
      action: { hover: t.hover, selected: alpha(t.accent, dark ? 0.16 : 0.1) },
      grey: t.grey,
      // Custom tokens, read as theme.palette.surface / theme.palette.line
      surface: { sunken: t.sunken, hover: t.hover, overlay: t.overlay, input: t.input },
      line: { main: t.line, strong: t.lineStrong },
    },
    tf: { shadow: t.shadow },
    typography: {
      fontFamily: SANS,
      fontSize: 14,
      h3: { fontFamily: SERIF, fontWeight: 500, fontSize: "2.75rem", lineHeight: 1.12, letterSpacing: "-0.02em" },
      h4: { fontFamily: SERIF, fontWeight: 500, fontSize: "1.875rem", lineHeight: 1.2, letterSpacing: "-0.015em" },
      h5: { fontFamily: SERIF, fontWeight: 500, fontSize: "1.5rem", lineHeight: 1.25, letterSpacing: "-0.01em" },
      h6: { fontFamily: SANS, fontWeight: 600, fontSize: "1rem", lineHeight: 1.4 },
      subtitle1: { fontWeight: 600, fontSize: "0.9375rem", lineHeight: 1.4 },
      subtitle2: { fontWeight: 600, fontSize: "0.875rem", lineHeight: 1.4 },
      body1: { fontSize: "0.9375rem", lineHeight: 1.6 },
      body2: { fontSize: "0.875rem", lineHeight: 1.5 },
      caption: { fontSize: "0.78rem", lineHeight: 1.45, letterSpacing: "0.005em" },
      overline: { fontSize: "0.78rem", fontWeight: 600, letterSpacing: 0, textTransform: "none", lineHeight: 1.45 },
      button: { fontWeight: 600, fontSize: "0.875rem", textTransform: "none", letterSpacing: 0 },
    },
    shape: { borderRadius: 6 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" },
          "::selection": { backgroundColor: alpha(t.accent, 0.28) },
          "*": { scrollbarColor: `${t.lineStrong} transparent` },
        },
      },
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: { "&.Mui-focusVisible": { outline: focusRing, outlineOffset: 2 } },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 6,
            lineHeight: 1.2,
            transition: "background-color .12s ease, border-color .12s ease, color .12s ease",
          },
          sizeMedium: { height: 36, paddingInline: 14 },
          sizeSmall: { height: 30, paddingInline: 10, fontSize: "0.8125rem" },
          sizeLarge: { height: 42, paddingInline: 18, fontSize: "0.9375rem" },
          containedPrimary: {
            backgroundColor: t.accent,
            color: t.onAccent,
            "&:hover": { backgroundColor: t.accentHover },
            "&:active": { backgroundColor: t.accentHover },
          },
          containedError: { "&:hover": { backgroundColor: dark ? "#EBB0A9" : "#983127" } },
          outlinedPrimary: {
            color: t.ink,
            borderColor: t.lineStrong,
            "&:hover": { borderColor: t.disabled, backgroundColor: t.hover },
          },
          outlinedInherit: {
            color: t.ink,
            borderColor: t.lineStrong,
            "&:hover": { borderColor: t.disabled, backgroundColor: t.hover },
          },
          outlinedError: {
            borderColor: alpha(dark ? "#E29B93" : "#B23B2E", 0.5),
            "&:hover": { backgroundColor: alpha(dark ? "#E29B93" : "#B23B2E", 0.08) },
          },
          textInherit: { "&:hover": { backgroundColor: t.hover } },
          textPrimary: {
            color: t.accent,
            "&:hover": { backgroundColor: alpha(t.accent, dark ? 0.14 : 0.08) },
          },
          textError: { "&:hover": { backgroundColor: alpha(dark ? "#E29B93" : "#B23B2E", dark ? 0.14 : 0.08) } },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            color: t.subtle,
            transition: "background-color .12s ease, color .12s ease",
            "&:hover": { backgroundColor: t.hover, color: t.ink },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "inherit" },
        styleOverrides: {
          root: {
            boxShadow: "none",
            borderBottom: `1px solid ${t.line}`,
            backgroundColor: t.canvas,
            backgroundImage: "none",
            color: t.ink,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
          outlined: { borderColor: t.line },
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: { borderRadius: 6, borderColor: t.line },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500, fontSize: "0.78rem", height: 24, borderRadius: 4, maxWidth: "100%" },
          outlined: { borderColor: t.lineStrong },
          label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingInline: 8 },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: { fontWeight: 600, fontSize: "0.75rem", color: t.ink },
        },
      },
      MuiBackdrop: {
        styleOverrides: { root: { backgroundColor: t.backdrop } },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            backgroundColor: t.overlay,
            boxShadow: t.shadow.overlay,
            "&.MuiDialog-paperFullScreen": { borderRadius: 0 },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontFamily: SERIF, fontSize: "1.25rem", fontWeight: 500, lineHeight: 1.3, letterSpacing: "-0.01em", padding: "20px 24px 8px" },
        },
      },
      MuiDialogContent: {
        styleOverrides: { root: { padding: "8px 24px 8px" } },
      },
      MuiDialogActions: {
        styleOverrides: { root: { padding: "16px 24px 20px", gap: 8, "& > :not(:first-of-type)": { marginLeft: 0 } } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { borderRadius: 8, border: `1px solid ${t.line}`, backgroundColor: t.overlay, boxShadow: t.shadow.raised },
          list: { padding: 4 },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: { boxShadow: t.shadow.raised },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 36,
            fontSize: "0.875rem",
            borderRadius: 4,
            "&.Mui-focusVisible": { outline: "none", backgroundColor: t.hover },
            "&.Mui-selected": { backgroundColor: alpha(t.accent, dark ? 0.16 : 0.1) },
            "&.Mui-selected:hover": { backgroundColor: alpha(t.accent, dark ? 0.22 : 0.14) },
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: false, enterDelay: 400 },
        styleOverrides: {
          tooltip: {
            backgroundColor: dark ? "#F2EFE8" : "#2B2721",
            color: dark ? "#1A1814" : "#FAFAF6",
            fontSize: "0.78rem",
            fontWeight: 500,
            borderRadius: 4,
            padding: "4px 8px",
          },
        },
      },
      MuiTextField: {
        defaultProps: { size: "small" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            backgroundColor: t.input,
            fontSize: "0.875rem",
            transition: "box-shadow .12s ease",
            "& .MuiOutlinedInput-notchedOutline": { borderColor: t.lineStrong, transition: "border-color .12s ease" },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: t.disabled },
            "&.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(t.accent, dark ? 0.28 : 0.2)}` },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 1, borderColor: t.accent },
            "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: dark ? "#E29B93" : "#B23B2E" },
            "&.Mui-error.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(dark ? "#E29B93" : "#B23B2E", 0.22)}` },
            "&.Mui-disabled": { backgroundColor: t.sunken },
            "&.MuiInputBase-multiline": { padding: 0 },
          },
          input: { padding: "8px 12px", "&:is(input)": { height: "1.4375em" } },
          inputMultiline: { padding: "8px 12px" },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select: { minHeight: "auto" },
          icon: { color: t.subtle },
        },
      },
      MuiFormHelperText: {
        styleOverrides: { root: { marginLeft: 0, marginRight: 0, marginTop: 6, fontSize: "0.78rem", lineHeight: 1.45 } },
      },
      MuiCheckbox: {
        styleOverrides: { root: { color: t.lineStrong } },
      },
      MuiFormControlLabel: {
        styleOverrides: { label: { fontSize: "0.875rem" } },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 6, fontSize: "0.875rem", alignItems: "center", color: t.ink },
          message: { padding: "6px 0" },
          standardError: { backgroundColor: alpha(dark ? "#E29B93" : "#B23B2E", dark ? 0.14 : 0.08), "& .MuiAlert-icon": { color: dark ? "#E29B93" : "#B23B2E" } },
          standardWarning: { backgroundColor: alpha(dark ? "#E0BC7A" : "#8A6100", dark ? 0.14 : 0.1), "& .MuiAlert-icon": { color: dark ? "#E0BC7A" : "#8A6100" } },
          standardSuccess: { backgroundColor: alpha(dark ? "#8FC29E" : "#3F7A52", dark ? 0.14 : 0.09), "& .MuiAlert-icon": { color: dark ? "#8FC29E" : "#3F7A52" } },
          standardInfo: { backgroundColor: alpha(dark ? "#9DB8C7" : "#3F6478", dark ? 0.14 : 0.08), "& .MuiAlert-icon": { color: dark ? "#9DB8C7" : "#3F6478" } },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 4, borderRadius: 2, backgroundColor: t.progressTrack },
          bar: { borderRadius: 2 },
        },
      },
      MuiSkeleton: {
        defaultProps: { animation: "pulse" },
        styleOverrides: {
          root: { backgroundColor: alpha(t.ink, dark ? 0.09 : 0.06) },
          rounded: { borderRadius: 6 },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: t.line } },
      },
      MuiLink: {
        defaultProps: { underline: "always" },
        styleOverrides: {
          root: {
            textDecorationColor: alpha(t.ink, 0.35),
            textUnderlineOffset: 3,
            transition: "color .12s ease, text-decoration-color .12s ease",
            "&:hover": { color: t.accent, textDecorationColor: t.accent },
          },
        },
      },
      MuiListItem: {
        styleOverrides: { root: { borderColor: t.line } },
      },
    },
  });

  return responsiveFontSizes(theme, { variants: ["h3", "h4", "h5"] });
}
