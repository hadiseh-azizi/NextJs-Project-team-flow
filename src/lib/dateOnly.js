// Due dates are inherently date-only ("Sep 7", not "Sep 7 at 3:04pm") — the
// HTML date input hands the API a plain "YYYY-MM-DD" string, and
// validateOptionalDate() (see lib/validation.js) turns that into a JS Date
// via `new Date("YYYY-MM-DD")`. Per spec, that constructor parses a
// date-only ISO string as UTC midnight, and it's stored in Mongo that way.
//
// The bug this fixes: formatting that Date with `toLocaleDateString()`
// (no options) renders it in the *browser's local timezone*. UTC midnight
// on the intended day is still "today" for timezones at/east of UTC, but
// for any timezone behind UTC — which is all of the continental US — it
// falls on the *previous* local day (e.g. UTC midnight Sep 7 is 8pm Sep 6
// in US Eastern). A user who picks "Sep 7" as a due date would see "Sep 6"
// on their own task card.
//
// The fix is to read the date back out in UTC (`timeZone: "UTC"`) instead
// of the browser's local zone, so the displayed calendar day always
// matches the one the user picked, regardless of where they're viewing it
// from. This only changes how an existing value is *displayed* — the
// stored representation (a UTC-midnight Date) is untouched, so existing
// data needs no migration.
export function formatDateOnly(value, options = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { timeZone: "UTC", ...options });
}
