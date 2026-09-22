// Presentation helpers for due dates. Due dates are stored as UTC-midnight
// dates (see lib/dateOnly.js), so the calendar day the person picked is the
// first ten characters of the ISO string. "Today" is the viewer's own
// local calendar day, which is what "overdue" should mean to them.

export function localTodayYmd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isOverdue(dueDate, todayYmd) {
  if (!dueDate || !todayYmd) return false;
  const due = String(dueDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < todayYmd;
}
