// The one place Team Flow's colors are defined.
//
// Everything visual comes from here: lib/theme.js builds the MUI theme from
// these tokens, brandCssVariables() emits them as the --brand-* CSS custom
// properties (injected once in app/layout.jsx), and lib/entityColor.js /
// lib/pastelColor.js derive their palettes from the same family. Nothing
// else in the app should contain a brand color literal.
//
// Where the colors come from
//   The mark (public/brand/symbol.png) is built from three hues: a clear
//   blue (sampled around #2478FC), a violet (#6C60F0 - #735AFB) and a
//   teal-to-mint (#24C0CC - #50E6B5). The UI uses those same three hues,
//   stepped darker for light mode (so text and buttons clear WCAG AA on
//   white) and lighter for dark mode.
//
//   role        light      dark       from the mark
//   primary     #1D5FD8    #5B9BFF    the blue
//   secondary   #5B4FD6    #A9A0FF    the violet
//   accent      #0B7F6A    #3FD9B6    the teal / mint
//
// Restraint: blue does the work (actions, focus, current location). Violet
// and teal appear as secondary accents and in charts and identity colors,
// never as competing button colors. Neutrals are blue-tinted greys so
// surfaces sit in the same family as the mark. Everything is flat - the
// only gradient in the product is the one inside the "Flow" wordmark,
// which belongs to the logo itself.
//
// Warning and error have no counterpart in the mark, so they are plain
// amber and red, tuned to sit next to the blues without clashing.

export const BRAND = {
  light: {
    primary: "#1D5FD8",
    primaryHover: "#174FB4",
    primaryActive: "#123F91",
    onPrimary: "#FFFFFF",
    secondary: "#5B4FD6",
    accent: "#0B7F6A",

    background: "#F5F7FB",
    surface: "#FFFFFF",
    surfaceElevated: "#FFFFFF",
    surfaceSunken: "#EBEFF6",
    surfaceInput: "#FFFFFF",
    track: "#E1E7F1",

    border: "#DCE3EE",
    borderStrong: "#C2CCDC",

    text: "#0F1B2D",
    textSecondary: "#55647A",
    textMuted: "#66758B",
    textDisabled: "#8C99AD",

    success: "#12805C",
    warning: "#8A5A00",
    error: "#B3261E",
    errorHover: "#8F1E17",
    info: "#0F7A99",

    tooltipBackground: "#1B2740",
    tooltipText: "#F5F7FB",
    backdrop: "rgba(15,27,45,0.42)",
  },
  dark: {
    primary: "#5B9BFF",
    primaryHover: "#8FBAFF",
    primaryActive: "#B4D1FF",
    onPrimary: "#0B1220",
    secondary: "#A9A0FF",
    accent: "#3FD9B6",

    background: "#0C1420",
    surface: "#111A28",
    surfaceElevated: "#172233",
    surfaceSunken: "#0A1019",
    surfaceInput: "#0E1724",
    track: "#1E2B42",

    border: "#24324A",
    borderStrong: "#34455F",

    text: "#E8EEF7",
    textSecondary: "#A3B1C7",
    textMuted: "#8493AA",
    textDisabled: "#66758B",

    success: "#4CD9A0",
    warning: "#E5B84B",
    error: "#FF9A92",
    errorHover: "#FFB8B2",
    info: "#5CC8E6",

    tooltipBackground: "#E8EEF7",
    tooltipText: "#0C1420",
    backdrop: "rgba(4,8,14,0.66)",
  },
};

// The "Flow" half of the wordmark. These are the logo's own colors, sampled
// from the mark and left exactly as the official brand defines them; they
// live here so the wordmark is not the one place with private literals.
export const WORDMARK = {
  gradient: {
    dark: "linear-gradient(90deg, #6A6FF7 0%, #3E8EFB 38%, #3EB6F5 66%, #35DEB4 100%)",
    light: "linear-gradient(90deg, #5B5FEE 0%, #2F7DF0 38%, #1FA3DC 66%, #17BE97 100%)",
  },
  // Solid fallback for browsers without background-clip: text.
  fallback: { dark: "#3EB6F5", light: "#1FA3DC" },
};

