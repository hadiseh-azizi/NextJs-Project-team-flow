import { createTheme, responsiveFontSizes, alpha } from "@mui/material/styles";
import Grow from "@mui/material/Grow";
import { BRAND, GREY, SHADOW, GRADIENT, ATMOSPHERE } from "@/lib/brand";

// Shared motion tokens — the same fast/normal/slow tiers used ad hoc as
// ".12s" throughout this file's styleOverrides, named here for the few
// places (dialogs, menus) that want a slightly longer, still-quick
// duration than the instant hover/press feedback everything else uses.
const MOTION = { fast: 120, normal: 200, slow: 280 };

// Design direction: a cool, blue-tinted canvas with hairline borders, faint
// washes of the mark's four colors behind the page (see ATMOSPHERE in
// lib/brand.js), and one brand blue reserved for the primary action, focus,
// and the current location in navigation. The brand gradient appears only
// as thin accents (progress fills, the active nav indicator, top hairlines).
// Violet and teal (the other two hues of the Team Flow mark) are secondary
// accents. Every color here comes from
// lib/brand.js — this file maps those tokens onto MUI, it does not define
// colors of its own. Fraunces is used only where the product speaks in a
// headline voice (page titles, dialog titles, the wordmark); everything you
// read or operate is Plus Jakarta Sans.
//
// Token scale (used everywhere instead of ad-hoc values)
//   radius   4 chips / menu items / tooltips, 6 buttons / inputs / task cards,
//            8 columns / dialogs / menus
//   spacing  MUI 8px base — 4 (related), 8, 12, 16 (within a group),
//            24, 32, 40 (between sections)
//   type     12.5 caption, 14 body2 / controls, 15 body1, 16 section heading,
//            20 dialog title, 24 auth title, 30 page title
//   depth    three levels only: card (resting), raised (hover / menus),
//            overlay (dialogs). Surfaces step background < sunken < surface.

// Adapts a BRAND color set to the names this file (and the rest of the app)
// reads. Purely a rename — no color is computed or overridden here.
function tokensFor(dark) {
  const b = dark ? BRAND.dark : BRAND.light;
  return {
    ...b,
    ink: b.text,
    subtle: b.textSecondary,
    disabled: b.textDisabled,
    line: b.border,
    lineStrong: b.borderStrong,
    canvas: b.background,
    paper: b.surface,
    overlay: b.surfaceElevated,
    sunken: b.surfaceSunken,
    input: b.surfaceInput,
    hover: alpha(b.text, dark ? 0.06 : 0.045),
    progressTrack: b.track,
    shadow: dark ? SHADOW.dark : SHADOW.light,
    grey: dark ? GREY.dark : GREY.light,
    gradient: dark ? GRADIENT.dark : GRADIENT.light,
    atmosphere: dark ? ATMOSPHERE.dark : ATMOSPHERE.light,
  };
}

const SANS = "'Plus Jakarta Sans', Roboto, Arial, sans-serif";
const SERIF = "'Fraunces', Georgia, serif";

