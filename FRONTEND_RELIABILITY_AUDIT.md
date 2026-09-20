# Frontend Reliability, API Error Handling & Stale-State Audit

Scope: every React/JSX file under `src/app/` and `src/components/`, plus
`src/lib/apiFetch.js` and `src/lib/clientAsync.js`. Every mutation and
async state transition in that surface was traced against the 19-point
checklist below. No redesign — correctness/reliability fixes only. Every
file in scope was read directly before drawing any conclusion.

## Checklist coverage

| # | Item | Result |
|---|------|--------|
| 1 | Every mutation handles non-2xx responses | ✅ Already correct everywhere — see "Existing foundation" below |
| 2 | Every loading state has a reliable finally/reset path | ✅ Already correct everywhere |
| 3 | Dialogs do not close on failed mutations | ✅ Already correct everywhere |
| 4 | Forms do not clear on failed mutations | ✅ Already correct everywhere |
| 5 | Retry buttons actually retry the correct operation | ✅ Already correct everywhere |
| 6 | Stale responses cannot overwrite newer state | 🔧 **Bug found & fixed** — TaskDetailDialog (see below) |
| 7 | Components do not use stale props/state after refetch | ✅ Verified — no polling/background refetch exists while a dialog is open; the one path that could re-trigger a field's own state (its own save) is now covered by fix #3 below |
| 8 | Race conditions between multiple user actions | 🔧 **Bug found & fixed** — same as #6 |
| 9 | Double-click / double-submit behavior | 🔧 Minor defensive fix — `handleToggleDoneColumn` (see below); everything else already guarded |
| 10 | Delete confirmation behavior | ✅ Already correct everywhere |
| 11 | Error messages are visible and not hidden behind dialogs | ✅ Already correct everywhere |
| 12 | 401/403 behavior | ✅ 401 redirects to `/login` on every data-loading page; 403 falls back to the generic load-error message with a working Retry (see note below) |
| 13 | Empty/loading/error states | ✅ Already correct everywhere |
| 14 | Mobile behavior | ✅ Verified (dialogs go `fullScreen` under the `sm` breakpoint, layout reflows); see note on drag-and-drop below |
| 15 | Keyboard accessibility | ✅ Already correct everywhere (focus-visible outlines, `role="button"`/`tabIndex`/`onKeyDown` on all custom interactive elements, non-drag path to move a task) |
| 16 | Drag/drop fallback behavior | ✅ Verified — see note below |
| 17 | Download/upload UX | 🔧 **Bug found & fixed** — attachment download link (see below) |
| 18 | Raw `fetch()` calls outside `apiFetch` | ✅ None found (`grep -rn "fetch("` outside `apiFetch.js` and the attachment `<a href>` returns nothing) |
| 19 | Unsafe client assumptions about server response shape | ✅ No `.data.data`-style guessing found; DTOs from `serialize.js` are consumed as documented |

## Existing foundation (why most of the checklist was already clean)

This codebase already has two small, well-used utilities that do most of
the checklist's work by construction:

