// The set of colors a person can pick for a task card. Each has a light-
// mode pastel and a dark-mode deep/muted counterpart so a task's color
// stays recognizable (and legible) in either theme.
export const TASK_COLORS = [
  { key: "rose", label: "Rose", light: "#FBD5DD", dark: "#5C2B36" },
  { key: "peach", label: "Peach", light: "#FCE1C8", dark: "#5A3B22" },
  { key: "lemon", label: "Lemon", light: "#FBF0C0", dark: "#544B1D" },
  { key: "mint", label: "Mint", light: "#D3F0DD", dark: "#234A34" },
  { key: "sky", label: "Sky", light: "#D6E9FB", dark: "#20395A" },
  { key: "lavender", label: "Lavender", light: "#E4DBF7", dark: "#3B2E56" },
  { key: "sand", label: "Sand", light: "#EEE3D2", dark: "#4A3C28" },
  { key: "coral", label: "Coral", light: "#FCDCD8", dark: "#552B27" },
];

export function resolveTaskColor(key, mode = "light") {
  const entry = TASK_COLORS.find((c) => c.key === key);
  if (!entry) return null;
  return mode === "dark" ? entry.dark : entry.light;
}