// Cool grey scale for MUI's palette.grey, derived from the neutrals above.
export const GREY = {
  light: { 50: "#F5F7FB", 100: "#EBEFF6", 200: "#DCE3EE", 300: "#C2CCDC", 400: "#8C99AD", 500: "#55647A" },
  dark: { 50: "#0F1826", 100: "#152033", 200: "#24324A", 300: "#34455F", 400: "#8493AA", 500: "#A3B1C7" },
};

// ---------------------------------------------------------------------
// Color helpers (pure; used to derive variants so they are computed from
// the palette rather than hand-picked one by one).
// ---------------------------------------------------------------------

function parseHex(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Mixes `hex` with `into`; amount is how much of `into` to blend in (0..1).
export function mixHex(hex, into, amount) {
  const a = parseHex(hex);
  const b = parseHex(into);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

// hex + alpha -> rgba() string.
export function rgbaHex(hex, alpha) {
  const [r, g, bl] = parseHex(hex);
  return `rgba(${r},${g},${bl},${alpha})`;
}

// Three elevation levels, tinted with the palette's own ink (light) or
// deepest surface (dark) so shadows stay in the same blue-tinted family.
export const SHADOW = {
  light: {
    card: `0 1px 2px ${rgbaHex(BRAND.light.text, 0.07)}`,
    raised: `0 3px 10px ${rgbaHex(BRAND.light.text, 0.1)}`,
    overlay: `0 12px 32px ${rgbaHex(BRAND.light.text, 0.16)}`,
  },
  dark: {
    card: `0 1px 2px ${rgbaHex(BRAND.dark.surfaceSunken, 0.7)}`,
    raised: `0 4px 14px ${rgbaHex(BRAND.dark.surfaceSunken, 0.75)}`,
    overlay: `0 12px 32px ${rgbaHex(BRAND.dark.surfaceSunken, 0.85)}`,
  },
};

// ---------------------------------------------------------------------
// --brand-* CSS custom properties
// ---------------------------------------------------------------------

const CSS_VAR_NAMES = {
  primary: "--brand-primary",
  primaryHover: "--brand-primary-hover",
  primaryActive: "--brand-primary-active",
  onPrimary: "--brand-on-primary",
  secondary: "--brand-secondary",
  accent: "--brand-accent",
  background: "--brand-background",
  surface: "--brand-surface",
  surfaceElevated: "--brand-surface-elevated",
  surfaceSunken: "--brand-surface-sunken",
  border: "--brand-border",
  borderStrong: "--brand-border-strong",
  text: "--brand-text",
  textSecondary: "--brand-text-secondary",
  textMuted: "--brand-text-muted",
  success: "--brand-success",
  warning: "--brand-warning",
  error: "--brand-error",
  info: "--brand-info",
};

function block(tokens, shadow) {
  const lines = Object.entries(CSS_VAR_NAMES).map(([key, name]) => `  ${name}: ${tokens[key]};`);
  // Focus and selected states are derived, not separate colors.
  lines.push(`  --brand-focus: ${tokens.primary};`);
  lines.push(`  --brand-shadow-card: ${shadow.card};`);
  lines.push(`  --brand-shadow-raised: ${shadow.raised};`);
  lines.push(`  --brand-shadow-overlay: ${shadow.overlay};`);
  return lines.join("\n");
}

// Returns the stylesheet text that declares the tokens for both color
// schemes. app/layout.jsx renders it once in <head>; globals.css and any
// plain-CSS consumer read the variables instead of repeating hex values.
// `data-theme-mode` is set before first paint by the inline script in
// layout.jsx, and :root carries the light values as the no-JS fallback.
export function brandCssVariables() {
  return [
    `:root,\nhtml[data-theme-mode="light"] {\n${block(BRAND.light, SHADOW.light)}\n}`,
    `html[data-theme-mode="dark"] {\n${block(BRAND.dark, SHADOW.dark)}\n}`,
  ].join("\n");
}
