// Single source for turning a name into an avatar initial. Used anywhere
// we render a one-letter avatar (navbar, task assignees, team member
// chips) so an empty string, whitespace-only name, or a name that starts
// with a symbol never renders a blank circle.
export function avatarInitial(name) {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}