export function buildTheme(mode) {
  const dark = mode === "dark";
  const t = tokensFor(dark);

  const focusRing = `2px solid ${t.primary}`;

  const theme = createTheme({
    direction: "ltr",
    palette: {
      mode,
      primary: { main: t.primary, dark: t.primaryHover, contrastText: t.onPrimary },
      secondary: { main: t.secondary },
      success: { main: t.success },
      warning: { main: t.warning },
      error: { main: t.error },
      info: { main: t.info },
      text: { primary: t.ink, secondary: t.subtle, disabled: t.disabled },
      divider: t.line,
      background: { default: t.canvas, paper: t.paper },
      action: { hover: t.hover, selected: alpha(t.primary, dark ? 0.16 : 0.1) },
      grey: t.grey,
      // Custom tokens, read as theme.palette.surface / theme.palette.line
      surface: { sunken: t.sunken, hover: t.hover, overlay: t.overlay, input: t.input, track: t.progressTrack },
      line: { main: t.line, strong: t.lineStrong },
      // Brand hues that are not MUI roles, read as theme.palette.brand.accent.
      brand: { accent: t.accent, secondary: t.secondary },
    },
    tf: { shadow: t.shadow, gradient: t.gradient, atmosphere: t.atmosphere },
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
          "::selection": { backgroundColor: alpha(t.primary, 0.28) },
          "*": { scrollbarColor: `${t.lineStrong} transparent` },
        },
      },
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: {
            "&.Mui-focusVisible": { outline: focusRing, outlineOffset: 2 },
            // A small, uniform press feedback for every clickable surface
            // built on ButtonBase (buttons, icon buttons, menu items, and
            // the CardActionArea that wraps project/team cards) — never
            // large enough to read as a "bounce".
            transition: "transform 100ms ease",
            "&:active:not(.Mui-disabled)": { transform: "scale(0.98)" },
          },
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
          // Solid color first (fallback, and what disabled/print use), the
          // action gradient on top. The label color is onPrimary — the
          // token brand.js defines; this used to read t.onAccent, which
          // does not exist, so the label silently fell back to MUI's own
          // contrast color instead of the brand's.
          containedPrimary: {
            backgroundColor: t.primary,
            backgroundImage: t.gradient.action,
            color: t.onPrimary,
            "&:hover": { backgroundColor: t.primaryHover, backgroundImage: t.gradient.actionHover },
            "&:active": { backgroundColor: t.primaryActive, backgroundImage: "none" },
            "&.Mui-disabled": { backgroundImage: "none" },
          },
          containedError: { "&:hover": { backgroundColor: t.errorHover } },
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
            borderColor: alpha(t.error, 0.5),
            "&:hover": { backgroundColor: alpha(t.error, 0.08) },
          },
          textInherit: { "&:hover": { backgroundColor: t.hover } },
          textPrimary: {
            color: t.primary,
            "&:hover": { backgroundColor: alpha(t.primary, dark ? 0.14 : 0.08) },
          },
          textError: { "&:hover": { backgroundColor: alpha(t.error, dark ? 0.14 : 0.08) } },
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
            // Opaque paper with a faint brand wash along its top edge; the
            // page atmosphere behind it stays visible only below the bar.
            backgroundColor: t.paper,
            backgroundImage: `${t.atmosphere.panel}`,
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
        defaultProps: {
          // Fade + a very slight scale (Grow) reads as an object settling
          // into place, rather than the plain opacity-only fade MUI uses
          // by default — applied here once so every dialog in the app
          // (task detail, new task, confirmations, choice prompts) picks
          // it up without each one wiring its own TransitionComponent.
          TransitionComponent: Grow,
          transitionDuration: { enter: MOTION.normal, exit: MOTION.fast },
        },
        styleOverrides: {
          paper: {
            borderRadius: 8,
            backgroundColor: t.overlay,
            backgroundImage: t.atmosphere.panel,
            boxShadow: t.shadow.overlay,
            position: "relative",
            // A 2px brand-gradient edge on top marks the overlay layer.
            "&::before": {
              content: '""',
              position: "absolute",
              insetInline: 0,
              top: 0,
              height: 2,
              background: t.gradient.brand,
              opacity: dark ? 0.85 : 0.9,
              pointerEvents: "none",
              borderRadius: "8px 8px 0 0",
            },
            "&.MuiDialog-paperFullScreen": { borderRadius: 0 },
            "&.MuiDialog-paperFullScreen::before": { borderRadius: 0 },
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
        defaultProps: { transitionDuration: MOTION.fast },
        styleOverrides: {
          paper: { borderRadius: 8, border: `1px solid ${t.line}`, backgroundColor: t.overlay, boxShadow: t.shadow.raised },
          list: { padding: 4 },
        },
      },
      MuiPopover: {
        defaultProps: { transitionDuration: MOTION.fast },
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
            "&.Mui-selected": { backgroundColor: alpha(t.primary, dark ? 0.16 : 0.1) },
            "&.Mui-selected:hover": { backgroundColor: alpha(t.primary, dark ? 0.22 : 0.14) },
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: false, enterDelay: 400 },
        styleOverrides: {
          tooltip: {
            backgroundColor: t.tooltipBackground,
            color: t.tooltipText,
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
            "&.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(t.primary, dark ? 0.28 : 0.2)}` },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 1, borderColor: t.primary },
            "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: t.error },
            "&.Mui-error.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(t.error, 0.22)}` },
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
          standardError: { backgroundColor: alpha(t.error, dark ? 0.14 : 0.08), "& .MuiAlert-icon": { color: t.error } },
          standardWarning: { backgroundColor: alpha(t.warning, dark ? 0.14 : 0.1), "& .MuiAlert-icon": { color: t.warning } },
          standardSuccess: { backgroundColor: alpha(t.success, dark ? 0.14 : 0.09), "& .MuiAlert-icon": { color: t.success } },
          standardInfo: { backgroundColor: alpha(t.info, dark ? 0.14 : 0.08), "& .MuiAlert-icon": { color: t.info } },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 4, borderRadius: 2, backgroundColor: t.progressTrack },
          // MUI already transitions a determinate bar's width on value
          // change; this just gives that built-in transition the same
          // easing/duration as the rest of the app instead of its default
          // linear timing, so a progress jump (e.g. 25% -> 40%) settles
          // rather than snapping.
          bar: { borderRadius: 2, transition: `transform ${MOTION.slow}ms cubic-bezier(0.4, 0, 0.2, 1)` },
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
            "&:hover": { color: t.primary, textDecorationColor: t.primary },
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
