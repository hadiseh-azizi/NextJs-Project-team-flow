// A deliberately simple, local heuristic for the reset-password page's
// strength meter — not a security control (the actual requirement, 6-72
// characters, is enforced server-side in reset-password/route.js; this is
// UI feedback only, so a generous or slightly-off score here can't weaken
// anything). Scores 0-4 by length and character variety.
export function scorePasswordStrength(password) {
  if (!password) return { score: 0, label: "" };

  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;

  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  return { score, label: password.length < 6 ? "Too short" : labels[score] };
}
