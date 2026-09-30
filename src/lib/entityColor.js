// Deterministic "identity" colors for Projects and Teams — the same
// mechanism as pastelColor.js (hash the id, index into a fixed palette)
// but two separate, more saturated palettes so a project's color is never
// confused with a team's, a person's avatar (pastelColor.js), or a task's
// own chosen color (taskColors.js). Same id always maps to the same
// color; nothing here is random or re-rolled on render.
//
// Each entry carries a "strong" tone (open tasks, card accents, the
// currently-relevant state) and a "muted" tone (closed/done tasks —
// quieter, but still recognizably the same hue) for both color schemes.

const PROJECT_PALETTE = [
  { strong: { light: "#3B6FA0", dark: "#8FB4DA" }, muted: { light: "#A9C2D9", dark: "#4A617A" } }, // cobalt
  { strong: { light: "#8A5FB0", dark: "#C4A3E0" }, muted: { light: "#C7B5D9", dark: "#5D4E70" } }, // violet
  { strong: { light: "#3F8F6D", dark: "#8FD1B2" }, muted: { light: "#A6CBB9", dark: "#4A6B5A" } }, // jade
  { strong: { light: "#B4791F", dark: "#E0B36A" }, muted: { light: "#D7BE94", dark: "#6B5730" } }, // amber
  { strong: { light: "#B25444", dark: "#E29B8C" }, muted: { light: "#D6AFA4", dark: "#6B443A" } }, // terracotta
  { strong: { light: "#2E8B95", dark: "#84CBD3" }, muted: { light: "#9EC4C8", dark: "#3F6266" } }, // teal
  { strong: { light: "#A24D80", dark: "#DA9EBF" }, muted: { light: "#CDAABE", dark: "#664156" } }, // plum
  { strong: { light: "#6B7A2E", dark: "#B7C879" }, muted: { light: "#B9C093", dark: "#565F35" } }, // olive
];

const TEAM_PALETTE = [
  { strong: { light: "#45647E", dark: "#9AB6C8" } }, // steel
  { strong: { light: "#5C7A4A", dark: "#A6C48F" } }, // moss
  { strong: { light: "#9C5B3C", dark: "#D6A47F" } }, // rust
  { strong: { light: "#5A5EA8", dark: "#ADB0E0" } }, // indigo
  { strong: { light: "#8C6A22", dark: "#D3B36C" } }, // bronze
  { strong: { light: "#3E7C82", dark: "#8FC6CC" } }, // slate teal
  { strong: { light: "#8F4A54", dark: "#D19AA1" } }, // wine
  { strong: { light: "#6E5A8C", dark: "#B9A6D4" } }, // heather
];

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