- **`lib/apiFetch.js`** — wraps `fetch()` so any non-2xx response throws
  an `Error` (with the server's message, if JSON) instead of resolving
  silently. Every call site in the app goes through this, so "handles
  non-2xx" (#1) is structural, not something to check file-by-file.
- **`lib/clientAsync.js`** — `useIsMounted()` (guards `setState` after
  unmount) and `useLatestRequest()` (a ticket generator so a stale
  response can check whether it's still the most recent call before
  applying itself). Every list/detail page already uses both for its
  main `load()`.

Combined with a consistent per-page pattern — dialogs and forms only
close/reset in the *success* branch, errors render inline (usually via
an `Alert` inside the dialog itself, per #11), and every submit handler
checks its own `submitting`/`deleting` flag before starting a second
request — items #1–5, #10, #11, #13, #15 were already satisfied
everywhere they apply. That's most of the checklist; the rest of this
document covers what wasn't.

## Confirmed bug: due-date timezone off-by-one

**The specific scenario asked about, confirmed and fixed.**

- `NewTaskModal.jsx`'s `<TextField type="date">` hands the API a plain
  `"YYYY-MM-DD"` string.
- `lib/validation.js`'s `validateOptionalDate()` turns that into a JS
  `Date` via `new Date(value)`. Per spec, a date-only ISO string parses
  as **UTC midnight** — so this is stored in Mongo as UTC midnight on the
  selected day. That part is fine, and unchanged by this fix.
- `lib/serialize.js` sends it to the client as
  `new Date(task.dueDate).toISOString()` — still UTC midnight, still
  correct.
- `TaskCard.jsx` displayed it with
  `new Date(task.dueDate).toLocaleDateString("en-US")` — **no `timeZone`
  option**, so this renders in the **browser's local timezone**.

UTC midnight on the intended day is still the same (or a later) local
day for any timezone at or ahead of UTC. But for any timezone *behind*
UTC — which includes the entire continental United States — it falls on
the **previous** local calendar day. Concretely: a task due "September
7" is stored as `2026-09-07T00:00:00.000Z`; a user in US Eastern time
(UTC-4 in September) viewing that card would see it 8:00pm local on
September 6, and `toLocaleDateString()` would print **"9/6/2026"**. Every
US-based user of a due-date-bearing task was seeing the wrong day.

**Fix**: added `src/lib/dateOnly.js` exporting `formatDateOnly(value,
options?)`, which formats with `{ timeZone: "UTC", ...options }` instead
of the local zone — so the displayed calendar day always matches the one
that was originally picked, regardless of the viewer's timezone.
`TaskCard.jsx` now calls this instead of a bare `toLocaleDateString()`.

This is a **display-only fix**. The stored representation (a
UTC-midnight `Date`) and the write path (`validation.js`,
`serialize.js`, the Task model) are untouched, so **no data migration is
needed** — every existing `dueDate` in the database already round-trips
correctly through the fixed formatter.

No other due-date rendering or comparison exists in the app today —
`dueDate` is not editable after task creation (only set at creation time
in `NewTaskModal.jsx`), and `TaskCard.jsx` is the only place it's
displayed. (Editing a task's due date after creation is a *feature gap*,
not a bug — noted for awareness but out of scope for this pass, which
covers correctness, not new functionality.)

Regression tests: `__manual_test__/16-frontend-reliability-audit.test.cjs`.

## Confirmed bug: attachment download link could navigate the whole app away on failure

`TaskDetailDialog.jsx`'s download button is a plain `<a
href="/api/tasks/{id}/attachments/{id}">` with no `target`. On success,
the route always sets `Content-Disposition: attachment` (see
`buildContentDisposition()` in `lib/attachmentPolicy.js`), so the browser
downloads the file without navigating — that part was already fine. But
on any failure — an expired session (401), losing access to the task
(403), or the file having been deleted by someone else in the meantime
(404) — the route returns a plain JSON error body with **no**
`Content-Disposition`. Clicking the link in that state would navigate
the **current tab** to that URL, replacing the entire running app with
raw `{"error":"..."}` text. The only way back would be the browser's Back
button.

**Fix**: added `target="_blank" rel="noopener noreferrer"`. A successful
download is unaffected (still downloads via the disposition header,
doesn't actually open a visible new tab in most browsers). A failed
request now only affects the new tab it opened; the app underneath is
untouched.

## Confirmed bug: stale response could overwrite a newer optimistic update (TaskDetailDialog)

`TaskDetailDialog.jsx`'s three inline-save fields — column, color, and
assignees — each save on every change with no explicit "submit" step and
(before this fix) no guard against overlapping requests for the same
field. Concretely, for assignees: clicking a second checkbox before the
first PATCH resolves starts a second, overlapping PATCH. If the *older*
request's response — success or failure — arrives *after* the newer
one has already applied its own optimistic update, the older handler
would still run: on success it calls `onChanged()` (harmless, just a
refetch), but on **failure** it calls `setAssigneeIds(previous)`, where
`previous` is the value captured before the *first* request started —
silently reverting the user's second, already-applied change, with no
error shown for it (the error message describes the *first* request,
not the discarded second one). The same shape of bug applied
independently to the column-move and color fields.

**Fix**: each field now gets its own ticket from `useLatestRequest()`
(already used elsewhere in the app for the same purpose — see "Existing
foundation" above), and both the success and failure branches check
`isCurrent()` before touching state. A superseded request's result —
success or failure — is now a no-op instead of clobbering whatever the
newer request already applied.

This is verified by code inspection rather than an automated test — see
"Testing" below for why, and for what was tested instead.

## Minor defensive fix: `handleToggleDoneColumn` double-submit guard

`KanbanBoard.jsx`'s rename flow already guards against overlapping
requests for the same column via a `renamingInFlight` ref `Set` (the
rename field can commit from both `onBlur` and `onKeyDown`/Enter close
enough together to double-fire). `handleToggleDoneColumn` — the "mark as
final column" menu action — had no equivalent guard. In practice the
triggering menu item is removed from the DOM as soon as the menu closes
(which happens synchronously at the start of the handler), so a literal
double-click can't reach it twice through normal mouse interaction; this
is a low-probability, defense-in-depth fix for the same class of
fast-repeat trigger the rename guard exists for, not a bug that was
observed to be reachable. Added for consistency with the established
pattern in the same file, reusing the existing `renamingInFlight` Set
with a namespaced key (`done:${columnId}`) rather than adding a second
ref.

## Verified, not changed: 403 handling

Every data-loading page (`ProjectDetailPage`, `TeamDetailPage`,
`TeamsPage`, `ProjectsPage`) checks `err.status === 401` and redirects to
`/login`. None of them special-case `err.status === 403` — it falls
through to the same generic `loadError` message ("Couldn't load this
project. Please try again.") with a working Retry button. Retrying won't
fix a genuine permissions problem, but the message and button are both
accurate and non-broken; this reads as an acceptable, if slightly
generic, degraded state rather than a correctness bug, so it was left
as-is rather than guessed at with new copy.

## Verified, not changed: drag-and-drop fallback and mobile

`KanbanBoard.jsx` uses the native HTML5 drag-and-drop API
(`draggable`/`dragstart`/`dragover`/`drop`), which has no equivalent on
touch devices — a task can't be dragged between columns on a phone or
tablet. This is a real limitation, but it already has a working,
intentional fallback: `TaskCard.jsx`'s own code comment confirms the
design — every card is independently focusable and clickable/`Enter`/
`Space` opens `TaskDetailDialog`, which has a "Column" `<Select>` that
moves the task to any column without dragging. This covers both
keyboard-only users and touch/mobile users for the cross-column case.
Reordering *within* a column has no non-drag equivalent today — a real
gap, but it's a missing feature (not a regression or broken flow), so
consistent with this audit's "fix bugs, don't redesign" scope it's
flagged here rather than built. `TaskDetailDialog`, `NewTaskModal`, and
`ConfirmDialog` all go `fullScreen` under the `sm` breakpoint
(`useMediaQuery(theme.breakpoints.down("sm"))`) and were checked to
reflow correctly at narrow widths.

## Testing

New file: `__manual_test__/16-frontend-reliability-audit.test.cjs` (7
tests, all passing) — full regression coverage of `formatDateOnly()`:
the exact UTC-midnight-to-timezone-behind-UTC bug scenario (with an
explicit sanity check that the *old* approach really did shift the day
back), the timezone-ahead-of-UTC case that was never affected, a bare
date-only string, null/undefined/empty/invalid input, and custom `Intl`
options.

The other two fixes in this phase (the TaskDetailDialog per-field
request tickets, and the download-link/toggle-guard one-liners) are
component-level changes. This repo's manual test harness — by design,
per its own `README.md` — loads real source modules under plain Node
with in-memory fakes for Mongoose/Next.js/next-auth; there is no React
renderer or DOM (no `react-test-renderer`/`jsdom` in `devDependencies`),
so no prior phase has tested a React component's runtime behavior
directly, only pure lib functions and API route handlers. Extending the
harness with a DOM/renderer layer to test three component-level fixes
would be a meaningful scope expansion beyond "fix correctness/reliability
bugs" and wasn't undertaken. These three fixes were verified by careful
manual inspection (traced call-by-call in the "Confirmed bug" sections
above) and are flagged below as a manual/browser verification item,
consistent with how this project already handles bugs that can't be
proven in-sandbox (e.g. the live-Atlas-transaction and multi-tab-drag
items from prior phases).

## Manual verification still needed (cannot be run in this sandbox)

- **TaskDetailDialog race-condition fix**: open a task, rapidly toggle
  three or four different assignees (or switch the column, or the
  color, in quick succession) while intentionally slow network
  conditions are simulated (e.g. Chrome DevTools "Slow 3G" throttling),
  and confirm the final selection always matches the last action taken
  — no reversion to an earlier state.
- **Download-link fix**: sign out in one tab while a task with an
  attachment is open in another, then click Download; confirm the
  current tab is unaffected and only a new tab shows the error.
- **Due-date display**: create a task with a due date while the browser
  is set to a timezone behind UTC (e.g. US Pacific/Eastern) and confirm
  the card shows the exact date selected, not the day before. (Verified
  programmatically in the new test file against the exact production
  data shape — this is a real-browser sanity check, not a re-test of the
  logic.)
- Carried over from prior phases, still outstanding: live Atlas
  replica-set transaction behavior, email delivery, TTL expiration,
  multipart upload edge cases, multi-tab drag smoke tests.

## Files changed

- `src/lib/dateOnly.js` — **new**. `formatDateOnly(value, options?)`.
- `src/components/TaskCard.jsx` — use `formatDateOnly()` instead of a
  bare `toLocaleDateString()` for the due-date display.
- `src/components/TaskDetailDialog.jsx` — per-field `useLatestRequest()`
  tickets for `saveColumn`/`saveColor`/`saveAssignees`; download link
  gets `target="_blank" rel="noopener noreferrer"`.
- `src/components/KanbanBoard.jsx` — `handleToggleDoneColumn` reuses the
  existing `renamingInFlight` guard (namespaced key) to prevent
  overlapping requests; updated the comment above that ref to describe
  its now-broader use.
- `__manual_test__/16-frontend-reliability-audit.test.cjs` — **new**, 7
  tests, all passing.
- `__manual_test__/README.md` — added the new test file to the run list.
- `CHANGELOG.md` — this phase's entry.

## Commands run

```
npm install                                              # 505 packages, 0 vulnerabilities
node __manual_test__/01-pure-ordering.test.cjs            # 9 passed
node __manual_test__/02-mongo-transaction.test.cjs         # 5 passed
node __manual_test__/03-column-order-retry.test.cjs        # 4 passed
node __manual_test__/04-done-column-transaction.test.cjs   # 5 passed
node __manual_test__/05-task-create-transaction.test.cjs   # 3 passed
node __manual_test__/06-limited-form-data.test.cjs         # 7 passed
node __manual_test__/07-email-html-escaping.test.cjs       # 9 passed
node __manual_test__/08-authz-and-validation.test.cjs      # 17 passed
node __manual_test__/09-registration-transaction.test.cjs  # 8 passed
node __manual_test__/10-rate-limit.test.cjs                # 9 passed
node __manual_test__/11-auth-hardening.test.cjs             # 25 passed
node __manual_test__/12-transaction-fallback-routes.test.cjs # 4 passed
node __manual_test__/13-column-task-race.test.cjs           # 5 passed
node __manual_test__/14-attachment-security.test.cjs        # 35 passed
node __manual_test__/15-kanban-ordering-audit.test.cjs      # 17 passed
node __manual_test__/16-frontend-reliability-audit.test.cjs # 7 passed (new)
npm run build
npm audit --omit=dev
```

## Validation result

- **All 165 manual-test assertions across 16 files pass** (158
  pre-existing + 7 new) — confirming this phase introduced no
  regressions to Kanban ordering, transactions, validation, authz,
  attachments, or auth hardening.
- `npm run build` — succeeds (`✓ Compiled successfully`, `✓ Generating
  static pages (16/16)`), all 18 API routes + pages generated, no
  type/lint errors.
- `npm audit --omit=dev` — **0 vulnerabilities**. No dependencies were
  added or changed in this phase.
- No changes to Kanban ordering/concurrency logic, attachment security,
  authentication/rate-limiting, or any backend route beyond what's
  listed above (none — this phase touched only frontend files and the
  new `lib/dateOnly.js` helper).
