// A small, curated set of background/accent pairings. Each theme swaps
// the canvas tint and the primary accent (used for buttons, links, focus
// rings, the active nav underline) together, so the two never clash —
// there is no separate "pick a background image" step, because the
// background here is a flat color tint, not an illustration.
//
// "default" reproduces the app's original warm-neutral + ochre palette
// exactly (see lib/theme.js's LIGHT/DARK constants) so a person who never
// opens the appearance picker sees no change at all. The other themes
// follow the same structure — a plain canvas/paper pair, one accent, one
// accent-hover, one soft accent — so buildTheme() only ever swaps a
// handful of tokens rather than rebuilding the palette.
//
// Deliberately flat: no gradients, no imagery, no per-project hue
// shifting. Project/team identity colors (lib/entityColor.js) stay fixed
// across themes so "which project is this" never depends on which
// appearance a teammate happens to have selected.
export const APPEARANCE_THEMES = [
  {
    id: "default",
    label: "Ochre Paper",
    description: "The original warm, neutral canvas.",
    light: { canvas: "#FAFAF6", paper: "#FFFFFF", accent: "#96652A", accentHover: "#7F531E", accentSoft: "#B4834A" },
    dark: { canvas: "#1A1814", paper: "#28241E", accent: "#C99A4A", accentHover: "#DCB878", accentSoft: "#A8752E" },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool, neutral grey with a steel-blue accent.",
    light: { canvas: "#F7F8F9", paper: "#FFFFFF", accent: "#3D6C8F", accentHover: "#2F5470", accentSoft: "#6690AC" },
    dark: { canvas: "#181B1E", paper: "#23272B", accent: "#7FA9C4", accentHover: "#9BC0D8", accentSoft: "#5C86A2" },
  },
  {
    id: "sage",
    label: "Sage",
    description: "Muted green canvas with a forest accent.",
    light: { canvas: "#F7F9F4", paper: "#FFFFFF", accent: "#4C7A4E", accentHover: "#3B6339", accentSoft: "#749E71" },
    dark: { canvas: "#181B16", paper: "#232821", accent: "#8FB98C", accentHover: "#A9CDA5", accentSoft: "#6C9468" },
  },
  {
    id: "clay",
    label: "Clay",
    description: "Warm terracotta canvas with a brick accent.",
    light: { canvas: "#FBF6F2", paper: "#FFFFFF", accent: "#A6512F", accentHover: "#8A3F22", accentSoft: "#C1795A" },
    dark: { canvas: "#1C1613", paper: "#28201B", accent: "#D48E6C", accentHover: "#E3AB8D", accentSoft: "#B26B49" },
  },
  {
    id: "plum",
    label: "Plum",
    description: "Quiet mauve canvas with a plum accent.",
    light: { canvas: "#F9F6F8", paper: "#FFFFFF", accent: "#7C4F72", accentHover: "#653D5C", accentSoft: "#9E7594" },
    dark: { canvas: "#1A1619", paper: "#252025", accent: "#BC93B1", accentHover: "#D2ADC7", accentSoft: "#95708C" },
  },
];

export const DEFAULT_APPEARANCE_THEME = "default";

export function getAppearanceTheme(id) {
  return APPEARANCE_THEMES.find((t) => t.id === id) || APPEARANCE_THEMES[0];
}
