import { PASSWORD_MIN_LENGTH } from "@/lib/passwordPolicy";

// A deliberately simple, local heuristic for the reset-password page's
// strength meter — not a security control (the actual requirement, 6+
// characters and at most 72 bytes, is enforced server-side via
// lib/passwordPolicy.js; this is UI feedback only, so a generous or
// slightly-off score here can't weaken anything). Scores 0-4 by length and
// character variety.
export function scorePasswordStrength(password) {
  if (!password) return { score: 0, label: "" };

  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score++;
  if (password.length >= 10) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;

  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  return { score, label: password.length < PASSWORD_MIN_LENGTH ? "Too short" : labels[score] };
}
