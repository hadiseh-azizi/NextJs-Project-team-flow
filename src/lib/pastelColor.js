// Deterministically maps any string (a user id, a team id, a name) to one
// of a fixed set of pastel colors — the same input always gets the same
// color, so a person's avatar color stays consistent across the app
// without anyone having to pick it. Light mode gets soft pastels; dark
// mode gets the same hues shifted deep and muted instead of glowing.
const PALETTE = [
  { light: "#F6D8DA", dark: "#5A2E35" }, // rose
  { light: "#F8E0CA", dark: "#583B25" }, // peach
  { light: "#F4EBC3", dark: "#524A22" }, // lemon
  { light: "#D6EBDB", dark: "#264636" }, // mint
  { light: "#D7E6F0", dark: "#243B50" }, // sky
  { light: "#E5DEEE", dark: "#3F3453" }, // lavender
  { light: "#EDE4D3", dark: "#4A3C28" }, // sand
  { light: "#F7DAD2", dark: "#552D28" }, // coral
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
