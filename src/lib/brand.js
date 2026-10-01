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
// surfaces sit in the same family as the mark.
//
// Gradients: the mark's own four colors (STOPS below, the same ones the
// "Flow" wordmark uses) are the only source of gradient in the product.
// GRADIENT holds the visible ones (accent lines, progress bars, the active
// nav indicator, the primary button); ATMOSPHERE holds the very faint
// washes of the same four colors that sit behind pages. Both are emitted
// as --brand-* variables, so no component writes its own gradient.
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

// The four colors of the mark, left to right: violet-blue, blue, cyan, mint.
// Sampled from the mark and left exactly as the official brand defines them
// (light is a step deeper so the letters hold against paper). The wordmark,
// every gradient and every atmosphere wash below is built from these.
export const STOPS = {
  dark: ["#6A6FF7", "#3E8EFB", "#3EB6F5", "#35DEB4"],
  light: ["#5B5FEE", "#2F7DF0", "#1FA3DC", "#17BE97"],
};
const STOP_AT = ["0%", "38%", "66%", "100%"];

// linear-gradient through the four stops at the given angle and alpha.
function flowGradient(stops, angle = "90deg", alpha = 1) {
  const parts = stops.map((c, i) => `${alpha === 1 ? c : rgbaHex(c, alpha)} ${STOP_AT[i]}`);
  return `linear-gradient(${angle}, ${parts.join(", ")})`;
}

