// Deterministically maps any string (a user id, a team id, a name) to one
// of a fixed set of soft tints — the same input always gets the same
// color, so a person's avatar color stays consistent across the app
// without anyone having to pick it.
//
// The tints are the Team Flow brand hues (blue, violet, teal, mint — see
// lib/brand.js) at low strength: light mode gets pale tints, dark mode gets
// the same hues deep and muted. Avatar initials sit on them in the normal
// text color, so contrast holds in both modes.
const PALETTE = [
  { light: "#D9E5FB", dark: "#1F3559" }, // blue
  { light: "#E3DFFA", dark: "#312C61" }, // violet
  { light: "#D1EDEF", dark: "#18424A" }, // teal
  { light: "#D3EFE3", dark: "#194337" }, // mint
  { light: "#D6EAF8", dark: "#1B3C54" }, // sky
  { light: "#DBDEF6", dark: "#2A3262" }, // indigo
  { light: "#DEE5F0", dark: "#2B3A54" }, // slate
  { light: "#ECE8FB", dark: "#3A3568" }, // lavender
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function pastelForString(str, mode = "light") {
  const entry = PALETTE[hashString(str || "?") % PALETTE.length];
  return mode === "dark" ? entry.dark : entry.light;
}
