// The set of colors a person can pick for a task card. Each has a light-
// mode pastel and a dark-mode deep/muted counterpart so a task's color
// stays recognizable (and legible) in either theme.
export const TASK_COLORS = [
  { key: "rose", label: "Rose", light: "#F6D8DA", dark: "#5A2E35" },
  { key: "peach", label: "Peach", light: "#F8E0CA", dark: "#583B25" },
  { key: "lemon", label: "Lemon", light: "#F4EBC3", dark: "#524A22" },
  { key: "mint", label: "Mint", light: "#D6EBDB", dark: "#264636" },
  { key: "sky", label: "Sky", light: "#D7E6F0", dark: "#243B50" },
  { key: "lavender", label: "Lavender", light: "#E5DEEE", dark: "#3F3453" },
  { key: "sand", label: "Sand", light: "#EDE4D3", dark: "#4A3C28" },
  { key: "coral", label: "Coral", light: "#F7DAD2", dark: "#552D28" },
];

export function resolveTaskColor(key, mode = "light") {
  const entry = TASK_COLORS.find((c) => c.key === key);
  if (!entry) return null;
  return mode === "dark" ? entry.dark : entry.light;
}
