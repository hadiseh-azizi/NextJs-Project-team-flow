import { BRAND, mixHex } from "@/lib/brand";

// Deterministic "identity" colors for Projects and Teams — hash the id,
// index into a fixed palette. Same id always maps to the same color;
// nothing here is random or re-rolled on render.
//
// Both palettes are built from the Team Flow brand family (blue, violet,
// teal/mint from the mark — see lib/brand.js), never from unrelated hues.
// Variety comes from stepping each hue lighter, darker or toward its
// neighbor, so eight projects side by side still read as one product.
//
// PROJECT_PALETTE is the clearer, more saturated set. TEAM_PALETTE is the
// same family pulled deeper and calmer, so a team's color (a card's top
// edge, a tab) is never mistaken for a project's color, and no value is
// shared between the two palettes.
//
// Each project entry carries a "strong" tone (open tasks, card accents, the
// currently-relevant state) and a "muted" tone (closed/done tasks — the same
// hue, quieter), for both color schemes. The muted tone is computed from the
// strong one by blending toward the surface, so it can never drift into a
// different hue.

// [name, light strong, dark strong]
const PROJECT_HUES = [
  ["blue", "#1D5FD8", "#6AA5FF"], // brand blue
  ["violet", "#5B4FD6", "#A79EFF"], // brand violet
  ["teal", "#0E8A8F", "#4CCFD3"], // brand teal
  ["sky", "#1479BF", "#6CC0F5"], // lighter blue
  ["indigo", "#3E45BC", "#8E96F0"], // blue leaning violet
  ["mint", "#12946F", "#52D8AE"], // brand mint
  ["navy", "#2A4A8C", "#7F9DDD"], // darker blue
  ["lavender", "#7A6BE0", "#C1B8FF"], // lighter violet
];

const TEAM_HUES = [
  ["steel", "#2F5F9E", "#8DB0E6"],
  ["heather", "#5A52A8", "#B0A9EC"],
  ["deep teal", "#1C7C80", "#7CCBCE"],
  ["slate blue", "#2E6E8E", "#84C0DE"],
  ["dusk", "#4B5BA6", "#9EAAE6"],
  ["sea green", "#2F7D63", "#83CDB1"],
  ["ink blue", "#3B4F7A", "#96A9D4"],
  ["wisteria", "#7468B8", "#BDB5EA"],
];

const PROJECT_PALETTE = PROJECT_HUES.map(([, light, dark]) => ({
  strong: { light, dark },
  muted: {
    light: mixHex(light, BRAND.light.surface, 0.6),
    dark: mixHex(dark, BRAND.dark.surface, 0.62),
  },
}));

const TEAM_PALETTE = TEAM_HUES.map(([, light, dark]) => ({ strong: { light, dark } }));

function hashString(str) {
  let hash = 0;
  const s = String(str || "?");
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Returns { strong, muted } hex colors for a project id, in the given
// color scheme. `muted` is meant for closed/completed tasks — same hue
// family, lower emphasis.
export function projectColorForId(id, mode = "light") {
  const entry = PROJECT_PALETTE[hashString(id) % PROJECT_PALETTE.length];
  return {
    strong: mode === "dark" ? entry.strong.dark : entry.strong.light,
    muted: mode === "dark" ? entry.muted.dark : entry.muted.light,
  };
}

// Returns a single accent hex color for a team id. Teams don't currently
// have an open/closed distinction, so there's no muted variant.
export function teamColorForId(id, mode = "light") {
  const entry = TEAM_PALETTE[hashString(id) % TEAM_PALETTE.length];
  return entry.strong[mode === "dark" ? "dark" : "light"];
}
