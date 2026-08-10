// Deterministically maps any string (a user id, a team id, a name) to one
// of a fixed set of pastel colors — the same input always gets the same
// color, so a person's avatar color stays consistent across the app
// without anyone having to pick it. Light mode gets soft pastels; dark
// mode gets the same hues shifted deep and muted instead of glowing.
const PALETTE = [
  { light: "#FBD5DD", dark: "#5C2B36" }, // rose
  { light: "#FCE1C8", dark: "#5A3B22" }, // peach
  { light: "#FBF0C0", dark: "#544B1D" }, // lemon
  { light: "#D3F0DD", dark: "#234A34" }, // mint
  { light: "#D6E9FB", dark: "#20395A" }, // sky
  { light: "#E4DBF7", dark: "#3B2E56" }, // lavender
  { light: "#EEE3D2", dark: "#4A3C28" }, // sand
  { light: "#FCDCD8", dark: "#552B27" }, // coral
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
