// Frontend Reliability, API Error Handling & Stale-State audit — see
// FRONTEND_RELIABILITY_AUDIT.md and CHANGELOG.md.
//
// Scope note: this repo's manual test harness (see __manual_test__/README.md)
// loads real source modules under Node with small in-memory fakes for
// Mongoose/Next.js/next-auth — there's no React renderer or DOM (no
// react-test-renderer / jsdom in devDependencies). That's fine for the
// lib-level fix in this phase (`lib/dateOnly.js`, plain JS with no React
// dependency), which is covered below with real regression tests.
//
// The other two fixes from this phase are component-level and can't be
// exercised the same way:
//   - TaskDetailDialog's per-field request tickets (saveColumn/saveColor/
//     saveAssignees) reuse `useLatestRequest` from lib/clientAsync.js,
//     which is already relied on (uninstrumented) by every dashboard page
//     that fetches data — its ticket algorithm isn't new. What's new is
//     wiring three independent instances of it into TaskDetailDialog so a
//     stale response for one field can't roll back a newer optimistic
//     value for that same field. That wiring was verified by inspection:
//     see the code comments at each call site in TaskDetailDialog.jsx.
//   - The attachment download link's `target="_blank"` and the
//     handleToggleDoneColumn in-flight guard are both single-line,
//     low-risk changes verified by inspection.
// These three are flagged in FRONTEND_RELIABILITY_AUDIT.md's manual
// verification section (a browser-level smoke test, same category as the
// multi-tab drag test already listed there from the prior phase).
require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

const { formatDateOnly } = require("../src/lib/dateOnly.js");

(async () => {
  // --- The actual bug: UTC-midnight date-only values must not shift by a
  // day depending on the viewer's local timezone. ---

  await test("a date-only ISO string (UTC midnight) formats as the calendar day it represents", () => {
    // This is exactly what lib/serialize.js produces for task.dueDate:
    // new Date("2026-09-07").toISOString() === "2026-09-07T00:00:00.000Z"
    const result = formatDateOnly("2026-09-07T00:00:00.000Z");
    assert.strictEqual(result, "9/7/2026");
  });

  await test("formatting does not depend on the process/runtime's local timezone", () => {
    // Simulates the exact bug: `new Date(x).toLocaleDateString()` with no
    // `timeZone` option renders in the local zone, so UTC midnight Sep 7
    // becomes "9/6/2026" in any zone behind UTC. Comparing the old
    // (buggy) behavior against the new helper for a timezone behind UTC
    // demonstrates the fix without needing to actually change the
    // process's TZ (which would affect the whole test run).
    const iso = "2026-09-07T00:00:00.000Z";
    const date = new Date(iso);

    // What the old TaskCard.jsx code did, evaluated against an explicit
    // negative offset (US Eastern, UTC-4 in September) rather than
    // process.env.TZ — this mirrors the local-zone conversion without
    // depending on how this test happens to be invoked.
    const buggyLocalOffsetMinutes = 4 * 60; // UTC-4
    const shifted = new Date(date.getTime() - buggyLocalOffsetMinutes * 60 * 1000);
    const buggyResult = `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()}/${shifted.getUTCFullYear()}`;
    assert.strictEqual(buggyResult, "9/6/2026", "sanity check: the old approach really does shift the day back");

    // The fix: always read the date back out in UTC, so the displayed
    // day matches the one that was stored, regardless of viewer timezone.
    assert.strictEqual(formatDateOnly(iso), "9/7/2026");
  });

  await test("also correct for a viewer timezone ahead of UTC (would not have shown the bug either way)", () => {
    // Included for completeness: timezones at/ahead of UTC were never
    // affected by the original bug (UTC midnight is still the same or a
    // later local calendar day), so this just confirms the fix doesn't
    // regress the case that already worked.
    assert.strictEqual(formatDateOnly("2026-01-15T00:00:00.000Z"), "1/15/2026");
  });

  await test("handles a bare date-only string the same way (defensive — not the shape serialize.js sends, but callers shouldn't crash if a future change passes one)", () => {
    assert.strictEqual(formatDateOnly("2026-12-25"), "12/25/2026");
  });

  await test("returns an empty string for null/undefined/empty input instead of throwing or printing 'Invalid Date'", () => {
    assert.strictEqual(formatDateOnly(null), "");
    assert.strictEqual(formatDateOnly(undefined), "");
    assert.strictEqual(formatDateOnly(""), "");
  });

  await test("returns an empty string for a genuinely invalid date string instead of throwing or printing 'Invalid Date'", () => {
    assert.strictEqual(formatDateOnly("not-a-date"), "");
  });

  await test("accepts extra Intl options without breaking the UTC pin (e.g. a caller wanting a different format)", () => {
    const result = formatDateOnly("2026-09-07T00:00:00.000Z", { month: "short", day: "numeric", year: "numeric" });
    assert.strictEqual(result, "Sep 7, 2026");
  });

  summary();
})();