// The "Flow" half of the wordmark.
export const WORDMARK = {
  gradient: {
    dark: flowGradient(STOPS.dark),
    light: flowGradient(STOPS.light),
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

// WCAG relative luminance and contrast ratio, used to pick text that stays
// readable on a tinted or gradient background without hand-checking each one.
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Picks the brand's dark ink or light ink, whichever has the better worst-case
// contrast across every color the text may sit on (both ends of a gradient).
export function readableInk(backgrounds) {
  const dark = BRAND.light.text;
  const light = BRAND.dark.text;
  const worst = (ink) => Math.min(...backgrounds.map((bg) => contrastRatio(ink, bg)));
  return worst(dark) >= worst(light) ? dark : light;
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
// Gradient system
//
// brand     the official gradient, fully visible. Accent lines, the active
//           nav indicator, progress fills, chart bars.
// strong    the same gradient at 135deg, for larger anchors.
// soft      ~18% alpha: hover washes, selected rows, empty-state fills.
// subtle    ~8% alpha: card and panel tints, dialog headers.
// border    ~55% alpha, used as a 1px masked ring (see .tf-ring in
//           globals.css) on featured surfaces.
// glow      a soft colored shadow for hover and the hero board preview.
// action    the primary button. Built only from the parts of the gradient
//           that keep the label at WCAG AA (white text in light mode, dark
//           text in dark mode), so it is narrower than the brand gradient.
// ---------------------------------------------------------------------

function buildGradients(mode) {
  const dark = mode === "dark";
  const st = STOPS[mode];
  const b = BRAND[mode];
  return {
    brand: flowGradient(st),
    strong: flowGradient(st, "135deg"),
    soft: flowGradient(st, "90deg", dark ? 0.24 : 0.18),
    subtle: flowGradient(st, "135deg", dark ? 0.12 : 0.08),
    border: flowGradient(st, "135deg", dark ? 0.7 : 0.55),
    glow: `0 8px 28px ${rgbaHex(st[1], dark ? 0.26 : 0.2)}, 0 2px 8px ${rgbaHex(st[3], dark ? 0.14 : 0.1)}`,
    action: dark
      ? `linear-gradient(90deg, ${b.primary}, ${st[2]})`
      : `linear-gradient(90deg, ${mixHex(st[0], "#000000", 0.15)}, ${b.primary})`,
    actionHover: dark
      ? `linear-gradient(90deg, ${b.primaryHover}, ${mixHex(st[2], "#FFFFFF", 0.25)})`
      : `linear-gradient(90deg, ${mixHex(st[0], "#000000", 0.28)}, ${b.primaryHover})`,
  };
}

export const GRADIENT = { light: buildGradients("light"), dark: buildGradients("dark") };

// A project's own progress fill: its identity color flowing toward the
// brand's cyan, so projects stay distinguishable but the bars still read
// as Team Flow.
export function accentGradient(hex, mode = "light") {
  const st = STOPS[mode === "dark" ? "dark" : "light"];
  return `linear-gradient(90deg, ${hex}, ${mixHex(hex, st[2], 0.55)})`;
}

// Faint washes of the four brand colors that sit behind content. Alphas
// are deliberately low; the content surfaces above them stay opaque, so
// text never sits directly on a color.
//   page     fixed behind every route (body::before in globals.css)
//   hero     the landing page's extra glow behind the board preview
//   panel    tint at the top edge of a content panel
function buildAtmosphere(mode) {
  const dark = mode === "dark";
  const [violet, blue, cyan, mint] = STOPS[mode];
  const a = dark ? { v: 0.16, b: 0.13, c: 0.1, m: 0.09 } : { v: 0.09, b: 0.07, c: 0.08, m: 0.07 };
  return {
    page: [
      `radial-gradient(60rem 42rem at 6% -6%, ${rgbaHex(violet, a.v)}, transparent 62%)`,
      `radial-gradient(52rem 38rem at 96% 4%, ${rgbaHex(cyan, a.c)}, transparent 60%)`,
      `radial-gradient(56rem 40rem at 78% 104%, ${rgbaHex(mint, a.m)}, transparent 62%)`,
      `radial-gradient(44rem 34rem at 0% 96%, ${rgbaHex(blue, a.b)}, transparent 60%)`,
    ].join(", "),
    hero: [
      `radial-gradient(closest-side, ${rgbaHex(blue, dark ? 0.3 : 0.2)}, transparent)`,
      `radial-gradient(closest-side, ${rgbaHex(mint, dark ? 0.22 : 0.16)}, transparent)`,
    ],
    panel: `linear-gradient(180deg, ${rgbaHex(blue, dark ? 0.1 : 0.05)}, transparent 55%)`,
    // A slightly tinted version of the sunken surface for board columns and
    // empty states, so they are not plain grey.
    sunken: dark ? mixHex(BRAND.dark.surfaceSunken, blue, 0.07) : mixHex(BRAND.light.surfaceSunken, blue, 0.05),
    // Border color that picks up the brand blue on hover.
    borderHover: rgbaHex(blue, dark ? 0.55 : 0.5),
  };
}

export const ATMOSPHERE = { light: buildAtmosphere("light"), dark: buildAtmosphere("dark") };

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

function block(tokens, shadow, gradient, atmosphere) {
  const lines = Object.entries(CSS_VAR_NAMES).map(([key, name]) => `  ${name}: ${tokens[key]};`);
  // Focus and selected states are derived, not separate colors.
  lines.push(`  --brand-focus: ${tokens.primary};`);
  lines.push(`  --brand-shadow-card: ${shadow.card};`);
  lines.push(`  --brand-shadow-raised: ${shadow.raised};`);
  lines.push(`  --brand-shadow-overlay: ${shadow.overlay};`);
  lines.push(`  --brand-gradient: ${gradient.brand};`);
  lines.push(`  --brand-gradient-strong: ${gradient.strong};`);
  lines.push(`  --brand-gradient-soft: ${gradient.soft};`);
  lines.push(`  --brand-gradient-subtle: ${gradient.subtle};`);
  lines.push(`  --brand-gradient-border: ${gradient.border};`);
  lines.push(`  --brand-gradient-action: ${gradient.action};`);
  lines.push(`  --brand-gradient-action-hover: ${gradient.actionHover};`);
  lines.push(`  --brand-glow: ${gradient.glow};`);
  lines.push(`  --brand-atmosphere: ${atmosphere.page};`);
  lines.push(`  --brand-atmosphere-hero-a: ${atmosphere.hero[0]};`);
  lines.push(`  --brand-atmosphere-hero-b: ${atmosphere.hero[1]};`);
  lines.push(`  --brand-panel-wash: ${atmosphere.panel};`);
  lines.push(`  --brand-surface-tint: ${atmosphere.sunken};`);
  lines.push(`  --brand-border-hover: ${atmosphere.borderHover};`);
  return lines.join("\n");
}

// Returns the stylesheet text that declares the tokens for both color
// schemes. app/layout.jsx renders it once in <head>; globals.css and any
// plain-CSS consumer read the variables instead of repeating hex values.
// `data-theme-mode` is set before first paint by the inline script in
// layout.jsx, and :root carries the light values as the no-JS fallback.
export function brandCssVariables() {
  return [
    `:root,\nhtml[data-theme-mode="light"] {\n${block(BRAND.light, SHADOW.light, GRADIENT.light, ATMOSPHERE.light)}\n}`,
    `html[data-theme-mode="dark"] {\n${block(BRAND.dark, SHADOW.dark, GRADIENT.dark, ATMOSPHERE.dark)}\n}`,
  ].join("\n");
}
