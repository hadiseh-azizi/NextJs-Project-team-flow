# Add .py (Python) Attachment Support

Scope: adds `.py` to the task-attachment allowlist only. No UI redesign,
no new attachment feature, no other extension added, no size-limit or
schema changes.

**Findings going in.** Attachments only have one code path: they're added
via `POST /api/tasks/[id]/attachments` from `TaskDetailDialog.jsx`, which
requires an existing task id — there's no separate "attach while
creating" flow. `NewTaskModal.jsx` has no file input at all. The file
picker (`<input type="file" hidden>` in `TaskDetailDialog.jsx`) already
has no `accept` restriction, so the browser lets any file be selected;
all type enforcement is server-side in `lib/attachmentPolicy.js`, and the
allowed-types summary shown in the UI is generated from that same file. So
"attachable when creating a new task" and "after creation" are the same
code path in this app — once a task exists (immediately after creation,
the detail view is how attachments are added at all), `.py` support here
covers both.

**Added.**
- `lib/attachmentPolicy.js` — `.py` added to `ALLOWED_TYPES`, paired with
  three MIME values browsers are known to send for it: `text/x-python`,
  the generic `text/plain` fallback, and `""` (most OSes have no
  registered MIME mapping for `.py` at all, so browsers send an empty
  `file.type`). Each pairs *only* with the `.py` extension, so this
  doesn't loosen validation for any other extension — an empty MIME type
  with, say, a `.exe` name is still rejected. `.py` has no magic-byte
  signature (it's plain text), so it reuses the same "no NUL bytes"
  heuristic already used for `.txt`/`.csv`, run against the actual file
  bytes exactly like every other type. `ALLOWED_TYPES_SUMMARY` (the
  string shown in the upload UI and in error messages) now mentions
  "Python (.py)".
- `__manual_test__/14-attachment-security.test.cjs` — six new cases:
  accepting `.py` under each of the three MIME variants above, rejecting
  a binary file renamed to `.py` (magic-byte/text heuristic still
  applies), rejecting a `.py.exe` double extension, and confirming an
  empty MIME type doesn't accidentally widen acceptance to non-`.py`
  extensions.

**Not changed.** Every other allowed extension, `MAX_FILE_SIZE`,
`MAX_TOTAL_ATTACHMENTS_SIZE`, `MAX_ATTACHMENTS_PER_TASK`, the
magic-byte/extension/MIME cross-check for existing types, the upload
route's limits/race handling, the download route (still always forces
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`,
so a `.py` file is downloaded, never rendered or executed, exactly like
every other attachment), `Task.js`'s attachment schema, the file picker's
markup, `TaskCard.jsx`'s attachment display, auth/authorization, or
anything Kanban/theme/chart-related.

**Validation.** `npm audit` (0 vulnerabilities), `npm run lint` (clean),
`npm run build` (clean), and the full manual test suite including the
6 new and 35 pre-existing attachment-security cases — 216 passed, 0
failed across all 22 test files.

# Rename Projects, Tasks, Teams, and Columns

Scope: adds rename/edit-name support for the four requested entities. No
redesign, no auth/schema changes beyond what renaming itself needed, no
unrelated files touched.

**Findings going in.** Two of the four rename paths already existed:
column rename (`PATCH /api/projects/[id]/columns/[columnId]`, with a
click-to-edit `TextField` already wired up in `KanbanBoard.jsx`) and task
title rename at the API layer (`PATCH /api/tasks/[id]` already accepted
`title`) — only its UI was missing. Project and team rename had neither
an endpoint nor a UI.

**Added.**
- `PATCH /api/projects/[id]` — renames a project. Manager-only (same bar
  as `DELETE` on this route); validates via the existing
  `validateRequiredString` (empty/whitespace-only rejected, 150-char
  cap); returns the full `toProjectDTO()` payload so the caller can
  update its state directly from the response, no extra reload.
- `PATCH /api/teams/[id]` — renames a team. Manager-only via the existing
  `isTeamManager()` helper; same validation approach (100-char cap);
  returns the full `toTeamDTO()` payload.
- `src/components/RenameDialog.jsx` — a small reusable dialog (label,
  value, Save/Cancel, loading + error states), built the same way
  `ConfirmDialog.jsx` already is. Used by the project and team detail
  pages via a "Rename" action in `PageHeader`'s existing `actions` slot
  (manager-only), next to "Delete project" / member management.
- Task title: `TaskDetailDialog.jsx`'s title is now click-to-edit inline
  (mirrors the existing column-rename interaction in `KanbanBoard.jsx`
  exactly — click text, `TextField`, save on blur/Enter, `Escape`
  cancels), rather than a dialog, since it's already inside a dialog. No
  new authorization: task edits already run through the same
  `getTaskAccess()` every other field in this dialog uses.
- `__manual_test__/22-rename-entities.test.cjs` — route-level coverage
  for the two new endpoints (401/403/400/200, and that a denied or
  invalid request never reaches a database write), plus a same-shape
  regression check that the pre-existing task-title and column-name
  rename paths still reject a whitespace-only name.

**Not changed.** Database schemas (`name`/`title` fields already
existed), authentication, existing authorization rules (renaming reuses
`authz.js`'s existing manager checks — project/team rename sit at the
same authorization bar as project delete / team management, nothing
weakened or widened), the theme system, and column `isDoneColumn`
behavior (a name-only `$set` never touches it; order and task membership
are untouched by any of the four rename paths).

**Verified.** `npm install` (a pre-existing `package-lock.json` /
`package.json` mismatch — unrelated to this change — meant `npm ci`
couldn't run as-is; `npm install` resolved the same dependency tree
cleanly, 0 vulnerabilities), `npm run lint` (clean), `npm run build`
(succeeds), full manual suite (22 files, all passing, including the new
one). Not independently re-verified: live MongoDB Atlas persistence (see
this project's standing sandbox limitations, above) and interactive
browser verification of the new inline-edit/dialog UI.

# Dashboard Chart Fix - Recharts / React 19 Incompatibility

Scope: dependency fix for the Dashboard "Project progress" chart only
(`package.json`, `package-lock.json`). No source, layout, styling, theme,
routing, auth, API or data-logic changes.

**Root cause.** Next.js 15's App Router does not use the `react` package in
`node_modules` (18.3.1); it runs its own vendored React 19 canary. Recharts
2.12.7 only supports React <= 18 and depends on `react-is@16`, which does
not recognise React 19 elements (`Symbol(react.transitional.element)`).
`ResponsiveContainer` filters its children with `isElement()`, so it never
passed a width/height to `BarChart`; `BarChart` returned `null` and the
container rendered empty, with no console error. A second React 19
incompatibility sat behind it: the React 19 JSX runtime no longer merges
`defaultProps` into elements, so `Bar`'s `minPointSize` (and `XAxis`'s
`xAxisId`/`type`) were `undefined` - the source of
`TypeError: minPointSize is not a function` when a Bar is rendered under
React 19.

**Correction to the previous entry ("Dashboard Chart Hardening").** That
entry concluded the chart "rendered correctly with well-formed data". That
was true only under React 18 in jsdom, which is not the runtime the app
uses under Next 15. The data path it traced (queries -> `toProjectDTO()` ->
`ProgressChart`) was and remains correct; the defect was in the rendering
layer. The earlier entry is left as written.

**Change.**
- `recharts` `2.12.7` -> `2.15.4` (exact pin; still Recharts 2.x, same API,
  no chart code touched). 2.15.x declares React 19 support.
- `overrides`: added `"recharts": { "react-is": "19.2.8" }`, scoped to
  Recharts' own dependency so it recognises React 19 elements. Every other
  package keeps its existing `react-is` copy.

**Verified now.** `npm ci` (clean), `npm audit` (0 vulnerabilities),
`npm run lint` (clean), `npm run build` (succeeds), full manual suite
(20 files, 201 passed, 0 failed). In real headless Chromium against both a
`next build`/`next start` production build (SSR + hydration) and `next dev`
(StrictMode), using the real `toProjectDTO`, theme and components: with data
the chart renders bars of the correct heights (75% / 25% / 100%), light and
dark mode colours are correct including a live switch on a mounted chart,
tooltip shows the value, empty project list shows the existing empty state,
a 375px viewport reflows, and the console is clean. Before the fix, the same
production build rendered an empty chart container.

**Not verifiable in the sandbox.** A live-Atlas load of the real
`/dashboard` route (needs MongoDB + a session): verification used an
identical JSX tree fed by the real `toProjectDTO()` with generated data, in
a throwaway route that is not part of this release. Google Fonts were
blocked in the sandbox, so fallback fonts were used.

**Observed, not changed (out of scope).**
- In dark mode the `h4` "Overview" heading computed to the light-mode ink
  colour (`rgb(30,27,22)`) in the test build while `h5`/`h6` were correct.
  Not caused by this change; worth checking separately.
- On very narrow screens Recharts hides some x-axis labels to avoid overlap.

# Dashboard Chart Hardening

Scope: `ProgressChart` only (`src/components/ProgressChart.jsx`). No
layout, styling, theme, routing, auth, API or Recharts changes.

**Finding.** The dashboard's data path (Mongoose queries in
`dashboard/page.jsx` → `toProjectDTO()` → `ProgressChart`) was traced
end to end and the field names and aggregation are consistent: the
chart reads `columns[].id`/`isDoneColumn` and `tasks[].columnId`, which
is exactly what `toColumnDTO()`/`toTaskDTO()` emit, and progress is
computed from real task/column data. With well-formed data the chart
rendered correctly. The one confirmed defect: `ProgressChart` threw a
`TypeError` during render if `projects` was missing, or any project
lacked `tasks`, `columns` or `name`. Because it is a client component
that crash takes down the whole dashboard, not just the chart.

**Change.** The chart-data mapping now treats a missing `projects`
prop, non-array `tasks`/`columns`, or a missing `name` as "none" (the
name falls back to "Untitled"). Output for well-formed data is
unchanged. No data is invented: a project with no tasks still plots 0%,
and an empty project list still shows the existing empty-state message.

**Verified now:** `npm run lint` (clean), `npm audit` (0
vulnerabilities), `npm run build` (succeeds, run with placeholder env
vars), and the full manual suite (20 files, 0 failed). The component
itself was exercised with an out-of-tree jsdom harness (not shipped;
this repo has no DOM test tooling, see `__manual_test__/README.md`):
valid data, empty list, project with no tasks, no done column flagged,
missing optional fields, and missing `projects` prop, each in light and
dark mode, plus a live light-to-dark switch on a mounted chart.

**Not verifiable in the sandbox:** a real browser render (ResponsiveContainer
sizing against the actual layout) and a live-Atlas dashboard load.

# Final Security Patch — Nodemailer 9.1.1

Scope: dependency-only security patch. Updated `nodemailer` from `9.0.5`
to `9.1.1` (both the direct `dependencies` entry and the `overrides`
pin in `package.json`) to resolve three published advisories against
`9.0.5`:

- **GHSA-2x7j-588g-ccc2** (high, CVSS 7.5) — quadratic-time
  `addressparser` parsing allows a remote denial-of-service via a
  crafted address list. Fixed in 9.1.0.
- **GHSA-wmmp-3585-3rmp** (moderate, CVSS 6.5) — IDN/punycode
  domain allow-list bypass could route mail to an attacker-controlled
  domain. Fixed in 9.1.0.
- **GHSA-8m3c-c648-2xjj** (moderate, CVSS 5.9) — `resolveContent()`
  on a `MailMessage` could bypass `disableFileAccess`/
  `disableUrlAccess` when called with the legacy signature. Fixed in
  9.1.1 — this is why 9.1.1 was chosen over 9.1.0, since this
  advisory's range is `<=9.1.0`.

`package-lock.json` updated to match (`node_modules/nodemailer`
version/resolved/integrity only — no other package touched). No
changes to `src/lib/email.js`: the file's `createTransport()`/
`sendMail()` usage was already compatible with 9.1.1's API, confirmed
by both the existing `07-email-html-escaping.test.cjs` suite and a new
`20-nodemailer-version-regression.test.cjs`, which exercises the real
(unstubbed) `createTransport()`/`sendMail()` surface from the newly
installed package instead of a mock.

**Verified now:** `npm ci`, `npm audit` (0 vulnerabilities, was 1
high/2 moderate before the bump), `npm audit --omit=dev` (0
vulnerabilities), `npm ls nodemailer` (single resolved version,
9.1.1, no duplicates), `npm run lint` (clean), `npm run build`
(succeeds), and the full manual test suite — 201 passed, 0 failed
across 20 files. See `FINAL_SECURITY_PATCH.md` for the full report.

# Final Release Cleanup

Scope: IP-based rate-limit trust/deployment safety, invitation-email
abuse protection, and test-documentation consistency — see
`FINAL_RELEASE_CLEANUP.md` for the full writeup, security-decision
rationale, and verification results. No unrelated refactoring, no
framework migration, no dependency upgrades.

## 1. IP rate-limit trust is now an explicit, documented decision

`src/lib/clientIp.js` previously trusted `x-forwarded-for` /
`x-real-ip` unconditionally. This app's documented deployment target
(README.md) is Vercel with no customer-supplied reverse proxy in
front of it — on that specific shape, Vercel's edge network itself
overwrites `x-forwarded-for` and does not forward a client-supplied
value (confirmed against Vercel's own docs), so trusting it there is
correct. That assumption does not hold for every environment this
code could run in (self-hosted, a bare `next start`, a misconfigured
reverse proxy), so trust is now gated behind an explicit
`RATE_LIMIT_TRUST_PROXY` environment variable (`vercel` by default,
matching the documented target; `none` disables IP trust). Also added:
basic IPv4/IPv6 shape validation, so a malformed or garbage
`x-forwarded-for` value is treated as `unknown` instead of becoming a
rate-limit document key verbatim.

**Fixed a related silent-disable gap:** `POST /api/auth/register`'s
rate limit is IP-only (no other identity exists pre-account-creation).
Previously, an unknown IP simply skipped the check — meaning a
deployment with IP trust correctly disabled (`RATE_LIMIT_TRUST_PROXY=none`)
would have had **no registration rate limiting at all**. It now falls
back to one shared bucket (`REGISTER_FALLBACK_LIMIT`, 100/hour) in that
case, so the endpoint is never fully unprotected. Login and
resend-verification were not affected by this gap — both already
combine IP with a non-IP identity (email), so an untrusted IP there
just drops the secondary check, not the only one.

**Fail-open behavior in `rateLimit.js` reviewed, kept as-is.** A
transient DB error still fails open (does not block the request) — see
the existing header comment there for the reasoning (a broken limiter
degrading to "no extra protection" rather than taking down
login/registration/resend outright). This was an explicit decision for
this phase, not an oversight; see FINAL_RELEASE_CLEANUP.md.

## 2. Invitation-email rate limiting (new)

`POST /api/teams/[id]/members` could previously send unlimited
invitation emails once authorized as a team manager — no abuse
protection at all, unlike every auth endpoint. Added three combined
rate-limit identities, checked only on the "no account yet, send an
email" branch (adding an already-registered user sends no email and is
unaffected):

- per-manager: 30/hour, across any team they manage
- per-team: 30/hour, regardless of who's inviting
- per-IP: 60/hour, a looser defense-in-depth net (subject to the same
  trust boundary as `clientIp.js` above)

Authorization (team-manager check) still runs first and is unchanged;
rate limiting never substitutes for it. Existing invitation business
logic — the (email, team) uniqueness check, the 409 on a live
duplicate, invitation TTL/expiry, and acceptance-on-registration — is
untouched.

## 3. Test documentation corrected

`__manual_test__/README.md`'s run list stopped at
`16-frontend-reliability-audit.test.cjs`, even though
`17-api-validation-audit.test.cjs` has existed (and passed) since the
API Validation Audit phase — confirmed against the actual filesystem,
not just the prior audit report's claim. Added the missing entry, plus
this phase's two new test files, with descriptions.

## Verification

- `npm ci` — clean install, lockfile matches `package.json`.
- `npm audit` — 2 findings (1 moderate, 1 high) in `nodemailer`
  (`sendTeamInviteEmail()` / `sendVerificationEmail()` in
  `src/lib/email.js` do use it directly for real mail delivery — not a
  dead/unused transitive dependency). Reviewed against this phase's
  actual scope (invitation *volume/frequency* abuse, not address
  parsing) and judged not to directly affect it — see "Out of Scope
  Findings" in FINAL_RELEASE_CLEANUP.md for the specific reasoning per
  advisory. Left unfixed here per this phase's explicit "no dependency
  upgrades unless required for the three tasks" boundary; recommended
  as a follow-up dependency-security phase.
- `npm run lint` — clean, 0 warnings.
- `npm run build` — compiles and prerenders cleanly given the
  documented required env vars (`MONGODB_URI`, `NEXTAUTH_SECRET`,
  `NEXTAUTH_URL` — see README.md's "npm run build" note from a prior
  phase; this is pre-existing, expected behavior, not a regression).
- All 19 files under `__manual_test__/` individually via `node`: **198
  assertions, 0 failures** (180 carried over from before this phase,
  plus 18 new for IP-trust hardening and invitation rate limiting).

As with every prior phase: live-MongoDB-replica-set scenarios (real
concurrent `findOneAndUpdate` on `RateLimitAttempt`, TTL sweep timing,
real SMTP delivery of invitation emails) remain **NOT EXECUTED — real
MongoDB/SMTP required**, consistent with this sandbox having no network
access to either. See FINAL_RELEASE_CLEANUP.md's manual test matrix.

---



Cross-system verification pass across the entire cumulative codebase
(all prior phases through the dependency/build/lint audit). No new
features, no UI redesign, no speculative refactoring — verification
plus one documentation fix.

**Verified in this phase (all against actual source, not prior audit
claims):** authentication, email verification, registration,
invitations, team/project/task/assignee/attachment authorization,
input validation, MongoDB data integrity, transactions, concurrency,
task/column ordering, the done-column invariant, frontend API
handling and loading/error states, date handling, responsive/a11y
carry-forward, dependency security, and documentation accuracy.

**Commands run:** `npm audit` (0 vulnerabilities), `npm run lint`
(clean, 0 warnings), `npm run build` (compiles cleanly, all 16 API
routes + 9 pages generated), `npm ci --dry-run` (lockfile is
consistent with `package.json`), and all 17 files under
`__manual_test__/` individually via `node` (180 assertions, 0
failures — includes `17-api-validation-audit.test.cjs`, which wasn't
listed in `__manual_test__/README.md`'s run list but does exist and
passes).

**Fixed: stale README claim about the UI color palette.** `README.md`
still described "a purple-to-rose gradient palette" with gradient
buttons — leftover from before the UI/accessibility hardening phase
that replaced it with the current flat, neutral, single-accent (ochre)
palette documented in `src/lib/theme.js`. Low severity (documentation
only, no code path affected), but explicitly in scope for this phase's
"documentation consistency" check. Reworded to describe the actual
current palette; no other README claims (page/route counts, HTTP
method counts, Node engines, build env-var requirement, Next.js 15
`params` migration) were found to be inaccurate against the source.

**No other issues found requiring a code change.** Full findings,
per-item verdicts, and the honest readiness verdict are in
`FINAL_AUDIT.md` (replaces the prior phase's version of that file).
Live-MongoDB-replica-set scenarios (TTL sweep, real concurrent
transactions, real SMTP delivery) remain **NOT EXECUTED — real
MongoDB required**, consistent with every prior phase; this sandbox
has no network access to a MongoDB server.

---

# Dependencies, Build, Lint & Production Readiness Audit

Scope: `package.json`, `package-lock.json`, `next.config.js`,
`jsconfig.json`, `README.md`, and source files as needed for
compatibility checks. No application features, routes, components, or
business logic changed. Full findings, exact versions, and command
output are in `PRODUCTION_READINESS_AUDIT.md`.

## Fixed: `npm run lint` was non-functional

The project used `next lint` (deprecated, removed in Next 16) with **no
ESLint config file at all** — running it dropped into an interactive
setup prompt that hangs in any non-interactive environment. Migrated to
plain `eslint .` with a flat-config `eslint.config.mjs`, bridging
`eslint-config-next@15.5.25`'s legacy (`extends`-based) config onto
ESLint 9 via `@eslint/eslintrc`'s `FlatCompat` — the standard pattern
for this exact combination, since `eslint-config-next` hasn't shipped a
native flat config yet. `npm run lint` now exits `0` with zero warnings
across the whole codebase, including `__manual_test__/`.

Added devDependencies: `eslint@9.39.5`, `eslint-config-next@15.5.25`
(exact match to the pinned Next.js version), `@eslint/eslintrc@3.3.7`.

## Dependency audit: mostly held, three safe patch bumps

Full package-by-package verdicts are in
`PRODUCTION_READINESS_AUDIT.md` §2. Summary: `next`, `react`/`react-dom`,
`next-auth`, `mongoose`, `nodemailer`, `bcryptjs`, `@mui/*`, and
`recharts` are all one or more **major** versions behind latest, but
none have an outstanding CVE (`npm audit`: 0 vulnerabilities before and
after), so per this project's SECURE + STABLE > NEWEST principle, all
were held rather than bumped blind. Confirmed `next@15.5.25` is already
the newest *stable* release in the 15.x line — Next 16 is a deliberate
non-migration, reasons documented in the audit report.

Bumped (same major version, no breaking changes, verified with a full
lint + build + 180-test regression pass): `@emotion/react` 11.13.0 →
11.14.0, `@emotion/styled` 11.13.0 → 11.14.1, `@emotion/cache` 11.13.0
→ 11.14.0.

## Build-time environment variable requirement documented

`npm run build` fails outright without `MONGODB_URI`, `NEXTAUTH_SECRET`,
and `NEXTAUTH_URL` set, because `src/lib/mongodb.js` throws at
module-evaluation time (not connection time), and Next's "Collecting
page data" build step evaluates every route module including
`/api/auth/[...nextauth]`. This is not new behavior and wasn't changed
in this phase (it's application code, outside this audit's scope) — it's
documented in the audit report and in the README as a build
requirement, since it wasn't written down anywhere before.

## Other changes

- `next.config.js`: added `poweredByHeader: false` (removes the
  `X-Powered-By: Next.js` response header — pure hardening, no
  behavioral change).
- `package.json`: added an `engines` field (`"node": "^18.18.0 ||
  ^19.8.0 || >=20.0.0"`), matching `next@15.5.25`'s own requirement, so
  installs fail fast with a clear message on an unsupported Node
  version.
- README: added a new section documenting the lint migration and the
  build-time environment variable requirement. No existing content was
  rewritten — the rest of the README (Next.js 15 `params` section,
  Vercel deploy steps, local setup) was re-checked against the current
  code and found accurate as written.

## Verified, not changed

- No hardcoded secrets found anywhere in `src/`.
- No `.env`/`.env.local` accidentally committed — only `.env.example`
  exists.
- No build artifacts (`.next/`, `out/`, `build/`) or source maps
  present in the repository or shipped in this phase's archive.
- `package-lock.json` is consistent (`npm ci` installs cleanly,
  regenerated after every dependency change in this phase).
- No `.gitignore` exists in the repository — flagged as a
  recommendation in the audit report, not added here since it's a
  repo-hygiene file rather than a dependency/build/lint concern.

# Frontend Reliability, API Error Handling & Stale-State Audit

Scope: every React/JSX file under `src/app/` and `src/components/`, plus
`src/lib/apiFetch.js` and `src/lib/clientAsync.js`, audited against a
19-point checklist covering mutation error handling, loading states,
dialog/form behavior on failure, retries, stale-response/race
conditions, double-submit, delete confirmation, 401/403, empty/loading/
error states, mobile, keyboard access, drag/drop fallback, upload/
download UX, raw `fetch()` usage, and response-shape assumptions. Also
specifically investigated date-only handling for the due-date field.
No redesign — correctness/reliability fixes only. Full findings are in
`FRONTEND_RELIABILITY_AUDIT.md`.

## Confirmed bug: due-date timezone off-by-one

`NewTaskModal.jsx`'s date input produces a `"YYYY-MM-DD"` string, which
`validation.js` parses via `new Date(value)` — per spec this becomes UTC
midnight on the selected day, and is stored and serialized that way
correctly. But `TaskCard.jsx` displayed it with a bare
`new Date(task.dueDate).toLocaleDateString("en-US")`, which renders in
the **browser's local timezone**. For any timezone behind UTC — all of
the continental US — UTC midnight falls on the *previous* local day, so
a task due "Sep 7" showed as "Sep 6" on its card.

**Fix**: added `src/lib/dateOnly.js` (`formatDateOnly()`, pinning
`timeZone: "UTC"` instead of the local zone) and switched `TaskCard.jsx`
to use it. Display-only fix — the stored UTC-midnight `Date` and the
write path are untouched, so no data migration is needed; every existing
`dueDate` already round-trips correctly through the fixed formatter. Due
dates are not editable after creation today, and `TaskCard.jsx` is the
only place one is displayed, so this was the only call site to fix.

## Confirmed bug: attachment download link could navigate the whole app away on failure

The download `<a href="/api/tasks/{id}/attachments/{id}">` had no
`target`. Success always sets `Content-Disposition: attachment`, so that
path was fine, but a 401/403/404 returns bare JSON with no disposition
header — clicking the link in that state navigated the **current tab**
to raw error text, replacing the entire running app.

**Fix**: added `target="_blank" rel="noopener noreferrer"` in
`TaskDetailDialog.jsx`. Successful downloads are unaffected; a failed
request now only affects the new tab it opened.

## Confirmed bug: stale response could overwrite a newer optimistic update

`TaskDetailDialog.jsx`'s inline-save fields (column, color, assignees)
each PATCH on every change with no submit step and, before this fix, no
guard against overlapping requests for the same field. If an older
request's failure handler ran *after* a newer request for the same field
had already applied its own optimistic update, it would revert the
field to the value from *before the older request started* — silently
discarding the newer, already-applied change, with no error shown for
it.

**Fix**: each of the three fields now gets its own ticket from the
existing `useLatestRequest()` hook (already used elsewhere in the app),
and both the success and failure branches check `isCurrent()` before
touching state. A superseded request's result is now a no-op instead of
clobbering a newer one.

## Minor defensive fix: double-submit guard on the "mark as final column" action

`handleToggleDoneColumn` in `KanbanBoard.jsx` had no in-flight guard,
unlike the adjacent rename flow's `renamingInFlight` ref `Set`. Not
observed to be reachable via a literal double-click (the triggering menu
item unmounts as soon as the menu closes, which happens synchronously at
the start of the handler) — added for consistency with the established
pattern, reusing the same `Set` with a namespaced key
(`done:${columnId}`).

## Verified, not changed

- **401/403**: every data-loading page redirects to `/login` on 401;
  403 falls through to the existing generic load-error message with a
  working Retry. Left as-is — accurate, if generic, rather than guessed
  at with new copy.
- **Drag-and-drop mobile fallback**: native HTML5 drag-and-drop doesn't
  work on touch devices, but every `TaskCard` is already keyboard-
  operable and opens `TaskDetailDialog`, whose "Column" `<Select>` moves
  a task between columns without dragging — covering both keyboard and
  mobile users for cross-column moves. Reordering *within* a column has
  no non-drag equivalent; this is a real feature gap, not a regression,
  so it's flagged in the audit doc rather than built (out of scope: "fix
  bugs, don't redesign").
- All other checklist items (mutation error handling, loading-state
  reset, dialogs/forms on failure, retry correctness, delete
  confirmation, visible error messages, empty/loading/error states,
  keyboard accessibility, no raw `fetch()` outside `apiFetch`, response-
  shape assumptions) were already correct everywhere — see
  `FRONTEND_RELIABILITY_AUDIT.md` for the full per-item trace of why.

## Files changed

- `src/lib/dateOnly.js` — new. `formatDateOnly(value, options?)`.
- `src/components/TaskCard.jsx` — use `formatDateOnly()` for the due-date display.
- `src/components/TaskDetailDialog.jsx` — per-field `useLatestRequest()` tickets; download link gets `target="_blank" rel="noopener noreferrer"`.
- `src/components/KanbanBoard.jsx` — `handleToggleDoneColumn` reuses the `renamingInFlight` guard (namespaced key); updated its comment.
- `__manual_test__/16-frontend-reliability-audit.test.cjs` — new, 7 tests.
- `__manual_test__/README.md` — added the new test file to the run list.
- `FRONTEND_RELIABILITY_AUDIT.md` — this phase's audit report.

## Tests added

`__manual_test__/16-frontend-reliability-audit.test.cjs` (7 tests) —
full regression coverage of `formatDateOnly()`: the exact
UTC-midnight-to-timezone-behind-UTC bug scenario (with an explicit
sanity check that the *old* approach really did shift the day back), the
timezone-ahead-of-UTC case that was never affected, a bare date-only
string, null/undefined/empty/invalid input, and custom `Intl` options.

The TaskDetailDialog request-ticket fix and the download-link/toggle-
guard one-liners are component-level changes; this repo's manual test
harness has no React renderer or DOM (see its own `README.md`), so no
prior phase has tested component runtime behavior directly, only pure
lib functions and API routes. These three were verified by manual code
inspection instead (traced call-by-call in `FRONTEND_RELIABILITY_AUDIT.md`)
and are listed there as a manual/browser verification item, consistent
with how this project already handles bugs that can't be proven
in-sandbox.

## Commands run

```
npm install                                                   # 505 packages, 0 vulnerabilities
node __manual_test__/01-pure-ordering.test.cjs                 # 9 passed
node __manual_test__/02-mongo-transaction.test.cjs              # 5 passed
node __manual_test__/03-column-order-retry.test.cjs             # 4 passed
node __manual_test__/04-done-column-transaction.test.cjs        # 5 passed
node __manual_test__/05-task-create-transaction.test.cjs        # 3 passed
node __manual_test__/06-limited-form-data.test.cjs              # 7 passed
node __manual_test__/07-email-html-escaping.test.cjs            # 9 passed
node __manual_test__/08-authz-and-validation.test.cjs           # 17 passed
node __manual_test__/09-registration-transaction.test.cjs       # 8 passed
node __manual_test__/10-rate-limit.test.cjs                     # 9 passed
node __manual_test__/11-auth-hardening.test.cjs                  # 25 passed
node __manual_test__/12-transaction-fallback-routes.test.cjs     # 4 passed
node __manual_test__/13-column-task-race.test.cjs                # 5 passed
node __manual_test__/14-attachment-security.test.cjs             # 35 passed
node __manual_test__/15-kanban-ordering-audit.test.cjs           # 17 passed
node __manual_test__/16-frontend-reliability-audit.test.cjs      # 7 passed (new)
npm run build
npm audit --omit=dev
```

## Validation result

- **All 165 manual-test assertions across 16 files pass** (158
  pre-existing + 7 new), including the full pre-existing suite from
  every prior phase — confirming this phase introduced no regressions to
  Kanban ordering, transactions, validation, authz, attachments, or auth
  hardening.
- `npm run build` — succeeds (`✓ Compiled successfully`,
  `✓ Generating static pages (16/16)`), no type/lint errors.
- `npm audit --omit=dev` — **0 vulnerabilities**. No dependencies added
  or changed.
- No changes to Kanban ordering/concurrency logic, attachment security,
  authentication/rate-limiting, or any backend route — this phase
  touched only frontend components and the new `lib/dateOnly.js` helper.

## Remaining limitations

- The TaskDetailDialog race-condition fix, the download-link fix, and
  the due-date display fix should each get a quick real-browser smoke
  test (steps in `FRONTEND_RELIABILITY_AUDIT.md`) before being
  considered fully verified — this sandbox has no browser to run them
  in.
- Carried over from prior phases, still outstanding: live Atlas
  replica-set transaction behavior, email delivery, TTL expiration,
  multipart upload edge cases, multi-tab drag smoke tests.

---

# Kanban Task/Column Ordering, Drag-and-Drop & Concurrency Audit

Scope: `lib/taskOrdering.js`, `lib/taskOrderCompare.js`,
`lib/columnOrderCompare.js`, `api/tasks/route.js`,
`api/tasks/[id]/route.js`, `api/projects/[id]/columns/route.js`,
`api/projects/[id]/columns/[columnId]/route.js`, `KanbanBoard.jsx`,
`TaskCard.jsx`, and their tests — 18 scenarios covering new-task
ordering, within-column and cross-column moves, rebalancing, and
concurrent creates/moves. No authentication, attachment, or unrelated UI
changes. Every file in scope was read directly before any change. Full
findings are in KANBAN_ORDERING_AUDIT.md.

## Confirmed UI bug: drop indicator got stuck on the last-hovered card

`KanbanBoard.jsx`'s `handleColumnDragOver` — fired while dragging over a
column's empty background — special-cased its own state update to keep
whatever `dropTarget` was already set (`prev.taskId` truthy) instead of
resolving to `"end"`, whenever that previous target was in the same
column. Since a card's `onDragOver` stops propagation, the column's
handler only ever fires over genuinely empty space (gaps between cards,
below the last card) — so this branch didn't protect against anything
real; it just meant that once you'd dragged over any card in a column,
moving off it into empty space kept showing (and, on drop, used) that
card's position instead of updating to "append at the end", contradicting
the function's own comment. Confirmed by tracing the actual
dragover/stopPropagation event flow, not assumed from the code alone.

**Fix**: `handleColumnDragOver` now always resolves to `{ columnId,
position: "end" }` for genuine background hovers, only skipping the
`setState` call (for render-count hygiene) when the previous target was
already exactly that — never when it still points at a card.

## Confirmed logic bug: client no-op detection disagreed with the board's own render order under duplicate `order` values

`order` values are deliberately allowed to tie under concurrent writes
(see `lib/taskOrdering.js`'s documented trade-off) — `compareTasks()`
breaks such ties by `createdAt`, then `_id`, and that's the exact
comparator `colTasks` is sorted with for display. `handleDrop`'s "is this
already where the task sits" check, however, used a bare `t.order >
task.order` scan, which can't see that tie-break at all: with two
siblings tied on `order` with the moving task, every one of them counts
as "before" it regardless of where `compareTasks` would actually place
it, so the computed "current index" can land at completely the wrong
spot (demonstrated to land at the end of a column) even when the task is
plainly rendered in the middle of it. Depending on the drop target, this
either silently swallows a real move or fires an unneeded one.

**Fix**: extracted a new shared, tested helper — `currentSiblingIndex()`
in `lib/taskOrderCompare.js` — that finds the task's current index using
the exact same `compareTasks` ordering, and pointed `handleDrop` at it
instead of the bare comparison. This doesn't touch the ordering algorithm
itself (`computeMovePlan`/`ORDER_STEP` are unchanged); it only fixes what
the client considers a no-op.

## Everything else in the 18-scenario checklist was already correct

Read and traced directly, not assumed from prior comments:

- New task ordering (`nextOrderForNewTask`, transaction-scoped) — correct
  and already covered by `05-task-create-transaction.test.cjs`.
- Reorder within a column, cross-column move, move to beginning/middle/
  end, drop immediately before/after a neighbor, moving a task around
  itself, and rebalance-on-no-room all go through the same
  `computeMovePlan`/`planTaskMove`, already unit-tested at the pure-logic
  level in `01-pure-ordering.test.cjs` — now also exercised end-to-end
  against an in-memory `Task` collection and through the real `PATCH
  /api/tasks/[id]` route in the new test file (see below), including a
  transaction-rollback case for a failure mid-rebalance.
- Concurrent task creation, concurrent moves into the same column, and
  duplicate order values are a knowingly-accepted, documented trade-off
  (see the comment block atop `lib/taskOrdering.js`): two truly
  simultaneous writes can tie on `order`, but `compareTasks()` still
  produces one deterministic total order every time the column is
  sorted, and the next rebalance cleans the tie up. New tests demonstrate
  this directly rather than just re-reading the comment.
- Deterministic tie-breaking (`compareTasks`, `compareColumns`) — already
  correct and covered.
- Column order creation races — already closed by the project+order
  unique index and retry-on-collision in `columns/route.js`, covered by
  `03-column-order-retry.test.cjs`.
- Done-column concurrency and transaction retry behavior — already
  correct and covered by `04-done-column-transaction.test.cjs` and
  `02-mongo-transaction.test.cjs` respectively; both still pass
  unmodified.

## Observation (not fixed — outside this phase's scope)

`PATCH /api/projects/[id]/columns/[columnId]` accepts an `order` field
with no retry-on-collision, unlike column creation. Today nothing in the
UI ever sends it — there's no column drag-and-drop, only task
drag-and-drop — so this isn't reachable in practice. Noted in
KANBAN_ORDERING_AUDIT.md for whoever adds column reordering later; not
changed here since there's no demonstrated correctness issue to fix and
doing so would be scope creep for this phase.

## Tests

Added `__manual_test__/15-kanban-ordering-audit.test.cjs` (17 tests,
0 failing) covering everything above that wasn't already exercised by
the pre-existing suite. All 14 pre-existing test files
(145 tests) still pass unmodified. `npm run build` succeeds and `npm
audit --omit=dev` reports 0 vulnerabilities.

## Files changed

- `src/lib/taskOrderCompare.js` — added `currentSiblingIndex()`.
- `src/components/KanbanBoard.jsx` — fixed the stale-`dropTarget` bug in
  `handleColumnDragOver`; switched `handleDrop`'s no-op check to
  `currentSiblingIndex()`.
- `__manual_test__/15-kanban-ordering-audit.test.cjs` — new.
- `__manual_test__/README.md` — documented the new test file.
- `KANBAN_ORDERING_AUDIT.md` — new.

# Task Attachment Security, Validation, Memory & Storage Audit

Scope: task attachment size/count/total-size limits, multipart
request-size limits, MIME/extension/magic-byte validation, filename
sanitization, Content-Disposition safety, authorization on
download/delete, Base64 exposure in DTOs and queries, memory
amplification, the 16MB BSON ceiling, download/content-sniffing
behavior, concurrent upload/delete races, failure behavior, and
client/server limit consistency. No authentication changes, no team
authorization changes beyond what attachment access itself requires, no
Kanban ordering changes, no UI redesign. Every file in scope was read
directly before any change. Full findings and a manual test matrix for
live-Atlas verification are in ATTACHMENT_SECURITY_AUDIT.md.

## Starting point: attachments were already mostly hardened

`lib/attachmentPolicy.js` and `lib/limitedFormData.js` already correctly
enforced per-file size, multipart request-size (via a streaming guard
that aborts mid-read rather than buffering an oversized body first),
MIME+extension+magic-byte validation, filename sanitization, and safe
Content-Disposition headers. `lib/authz.js`'s `getTaskAccess()` already
gated both attachment routes behind project/team authorization and kept
`attachments.data` out of every query except the one download route that
explicitly opts in, and `lib/serialize.js`'s `toAttachmentDTO()` already
never read `data` off the source document. All of this was verified by
reading the code directly (not taken on faith from prior comments) and
is now covered by tests in `__manual_test__/14-attachment-security.test.cjs`
rather than just prose claims.

## Real finding: a check-then-write race let concurrent uploads exceed the count/total-size limits

The upload route read `task.attachments` once, checked the 20-attachment
count cap and 8MB total-size cap against that snapshot, then only
pushed + `task.save()`d after both passed. Two uploads to the same task
close enough together could each read the array before the other's
write landed, each see themselves as under the limit, and both commit —
putting the task over either cap.

The obvious-looking fix — Mongoose's `optimisticConcurrency` scoped to
just the `attachments` path — turns out not to work here: every route
that mutates attachments loads the task via `getTaskAccess()`'s
`.select("-attachments.data")` projection (itself a correct,
already-existing optimization to avoid loading attachment bytes for
routes that don't need them), and I confirmed directly against
Mongoose's source that this specific projection shape makes its
`isSelected('__v')` check return false, silently disabling version
checking on exactly the documents this fix would need it for. Loading
the full document to make versioning work would have reintroduced the
memory-amplification problem that projection exists to prevent. Full
reasoning and how this was verified are in
ATTACHMENT_SECURITY_AUDIT.md.

**Fix**: replaced `task.attachments.push(...) + task.save()` with a
single atomic `Task.updateOne()` whose filter re-checks both the count
and running-total limits against the document's true state at write
time (via `$expr`/`$size`/`$sum`), so two concurrent uploads are
serialized by MongoDB itself. A lost race now returns `409 Conflict`
instead of either silently exceeding the limit or surfacing a raw 500.
The delete route was similarly switched to an atomic
`Task.updateOne({ _id }, { $pull: { attachments: { _id } } })` for
consistency and to avoid depending on loading + re-saving the full
metadata array to remove one element (no equivalent race existed there,
since a delete can't push a task over any limit).

**Schema-level defense in depth**: `AttachmentSchema.size` now caps at
`MAX_FILE_SIZE`, and the `attachments` array gained a second validator
(alongside the existing count validator) checking the summed `size`
against `MAX_TOTAL_ATTACHMENTS_SIZE` — a backstop for any future
`.push()` + `.save()` code path, not the primary enforcement (that's the
atomic update above).

## Minor gap: client-side total-size check

`TaskDetailDialog.jsx` already pre-checked per-file size and attachment
count client-side against the same constants the server uses, but not
the running total-size limit. Added the same check client-side (UX
only — the server-side check and the new atomic guard remain the actual
enforcement).

## Tests

`__manual_test__/14-attachment-security.test.cjs` (35 new cases):
filename sanitization (path traversal, header-breaking characters,
length truncation), MIME/extension/magic-byte validation (valid
files, mismatched extension, disallowed MIME, double-extension
disguise, corrupted signature, binary renamed to `.txt`),
`getTaskAccess()`'s attachment-data projection (default-excluded,
opt-in included, denied for an outsider), DTO hygiene, and route-level
coverage for both attachment endpoints (401/403, oversized declared
`Content-Length`, oversized file, zero-byte file, count limit,
total-size limit, mislabeled file rejected before any DB write, the
atomic update's filter shape, the 409-on-lost-race path, malformed
attachment id as 404, download headers, and delete's atomic `$pull`
shape). Full suite (14 files): 145 passed, 0 failed. `npm run build`
passes cleanly (placeholder env vars, same convention as the existing
test harness — no live database in this sandbox).

---

# Authorization, Data Integrity & MongoDB Transaction Hardening Audit

Scope: cross-team/cross-project access, manager/member authorization,
transaction boundaries and fallback behavior, and race conditions between
authorization checks and writes. No UI changes, no attachment
implementation, no drag/drop ordering, no auth rate limiting, no
documentation overhaul beyond the one factual correction noted below.
Every file in scope was read directly before any change — nothing here is
based on prior changelog/audit claims.

## Headline finding: the "graceful fallback on standalone MongoDB" claim was false for four operations

README.md documents that every transactional route degrades to a plain,
unsessioned sequence of writes on a standalone (non-replica-set) MongoDB
instead of failing — real MongoDB transactions
(`session.withTransaction()`) only run on a replica set, and Atlas always
is one, but a bare local `mongod` isn't. `lib/mongoTransaction.js`'s
`withOptionalTransaction()` helper implements exactly that fallback, and
three prior-phase routes (task creation, task move, the done-column
toggle) already used it correctly.

Four other routes instead called `mongoose.startSession()` +
`session.withTransaction()` directly, with no fallback path:

- `DELETE /api/projects/[id]` — cascading project/task/column delete
- `DELETE /api/teams/[id]/members` — member removal + task unassignment
- `POST /api/auth/register` — user creation + invitation consumption
- `POST /api/projects` — project creation + default columns (this one
  wasn't even in README's list of four "transactional" operations — an
  undocumented fifth instance of the same gap)

Raw `session.withTransaction()` throws immediately against a standalone
server; none of these four routes caught that and fell back, so every one
of them would have hard-500'd (registration, project creation, project
deletion, member removal — i.e. most of the app's write path) against a
non-replica-set database, contradicting what the documentation promises.

**Fix**: all four now use `withOptionalTransaction`, matching the
already-established pattern. Each fix's reasoning about *why* the
fallback is safe (idempotent deletes/pulls, or brand-new-document inserts
with no double-write risk) is documented inline at the call site rather
than only here. README.md's transaction paragraph is corrected to include
project creation in its list.

## Orphaned-task race between column deletion and task creation (#13/#16)

A column can be deleted at any time while empty. Task creation checked
the column existed once, before validation and well before the eventual
insert — a column deleted in that window produced a task referencing a
column that no longer exists. Column deletion had the same shape of gap:
"count tasks, then delete" was two separate, non-atomic queries.

**Fix**: both checks now happen inside the same transaction as the write
they guard — task creation re-verifies the column exists immediately
before inserting; column deletion re-verifies zero tasks immediately
before deleting. This narrows the window from "the whole request" down to
"two reads inside one transaction," which removes the version of the race
that was actually reachable in practice. The fully-simultaneous
interleaving (two transactions each reading a snapshot from before the
other's commit) remains a theoretical, non-corrupting edge case — the
same class of trade-off already documented and accepted for task-order
ties in `lib/taskOrdering.js` — rather than adding per-column document
locking for a gap this narrow.

## Manager-visibility query hardening (#12)

The dashboard and project-list queries derived "teams I can see projects
through" via `Team.find({ members: userId })` alone. Team creation always
adds the manager to `members`, and member removal blocks removing the
manager, so today the two sets are identical in practice — but the query
didn't defend against that invariant ever being weakened elsewhere, which
would have silently hidden a manager's own team's projects from their own
dashboard. Replaced with a new shared `accessibleTeamIds()` helper in
`lib/authz.js` that matches on `$or: [{ manager }, { members }]`,
consistent with how `teamAccessFor` already treats the manager as
implicitly a member.

## Everything else audited, no changes needed

Read in full: `authz.js`, `mongoTransaction.js`, `taskOrdering.js`,
`objectId.js`, `mongoErrors.js`, all models, every route under
`api/teams/`, `api/projects/`, `api/tasks/`, and the dashboard server
components. No cross-team or cross-project access gap was found —
`projectAccessFor`/`teamAccessFor` already correctly check manager OR
member rather than assuming the manager is always inside `members[]`;
task/column/attachment/invitation routes are all correctly scoped through
`getAccessibleProject`/`getTaskAccess`; assignee validation is enforced
consistently on both task creation and update.

The 404-vs-403 split on `GET`/`DELETE /api/projects/[id]` and
`GET /api/teams/[id]` (not-found vs. access-denied) was reviewed against
item #10 (enumeration). Given MongoDB ObjectIds are a 96-bit
non-sequential, non-guessable space, distinguishing "doesn't exist" from
"exists but you can't see it" here doesn't give an attacker a practical
enumeration vector — left as-is rather than collapsing to a single status
that would be worse UX for no real security gain. See
`AUTHZ_TRANSACTION_AUDIT.md` for the full reasoning and file-by-file
findings.

## Testing

- Extended `__manual_test__/05-task-create-transaction.test.cjs`'s Column
  mock to match the route's new `.session()` chain (the test's shape, not
  its intent, needed to change).
- Added `__manual_test__/12-transaction-fallback-routes.test.cjs`: proves
  all four newly-fixed routes complete successfully via the no-session
  fallback path when `session.withTransaction()` reports transactions are
  unsupported — the direct regression test for the headline finding.
- Added `__manual_test__/13-column-task-race.test.cjs`: covers the
  column-missing / column-non-empty / column-present paths for both task
  creation and column deletion after moving each check inside its guarding
  transaction.
- Full suite: **110 passed, 0 failed** across all 13 test files (`node
  __manual_test__/<file>.test.cjs` per file — no test runner installed).
- `npm run build` (Next.js 15 production build, with placeholder env vars
  since no live database is available in this environment): **compiled
  and typechecked successfully**, all 25 routes generated.
- As with every prior phase, live MongoDB replica-set behavior (real
  concurrent transactions, real write-conflict retries) cannot be
  exercised in this sandbox. The mocked tests above verify the *code
  paths* are correct; the manual test matrix in
  `AUTHZ_TRANSACTION_AUDIT.md` covers what to run against Atlas directly.

## Changed files

- `src/app/api/projects/[id]/route.js` — DELETE now uses
  `withOptionalTransaction`
- `src/app/api/projects/route.js` — POST now uses
  `withOptionalTransaction`; GET uses the new `accessibleTeamIds()` helper
- `src/app/api/teams/[id]/members/route.js` — DELETE now uses
  `withOptionalTransaction`
- `src/app/api/auth/register/route.js` — now uses
  `withOptionalTransaction`
- `src/app/api/tasks/route.js` — POST re-checks column existence inside
  its transaction
- `src/app/api/projects/[id]/columns/[columnId]/route.js` — DELETE wraps
  the empty-check + delete in a transaction
- `src/lib/authz.js` — added `accessibleTeamIds()`
- `src/app/dashboard/page.jsx` — uses `accessibleTeamIds()`
- `README.md` — corrected the transaction paragraph to include project
  creation
- `__manual_test__/05-task-create-transaction.test.cjs` — updated Column
  mock
- `__manual_test__/12-transaction-fallback-routes.test.cjs` — new
- `__manual_test__/13-column-task-race.test.cjs` — new
- `AUTHZ_TRANSACTION_AUDIT.md` — new, full audit findings



# Final Regression & Verification Phase

Scope: verification and targeted regression testing only, across the full
cumulative codebase (all prior phases through "Email-Generation Security &
Correctness"). No new features, no redesign, no architecture changes. Every
claim below was checked by reading the actual current source — not assumed
from this or any prior phase's changelog/audit notes.

## Full source audit

Read every API route, every model, `auth.js`, `authz.js`, `validation.js`,
`mongoErrors.js`, `attachmentPolicy.js`, `taskOrdering.js`/`mongoTransaction.js`,
`serialize.js`, all dashboard pages, all client mutation call sites,
`package.json`/`package-lock.json`, and config files. No regressions found:

- **Authorization**: every protected route checks `getServerSession` before
  any DB access; every resource route routes through the centralized
  `authz.js` helpers (`getAccessibleProject`, `getTaskAccess`,
  `projectAccessFor`, `teamAccessFor`, `isTeamManager`, `validateAssignees`)
  with no ad-hoc/duplicated authorization logic found anywhere.
- **Next.js 15**: every dynamic route handler (`projects/[id]`,
  `projects/[id]/columns/[columnId]`, `tasks/[id]`,
  `tasks/[id]/attachments/[attachmentId]`, `teams/[id]`,
  `teams/[id]/members`, `teams/[id]/invitations/[invitationId]`) correctly
  `await`s `params` before use. No Next.js 14-style synchronous `params`
  access remains.
- **Done-column invariant**: `columns/[columnId]/route.js` PATCH wraps the
  `findOneAndUpdate` + `updateMany` pair in `withOptionalTransaction`,
  correctly uses `findOneAndUpdate` (not a stale `.save()`) so a
  driver-level retry re-issues the identical write — confirmed still
  correct, unchanged since Phase 2.
- **Task ordering**: `taskOrdering.js` still uses only integer `order`
  values with `ORDER_STEP = 1000` and gap-exhaustion rebalancing — no
  floating-point ordering logic anywhere in `src`. Column creation
  (`createColumnWithNextOrder`) and task creation (`nextOrderForNewTask`)
  both retry/transact correctly against concurrent duplicate-order races.
- **Attachments**: size (5MB/file), running total (8MB/task), and count
  (20/task) limits are enforced server-side in the upload route,
  independent of client-declared `Content-Type`; `readFormDataWithLimit`
  rejects an oversized request from a declared `Content-Length` or from
  actual streamed bytes, whichever is smaller, before the full body is
  buffered. MIME+extension pairing and magic-byte signature checks both
  run before persisting. Every list/board/DTO-producing query
  (`tasks/route.js`, `tasks/[id]/route.js`, `projects/route.js`,
  `projects/[id]/route.js`, and every mutation route's re-fetch)
  explicitly `.select("-attachments.data")`; only the dedicated
  single-attachment `GET` route opts into `includeAttachmentData: true`.
  No query was found that accidentally loads attachment Base64 into a
  list/board response.
- **Registration/invitations**: the register route's transaction still
  correctly creates the `User` and consumes matching non-expired
  `Invitation`s (granting membership via `$addToSet`) atomically, clears
  *all* invitations (expired or not) for that email once at least one
  active one exists, and rolls back the user on any failure inside the
  transaction. Verification email sending is best-effort (try/catch, logs
  and continues) so a transient SMTP failure never turns an
  already-committed registration into a 500.
- **Email HTML escaping**: `escapeHtml()`/`sanitizeForHeader()` are still
  correctly applied to every user-controlled value in both email templates
  (Phase 5, re-verified unchanged).

## Static searches performed

`console.log`, `TODO`, `FIXME`, raw `fetch()` outside `apiFetch`,
`passwordHash` in responses, verification tokens in responses,
`attachment.data` in list/DTO queries, `dangerouslySetInnerHTML`,
unvalidated `ObjectId`s reaching Mongoose, dynamic route params accessed
without `await`. All clean:

- `passwordHash` only appears where it's hashed (`auth/register`) and
  compared (`lib/auth.js`) — never serialized into a response.
- No verification or session token is ever returned in a JSON response
  body; tokens only travel inside emailed links.
- The two `dangerouslySetInnerHTML` uses (`ThemeRegistry.jsx`'s MUI SSR
  style extraction, `layout.jsx`'s pre-hydration theme-init script) are
  both fixed, non-user-controlled strings — not an injection path.
- No raw `fetch()` to an internal `/api/...` route was found outside the
  `apiFetch()` wrapper in any component or page.

## Automated regression suite

The project's existing `__manual_test__/` harness (real route/lib files
loaded via `@babel/register` with only Mongoose/Next/next-auth swapped for
small in-memory fakes — no `npm test` script, run individually with
`node __manual_test__/<file>.test.cjs`) already covered pure ordering
logic, transaction/retry behavior for done-column and task-creation, the
column-order-retry race, the upload size guard, and email escaping. Two
gaps against this phase's test-priority list were identified and filled:

- **`08-authz-and-validation.test.cjs`** (new, 17 tests) — direct unit
  coverage for `authz.js`'s access/assignment boundary functions
  (`projectAccessFor`, `teamAccessFor`, `isTeamManager`,
  `validateAssignees`) and every exported validator in `validation.js`.
  These were previously exercised only indirectly through route-level
  tests; this file pins down the boundary conditions directly (cross-team
  access denial, cross-team assignee rejection, malformed-ObjectId
  rejection, required/optional-field semantics, integer/enum/date/boolean
  validation edge cases).
- **`09-registration-transaction.test.cjs`** (new, 8 tests) — direct
  coverage for the register route's transaction: duplicate registration,
  malformed input, single and multiple invitation consumption, expired
  invitations (cleared but not honored), mid-transaction rollback (no
  partial user left behind), and SMTP-failure-doesn't-fail-registration.

All 9 test files now pass: **67/67 tests, 0 failures.**

## Final build

```
npm install              → 505 packages installed, no errors
npm run build             → ✓ Compiled successfully, all 24 routes generated
                             (requires MONGODB_URI / NEXTAUTH_SECRET /
                             NEXTAUTH_URL — lib/mongodb.js and
                             lib/authSecret.js fail fast at import time by
                             design; placeholder values used for the build
                             only, no real database contacted)
npm audit --omit=dev      → found 0 vulnerabilities
node __manual_test__/*.test.cjs (each file individually) → 67 passed, 0 failed
```

## Remaining known limitations (unchanged from prior phases)

- **Live MongoDB Atlas replica-set behavior** — real concurrent
  transaction write-conflict/retry semantics, TTL-index sweep timing on
  expired invitations — cannot be exercised in this sandbox (no network
  access to a MongoDB server). The in-memory transaction simulations in
  the test suite prove the *application code* correctly scopes every
  write to one session and correctly rolls back on failure, but they are
  not a substitute for testing against a real replica set. See the manual
  test matrix below.
- No automated frontend/browser test suite exists (no Playwright/Cypress
  etc. in this project) — the frontend checklist below was verified by
  reading component source (loading-state/`finally`/`isMounted()` usage,
  error-handling call sites, drag/drop's non-optimistic refetch-on-success
  design, theme-mode hydration handling) rather than by running the UI.

## Frontend regression checklist (verified by source review)

- [x] Every mutation call site uses `apiFetch()`, which throws on any
  non-2xx response — no call site can silently treat a failed request as
  successful.
- [x] Every `setSubmitting`/`setSaving`/`setLoading` site is paired with a
  `finally` (or, in `dashboard/teams/page.jsx`'s multi-branch submit
  handler, an explicit clear on every exit path) guarded by
  `isMounted()`, so a slow/failed request never leaves a control stuck in
  a loading state.
- [x] Dialogs/forms (`TaskDetailDialog`, `NewTaskModal`, team/project
  creation forms) only close or reset on the success path; a thrown error
  from `apiFetch` is caught and shown, and the dialog stays open.
- [x] Errors are kept in component state (not discarded), so a retry
  re-enters the same handler with the same inputs.
- [x] Kanban drag/drop (`KanbanBoard.jsx`) never mutates local task state
  optimistically — it calls the PATCH, then refetches via `onChanged()`
  on success. A failed move therefore leaves the board exactly as it was
  before the drag, with nothing to visually roll back.
- [x] Dark/light mode: `ThemeModeContext.jsx` starts at `"light"` for the
  first client render (matching SSR output, avoiding a hydration
  mismatch) and syncs to the real preference from the pre-hydration inline
  script in `layout.jsx`, so there's no flash of the wrong theme.
- [x] Mobile/keyboard-navigation behavior unchanged since the prior
  UI/accessibility hardening phase; no source changes in this phase
  touched any component markup, styling, or focus handling.

## Readiness

Build is clean, `npm audit` reports zero vulnerabilities, and the
authorization/data-integrity/attachment/registration checklists above were
each verified against the current source in this phase — not carried
forward from a prior phase's claim. This is not a claim that the
application is bug-free; live-replica-set behavior in particular has not
been (and cannot be, in this sandbox) exercised end-to-end. See the manual
test matrix below before deploying to production.

---

# Phase 5 — Email-Generation Security & Correctness

Scope: HTML/header/text generation in `src/lib/email.js` only. No changes to authentication architecture, registration transactions, attachments, ordering logic, or UI. `sendTeamInviteEmail()` and `sendVerificationEmail()` are the only two email templates in the codebase (confirmed by searching the full `src` tree for the shared HTML wrapper style and for any other `nodemailer`/`sendMail` call site — there are none).

## Confirmed issue

`sendTeamInviteEmail()` interpolated two user-controlled values — `inviterName` (a display name, settable at registration, up to 100 chars, internal whitespace/newlines *not* stripped by trimming) and `teamName` (settable at team creation) — directly into the HTML email body with no escaping. `sendVerificationEmail()` already escaped its one user-controlled value (`name`) correctly and was not vulnerable; it's covered by regression tests below to confirm this phase didn't disturb it.

**Impact:** anyone who can join or create a team (i.e. any registered user) could set their display name or a team name to something like `<img src=x onerror=...>` or `<script>...</script>`, and that markup would render live in the HTML the invited recipient's mail client shows — content injection / stored HTML injection in an email TeamFlow itself sends, to a recipient who has no account yet and no reason to distrust it.

## Fix

`src/lib/email.js`:
- **`escapeHtml(value)`** (already existed, used correctly by `sendVerificationEmail()`) is now also applied to every user-controlled value interpolated into `sendTeamInviteEmail()`'s HTML body: `inviterName` and `teamName`, at all three interpolation sites (the two `<strong>` tags and the closing sentence that repeats the team name).
- **`sanitizeForHeader(value)`** (new) — collapses any run of whitespace, including `\r`/`\n`, to a single space and trims the ends. Applied to `inviterName`/`teamName` specifically when building the invite email's **Subject** line, which is the one place either value flows into an email header rather than the body.
- The **plaintext** body of both emails intentionally continues to use the raw, unescaped values — a plaintext mail part is rendered as literal text by the client, so HTML-escaping it would incorrectly show `&lt;` etc. to the recipient. Confirmed the HTML and plaintext parts otherwise stay in sync (same facts, same signup link) after the fix.

## Audit of related concerns (per this phase's request)

- **Subject-line CR/LF header injection:** nodemailer 9.0.5 already collapses `\r\n`/`\r`/`\n` to a space for every header value it writes, including `Subject` (verified by reading `node_modules/nodemailer/lib/mime-node/index.js`'s header-formatting switch — the `default` case, which `Subject` falls into, runs `.replace(/\r?\n|\r/g, ' ')` before encoding). So this was not an exploitable header-injection path via nodemailer itself. `sanitizeForHeader()` was still added as defense-in-depth so the subject's safety doesn't rely solely on a downstream library, and so a stray newline in a name can't produce a subject that looks broken or truncated in some mail clients.
- **Email address validation:** the recipient (`to`) address is validated by `validateEmailInput()` (`src/lib/validation.js`, invite path) and register route's own `EMAIL_RE` (registration path) before ever reaching `email.js`. Both regexes (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) already reject any address containing whitespace — which includes `\r`/`\n` — so a malicious address can't inject headers via the `to` field either. No change needed here; confirmed by inspection, not modified (out of scope: touching validation.js/registration would exceed this phase's file boundary).
- **Generated URLs / app origin:** `getAppUrl()` (unchanged) already validates `NEXTAUTH_URL` via `new URL(...).origin` and falls back to `http://localhost:3000` on a malformed value, rather than trusting the raw env var into an emailed link. Verified this still behaves correctly (see tests).
- **URL query values:** `encodeURIComponent()` is used for both the invite signup link's `email` param and the verification link's `token` param — left unchanged, and confirmed by test that percent-encoding a value containing `"><script>` neither breaks out of the `href="..."` attribute nor needs additional escaping (everything `encodeURIComponent` doesn't already percent-encode — `A-Z a-z 0-9 - _ . ! ~ * ' ( )` — is inert in a double-quoted HTML attribute).
- **User-controlled values as HTML attributes:** neither `inviterName`, `teamName`, nor `name` are ever placed into an attribute (only into element text content, now escaped, or used to build a query-string value via `encodeURIComponent`), so there's no attribute-breakout path to close beyond the text-content escaping above.
- **Malformed `NEXTAUTH_URL`:** already handled (see `getAppUrl()` above); unchanged, re-verified by test.
- **Best-effort send semantics:** both call sites (`register/route.js`, `teams/[id]/members/route.js`) already wrap the send in try/catch and only `console.error` on failure, without failing the outer request — unchanged, confirmed by re-reading both call sites.
- **Secrets / token logging:** the no-SMTP fallback path (`send()`) logs `To`, `Subject`, and the plaintext body to the server console — the plaintext body for the verification email contains the verification link (and thus the token) by design, which is how local dev without SMTP configured lets a developer complete the flow; this is pre-existing, intentional, server-side-only (`console.warn`, not returned to any client), and out of scope for this phase (no password is ever logged; the token is a single-use, time-limited link's query value, not a credential to a live account).

## Files changed

- `src/lib/email.js` — added `sanitizeForHeader()`; applied `escapeHtml()`/`sanitizeForHeader()` to `inviterName`/`teamName` in `sendTeamInviteEmail()`. `sendVerificationEmail()` unchanged (was already correct).
- `__manual_test__/07-email-html-escaping.test.cjs` (new) — see below.

## Verification

New test file `__manual_test__/07-email-html-escaping.test.cjs` stubs `nodemailer.createTransport()` to capture the exact `{ subject, text, html }` passed to `sendMail()` (no real SMTP involved), covering:

- `<img onerror>` / `<script>` tags in `inviterName` and `teamName` are escaped (`&lt;`, `&gt;`) in the HTML body and never appear raw.
- `&`, `"`, and `'` in names/team names are escaped (`&amp;`, `&quot;`, `&#39;`) in the HTML body.
- Non-HTML-significant characters (`«`, `»`, accented letters) pass through the HTML body unmangled — confirming escaping isn't overzealous.
- The plaintext body deliberately remains unescaped (raw characters, not entities) — confirming HTML and plaintext stay consistent with each part's own correct rendering, not double-escaped.
- A team name containing `\r\n` can no longer split the Subject header into multiple lines; the exact resulting subject string is asserted.
- A normal name/team name still produces the exact expected, readable subject line (no over-sanitization of legitimate input).
- The invite signup link and verification link remain well-formed, correctly `encodeURIComponent`-encoded, and unbroken as an `href` attribute — including a token containing `"><script>alert(1)</script>`.
- Regression coverage for `sendVerificationEmail()`: a `<script>` tag in `name` is still escaped, and the subject (static, non-user-controlled) is unaffected.

```
node __manual_test__/07-email-html-escaping.test.cjs
# 9 passed, 0 failed
```

All pre-existing manual tests were re-run and still pass (confirms no regression from this phase):

```
node __manual_test__/01-pure-ordering.test.cjs           # 9 passed, 0 failed
node __manual_test__/02-mongo-transaction.test.cjs        # 5 passed, 0 failed
node __manual_test__/03-column-order-retry.test.cjs       # 4 passed, 0 failed
node __manual_test__/04-done-column-transaction.test.cjs  # 5 passed, 0 failed
node __manual_test__/05-task-create-transaction.test.cjs  # 3 passed, 0 failed
node __manual_test__/06-limited-form-data.test.cjs        # 7 passed, 0 failed
```

```
npm install    # 0 errors
npm run build  # ✓ Compiled successfully, all 16 API routes + 8 pages generated, no type/lint errors
```

Manual verification (read the generated `html`/`text`/`subject` values in the test output above rather than a live inbox, since no SMTP provider is configured in this environment): confirmed by inspection that a legitimate invite (plain names, no special characters) still renders a natural sentence and a clickable, correctly-pointed signup link, and the verification email's link and copy are unchanged.

## Remaining issues / explicitly out of scope

- **Live-mail-client rendering:** the fix has been verified against the exact HTML/text/subject strings nodemailer would send, but rendering across real mail clients (Gmail, Outlook, Apple Mail — which sometimes apply their own sanitization on top) was not tested and is unnecessary to test, since the HTML no longer contains any unescaped user input regardless of client-side handling.
- **`inviterName`/`teamName` length or character-set restrictions at the source** (registration's `MAX_NAME_LENGTH = 100`, and whatever limit team creation enforces) were not changed — this phase only changes how already-accepted values are rendered into email content, per the stated scope.
- **CSS/HTML email-client quirks** (e.g. some clients stripping `<style>` blocks) are unrelated to security and were not investigated.

# Phase 4 — Next.js 15 Compatibility & Documentation Consistency

## Scope
Next.js 15 runtime-compatibility fixes only, plus bringing `README.md`
in line with the actual current source. `package.json`/`package-lock.json`
were already pinned to Next.js 15.5.25 before this phase; the route
handlers and docs had not been updated to match. No redesign, no
framework version change, no changes to authentication logic, the
registration transaction, email security, attachment architecture, or
the Kanban ordering algorithm.

## Issue 1 — Dynamic route params must be awaited

In Next.js 15, the `params` object passed to a Route Handler
(`(req, { params }) => ...`) and to a dynamic page's server props is a
`Promise`, not a plain object — synchronous access like `params.id`
still worked at runtime in some cases but is deprecated and logged a
warning, with synchronous access removed entirely in later minor
versions. Every dynamic API route in this project was still written
against the Next.js 14 synchronous shape.

**Audited:** every `route.js` under `src/app/api/` (16 files, 14 of
which destructure `{ params }` in at least one exported handler).

**Fixed** (each handler now does `const { id } = await params;`, or the
equivalent multi-key destructure, exactly once at the top of the
function, before any use of the value):
- `src/app/api/teams/[id]/route.js` — `GET`
- `src/app/api/teams/[id]/members/route.js` — `POST`, `DELETE`
- `src/app/api/teams/[id]/invitations/[invitationId]/route.js` —
  `DELETE` (two params: `id`, `invitationId`)
- `src/app/api/projects/[id]/route.js` — `GET`, `DELETE`
- `src/app/api/projects/[id]/columns/route.js` — `POST`
- `src/app/api/projects/[id]/columns/[columnId]/route.js` — `PATCH`,
  `DELETE` (two params: `id`, `columnId`)
- `src/app/api/tasks/[id]/route.js` — `PATCH`, `DELETE`
- `src/app/api/tasks/[id]/attachments/route.js` — `POST`
- `src/app/api/tasks/[id]/attachments/[attachmentId]/route.js` — `GET`,
  `DELETE` (two params: `id`, `attachmentId`)

No other behavior in these routes was touched — the same variable
(renamed from `params.x` to a locally destructured `x`) is used at
every call site that previously read `params.x` directly, so query
filters, `isValidObjectId()` checks, and authorization lookups are
unchanged in every route.

**Not affected:** `src/app/dashboard/projects/[id]/page.jsx` and
`src/app/dashboard/teams/[id]/page.jsx` are Client Components that read
the route param via the `useParams()` hook from `next/navigation`, not
via a server-side `params` prop — that hook's return value was not
changed between Next.js 14 and 15, so these two files needed no change.
Confirmed by inspection, not assumed.

## Issue 2 — Other Next.js 15 migration surface

Checked for the other common Next.js 14 → 15 breaking changes:
- `cookies()` / `headers()` from `next/headers` becoming async —
  **not used anywhere in this project** (`grep -rn "next/headers"
  src/` — no results), so nothing to migrate.
- `searchParams` prop on Server Component pages becoming async — this
  project only reads `searchParams` in two places, both via the
  client-side `useSearchParams()` hook (`register/page.jsx`,
  `verify-email/page.jsx`, `dashboard/projects/page.jsx`), and once via
  `new URL(req.url).searchParams` inside a Route Handler
  (`teams/[id]/members/route.js`) — neither form is affected by the
  Next.js 15 change, which only applies to the `searchParams` prop
  Next.js injects into a Server Component page.
- GET Route Handlers no longer being cached by default — a behavior
  change, not a breaking one for this app: every route here reads the
  session and/or hits MongoDB on every request already (no route relied
  on the old default-cache behavior), so no code change was needed.
  Documented here for awareness, not fixed because nothing was broken.
- `next.config.js` — already minimal (`{}`), no deprecated options
  present, no change needed.
- No `middleware.js` exists in this project.
- NextAuth v4 (`next-auth@4.24.15`) — its Route Handler
  (`api/auth/[...nextauth]/route.js`) exports `{ GET, POST }` from
  `NextAuth(authOptions)`, which already returns the async-compatible
  handler shape; no `params` are consumed by this specific route
  (`[...nextauth]` is a catch-all with no other dynamic segments used
  in code), so it needed no change beyond what's already covered by
  the general Next.js 15 params handling (it has none to migrate).

No Next.js version change was made — `next` stays at `15.5.25`, exactly
as it already was in `package.json` before this phase.

## Issue 3 — Documentation corrections

**`README.md`:**
- Corrected the framework version claim from "Next.js 14 (App Router)"
  to "Next.js 15 (App Router)".
- Added the actual current attachment limits: 5MB per file, 8MB total
  per task, 20 attachments per task (previously only the 5MB per-file
  limit was documented; the other two constants existed in
  `lib/attachmentPolicy.js` since the Phase 3 attachments work but were
  never reflected in the README).
- Added a section documenting the current page count (9) and API route
  handler count (16 `route.js` files, 22 exported HTTP methods total),
  verified by listing the actual `npm run build` route output rather
  than assumed from a prior phase's changelog.
- Added a short MongoDB transaction requirement note: several mutations
  (project delete, member removal, invitation-consuming registration,
  the done-column invariant) run inside `session.withTransaction()` and
  require a replica set (Atlas always is one); a standalone local
  `mongod` falls back to running the same logic without a transaction
  via `lib/mongoTransaction.js`'s `withOptionalTransaction()`, which is
  fine for solo local development but means real concurrency behavior
  can only be verified against a real replica set.
- Added an explicit Authentication Flow section (registration → email
  verification via JWT link → NextAuth v4 Credentials-provider JWT-session
  login, gated on `emailVerified`) — this existed in the code since
  early phases but was never written down as its own section.
- Added a "Next.js 15 compatibility" section explaining the `await
  params` requirement introduced by this phase, so future contributors
  don't reintroduce the Next.js 14 synchronous pattern.
- Email-sending fallback behavior (logs to console instead of failing
  when SMTP env vars are unset) was already documented accurately —
  verified against `lib/email.js` and left unchanged.

**`FINAL_AUDIT.md`:** this is a point-in-time audit from an earlier
phase (predating the Phase 3 attachments work), and its route count
("all 16 routes generated") was already stale before this phase started
— it was written before the attachments routes existed. Per this
phase's scope (Next.js 15 + doc consistency, not a full re-audit), it
was left as a historical record rather than rewritten; the up-to-date
counts now live in `README.md`.

**`CHANGELOG.md`:** no historical entries were altered — this section
is a new entry appended above the prior Phase 3 entry, per the
established pattern.

## Files changed
- `src/app/api/teams/[id]/route.js`
- `src/app/api/teams/[id]/members/route.js`
- `src/app/api/teams/[id]/invitations/[invitationId]/route.js`
- `src/app/api/projects/[id]/route.js`
- `src/app/api/projects/[id]/columns/route.js`
- `src/app/api/projects/[id]/columns/[columnId]/route.js`
- `src/app/api/tasks/[id]/route.js`
- `src/app/api/tasks/[id]/attachments/route.js`
- `src/app/api/tasks/[id]/attachments/[attachmentId]/route.js`
- `README.md`
- `CHANGELOG.md` (this entry)

## Not changed
- `next` dependency version (`15.5.25`, unchanged)
- Authentication logic (`lib/auth.js`), the registration transaction
  (`api/auth/register/route.js`), email sending (`lib/email.js`),
  attachment architecture (`lib/attachmentPolicy.js`,
  `lib/limitedFormData.js`), the Kanban ordering algorithm
  (`lib/taskOrdering.js`), and all UI/visual design — none of these
  required any change for Next.js 15 compatibility, and none were
  touched.
- `src/app/dashboard/projects/[id]/page.jsx`,
  `src/app/dashboard/teams/[id]/page.jsx` — confirmed unaffected
  (`useParams()` client hook, not server `params` prop).

## Commands run
```
npm install
npm run build
```

## Verification results
- `npm install` — succeeds, 505 packages, no install errors.
- `npm run build` — succeeds (`✓ Compiled successfully`, `✓ Generating
  static pages (16/16)`). Required dummy `MONGODB_URI` /
  `NEXTAUTH_SECRET` / `NEXTAUTH_URL` values in a local, untracked
  `.env` for the page-data-collection step (same requirement noted in
  the Phase 3 changelog; `lib/mongodb.js` / `lib/authSecret.js` fail
  fast at import time by design — no live database connection is
  opened during `next build`). Build output confirms **9 pages** and
  **16 API route handlers**, matching the counts now in `README.md`.
- Post-migration search — `grep -rn "params\.\(id\|columnId\|attachmentId\|invitationId\)" src/app/api` returns
  **zero matches**: no dynamic route anywhere in the project still
  accesses `params` synchronously.
- `grep -rn "await params" src/app/api` — 14 matches, one per exported
  handler that destructures `{ params }`, confirming every one was
  actually migrated (not just the ones shown above as examples).
- Manual test suite (`__manual_test__/*.test.cjs`, all 6 files) was
  re-run after the params migration: **33/33 assertions pass**. No
  logic in `taskOrdering.js`, `mongoTransaction.js`, or any other module
  those tests cover was touched, and the results confirm it — this is a
  regression check, not new coverage for this phase's change (the
  `params` migration itself isn't exercised by these tests, since they
  call the route logic directly rather than through the Next.js
  request-routing layer).
- `npm run lint` (`next lint`) — not run to completion: this project has
  no ESLint config file (no `.eslintrc*`, no `eslint.config.*`), and
  `next lint` now requires an interactive one-time setup wizard to
  generate one, which can't be driven non-interactively in this
  environment. This is a pre-existing gap (predates this phase, not
  introduced by it) — flagged here rather than silently skipped. `next
  lint` is also itself deprecated as of Next.js 15 and slated for
  removal in Next.js 16; migrating to a standalone ESLint CLI setup
  would be reasonable future work but is outside this phase's scope
  (Next.js 15 runtime compatibility + docs, not tooling changes).
- Live MongoDB replica-set testing (transactions, TTL timing, real
  concurrent drag-and-drop) still has not been exercised — this
  sandbox has no MongoDB access. Same flag as every prior phase.

# Phase 3 — Attachment Security, Request-Size Protection & Performance

## Scope
Three issues, all scoped to task attachments: unnecessary loading of
base64 attachment data by normal (non-download) queries, a multipart
upload route that read the entire request body before enforcing its
5MB file-size limit, and a full audit for any other attachment-bearing
query with the same problem. No changes to authentication, registration,
email, Kanban ordering, or UI/visual design.

## Issue 1 & 3 — Queries loading `attachments.data` unnecessarily

**Files:** `src/app/dashboard/page.jsx`, `src/app/api/projects/route.js`,
`src/app/api/tasks/[id]/route.js`

Audited every `Task.find`, `Task.findById`, `Task.findOne`, and
`Task.findByIdAndDelete` call in the codebase (see grep list below) for
whether it excludes `attachments.data`. Most already did — the
attachment routes, `GET /api/tasks/[id]`, `PATCH /api/tasks/[id]`, `POST
/api/tasks`, and `getTaskAccess()` in `lib/authz.js` all already used
`.select("-attachments.data")` (or, for `getTaskAccess`, opt in to the
full document only via its explicit `includeAttachmentData` flag, used
by exactly one caller: the download route). Three call sites did not:

1. **`src/app/dashboard/page.jsx`** — the dashboard's server component
   loads every task across every accessible project
   (`Task.find({ project: { $in: projectIds } })`) purely to build
   `toProjectDTO()`'s stats/progress-chart data. `toProjectDTO()` →
   `toTaskDTO()` → `toAttachmentDTO()` never includes attachment `data`
   in its output — so this query was pulling potentially several MB of
   base64 per task, across every task on the dashboard, into Node
   memory for data that was guaranteed to be thrown away before the
   response was ever built.
2. **`src/app/api/projects/route.js`** (`GET /api/projects`, the
   project list) — same problem, same fix: this endpoint's task query
   had no `.select()` at all, unlike its sibling `GET
   /api/projects/[id]`, which already excluded attachment data.
3. **`src/app/api/tasks/[id]/route.js`** (`DELETE`) — `await
   Task.findByIdAndDelete(params.id)` with no `.select()`. The
   returned/deleted document is never used (the route just responds
   `{ ok: true }`), but Mongoose still hydrates the full document —
   including every attachment's base64 `data` — before it's discarded a
   line later. `getTaskAccess()` earlier in the same route already
   excludes attachment data for the authorization check, so this was
   the one place in the delete path still paying for it.

**Fix:** added `.select("-attachments.data")` to all three queries.
Response shape is unchanged in every case — `toTaskDTO()`/`toProjectDTO()`
already never surfaced `data`, so this is a pure performance/memory fix,
not a behavior change. The dedicated download route
(`GET /api/tasks/[id]/attachments/[attachmentId]`) is untouched and is
still the only place that opts into loading attachment bytes.

**Audit method:**
```
grep -rn "Task\.find\|Task\.findById\|Task\.findOne\|populate(\"assignees\"\|\.select(" src
```
followed by manual inspection of every match. Also checked all four
`dashboard/*.jsx` pages: three of them (`projects`, `teams`,
`teams/[id]`) fetch through the already-corrected API routes via
`apiFetch()`; only `dashboard/page.jsx` queries Mongoose directly as a
server component, which is the one fixed above.

## Issue 2 — Multipart upload read the full body before the size check

**File:** `src/app/api/tasks/[id]/attachments/route.js` (route logic
change); **new file:** `src/lib/limitedFormData.js`

The upload route called `await req.formData()` first and only checked
`file.size > MAX_FILE_SIZE` afterward. `formData()` has to fully read
and parse the request body to return anything — so a client could send
an arbitrarily large multipart body (declared or not in
`Content-Length`) and force the server to receive and hold the whole
thing in memory before the 5MB check ever ran. This is a
request-smuggling-adjacent DoS vector: cheap for the attacker, expensive
for the server, and repeatable.

**Fix — `readFormDataWithLimit(req, maxBytes)`** in
`src/lib/limitedFormData.js`, used in place of the raw
`req.formData()` call:
- **Fast path:** if the request declares `Content-Length` and it's
  already over budget, the request is rejected immediately — zero bytes
  of the body are read.
- **Real enforcement:** the body is read via its `ReadableStream`
  (`req.body.getReader()`), counting bytes as each chunk arrives. The
  moment the running total exceeds the budget, the reader is cancelled
  (`reader.cancel()`) and a `PayloadTooLargeError` is thrown — the rest
  of an oversized body is never pulled off the wire, regardless of what
  `Content-Length` claimed or whether it was present at all (chunked
  transfer-encoding, or a client that simply omits/lies about the
  header, are both covered by this path, not just the fast-path header
  check).
- **Only once the body is confirmed within budget** are the buffered
  bytes handed to the platform's own multipart parser, via a freshly
  constructed `Request` (`new Request(url, { headers, body })`, headers
  trimmed to just `content-type` so the boundary is preserved) —
  `.formData()` on that object does the actual boundary/part parsing,
  completely unchanged from before. This avoids writing a hand-rolled
  multipart parser and any new dependency; it only changes how the raw
  bytes are collected first.
- No new infrastructure, no new dependency, no `next.config.js` change:
  this works entirely within a standard Node.js App Router route
  handler using Fetch API primitives (`Headers`, `ReadableStream`,
  `Request`) that are already available in this runtime.

**Budget used:** `MAX_UPLOAD_REQUEST_SIZE` (new export in
`src/lib/attachmentPolicy.js`) = `MAX_FILE_SIZE` (5MB) + a 64KB
allowance for multipart overhead (boundary delimiters, per-part
headers, the filename) — comfortably covers a legitimate single-file
upload's overhead without meaningfully raising the effective limit on
actual file content.

**Route change:** the size-limited read now happens *before*
`connectDB()`/`getTaskAccess()` (previously the task lookup ran first).
An oversized request is now rejected without a database round trip at
all, on top of no longer being fully read into memory. Everything after
that point — the `MAX_FILE_SIZE` per-file check, the `MAX_ATTACHMENTS_PER_TASK`
count check, the `MAX_TOTAL_ATTACHMENTS_SIZE` per-task check, MIME +
extension + magic-byte validation, filename sanitization, and the
authorization check itself — is untouched, in its original order,
using the exact same helpers as before (`getTaskAccess`,
`sanitizeFilename`, `validateAttachmentFile`, `attachmentPolicy.js`
constants). `PayloadTooLargeError` maps to a `413` with the existing
"File size must not exceed 5MB" message; a still-malformed/truncated
multipart body (parse failure) keeps the original `400` behavior.

**Why not just check `file.size` sooner:** `file.size` only exists
*after* `formData()` has already parsed the whole body — there's no way
to see it earlier. This is also why the fix doesn't rely solely on the
client-declared value anywhere: the streaming byte-count is the actual
enforcement, and it's what a hostile client can't spoof (unlike
`Content-Length`, which is merely a fast-path optimization here, not a
trust boundary).

## Not changed (checked, already correct)
- Per-file (5MB), per-task total (8MB), and per-task count (20) limits —
  same constants, same checks, same order, still all enforced after the
  new size guard.
- MIME + extension pairing and magic-byte signature validation
  (`validateAttachmentFile` in `lib/attachmentPolicy.js`) — untouched.
- Filename sanitization (`sanitizeFilename`) — untouched.
- Authorization (`getTaskAccess`) — untouched; still checked before any
  attachment is read, validated, or persisted.
- The download route (`GET .../attachments/[attachmentId]`) — still the
  only place that loads `attachments.data`, via its explicit
  `includeAttachmentData: true` opt-in; not touched by this phase.
- The delete route's `attachment.deleteOne()` logic — unchanged; only
  its unrelated, unused `findByIdAndDelete` follow-up query (Issue 3,
  above) was touched.
- Response payloads: confirmed (by reading `serialize.js`) that
  `toAttachmentDTO()`/`toTaskDTO()` never included `data` even before
  this phase — the bug was queries loading it needlessly into memory,
  not a data leak in the API response itself.

## New files
- `src/lib/limitedFormData.js` — `readFormDataWithLimit(req, maxBytes)`
  and `PayloadTooLargeError`, described above.

## Files changed
- `src/app/dashboard/page.jsx` — added `.select("-attachments.data")`
  to the dashboard's task query.
- `src/app/api/projects/route.js` — added `.select("-attachments.data")`
  to the project-list task query.
- `src/app/api/tasks/[id]/route.js` — added `.select("-attachments.data")`
  to the `DELETE` route's now-unused-but-still-loaded
  `findByIdAndDelete` result.
- `src/app/api/tasks/[id]/attachments/route.js` — replaced the raw
  `req.formData()` call with `readFormDataWithLimit(req,
  MAX_UPLOAD_REQUEST_SIZE)`; moved this check to before `connectDB()`/
  `getTaskAccess()`; added a `413` response for `PayloadTooLargeError`.
- `src/lib/attachmentPolicy.js` — added `MAX_UPLOAD_REQUEST_SIZE`
  (`MAX_FILE_SIZE` + 64KB multipart-overhead allowance).

## Commands run
```
npm install
npm run build
node __manual_test__/01-pure-ordering.test.cjs
node __manual_test__/02-mongo-transaction.test.cjs
node __manual_test__/03-column-order-retry.test.cjs
node __manual_test__/04-done-column-transaction.test.cjs
node __manual_test__/05-task-create-transaction.test.cjs
node __manual_test__/06-limited-form-data.test.cjs
```

## Validation results
- `npm run build` — succeeds (`✓ Compiled successfully`), all 16 API
  routes + 8 pages generated, no type/lint errors. (Required dummy
  `MONGODB_URI`/`NEXTAUTH_SECRET` values in `.env` for the build's
  page-data-collection step, which imports `lib/mongodb.js`/
  `lib/authSecret.js` at module scope — no live database connection is
  opened during `next build`.)
- New test file `__manual_test__/06-limited-form-data.test.cjs` — 7/7
  assertions passed, run directly against `lib/limitedFormData.js`
  using real Web `Request`/`Headers`/`ReadableStream` primitives (no
  fakes needed — this module has no Mongoose/Next.js/next-auth
  dependency):
  - a normal small multipart upload still parses correctly and the file
    content round-trips intact;
  - a declared `Content-Length` already over budget is rejected without
    ever opening the body stream (verified via a `body` getter that
    flags if it was touched);
  - an oversized body **with no `Content-Length` header** is still
    rejected (the streaming enforcement, not just the header fast
    path);
  - an oversized body where `Content-Length` **lies** (claims 10 bytes,
    sends 2MB) is still rejected — confirms the fix doesn't trust the
    client-declared value;
  - a file exactly at the byte budget is accepted (no off-by-one);
  - a malformed/garbage multipart body throws a plain error, not a
    `PayloadTooLargeError` (so the route's existing 400-vs-413 branching
    stays correct);
  - a request with no body stream at all falls through to the original
    `req.formData()` call untouched.
- Previously-passing Phase 2 test suites
  (`01`–`05`) re-run and still pass in full (33/33 assertions) —
  confirms nothing in the ordering/transaction/concurrency work was
  disturbed by this phase.
- Manual code review (not executable without a live MongoDB instance —
  see "Remaining issues" below) for: normal upload under 5MB, file
  exactly at the 5MB limit, file over the limit, total 8MB task limit,
  20-attachment count limit, invalid MIME, mismatched extension,
  invalid magic bytes, attachment download, attachment delete, dashboard
  with attachment-bearing tasks, and project list with attachment-
  bearing tasks — traced each path through the (unchanged) validation
  order in `attachments/route.js` and the (fixed) `.select()` calls
  above; every one resolves the same way it did before this phase,
  except that oversized/garbage requests are now rejected earlier and
  cheaper.
- Did not claim to have executed anything against a real MongoDB
  Atlas/replica-set instance — none was reachable from this sandbox
  (see Remaining issues).

## Remaining issues / manual test matrix for a live environment

This sandbox has no network access to a real MongoDB instance, so the
following need to be exercised against the actual Atlas cluster before
relying on them in production:

| Scenario | Expected |
|---|---|
| Upload a file under 5MB with a real session/task | `201`, task now shows the attachment (no `data` in the response) |
| Upload a file exactly at 5MB | `201` |
| Upload a file over 5MB, `Content-Length` present and accurate | `413`, rejected before the body is fully read |
| Upload a file over 5MB with `Content-Length` omitted (e.g. via `curl -H "Transfer-Encoding: chunked"` or a client that doesn't send it) | `413`, rejected once ~5MB has actually arrived, not after full receipt |
| Upload a file over 5MB with a spoofed/low `Content-Length` header | `413` — streaming enforcement catches what the header hid |
| Upload the 21st attachment to a task already at 20 | `400`, "maximum of 20 attachments" |
| Upload a file that would push a task's total over 8MB | `400`, "total attachment storage limit" |
| Malformed multipart body (e.g. truncated boundary) | `400`, "couldn't be read" |
| `POST` with no `file` field | `400`, "No file was uploaded" |
| Upload with a MIME type not on the allowlist | `400`, "Unsupported file type" |
| Upload a `.pdf`-named file with `image/png` content-type (mismatched extension) | `400`, "Unsupported file type" |
| Upload a `.png`-named/typed file whose bytes don't start with the PNG signature | `400`, "file's contents don't match its file type" |
| Download an existing attachment | `200`, correct bytes, `Content-Disposition`/`Content-Type`/`X-Content-Type-Options` headers, no regression from this phase (route untouched) |
| Delete an existing attachment | `200`, attachment removed, task response has no `data` field anywhere |
| Load `/dashboard` with tasks that have attachments | Page renders correctly; **confirm via server logs / a temporary log line / MongoDB profiler that the task query's returned documents do not include `attachments.data`** — this is the actual regression this phase fixes and can't be observed from the HTTP response alone, since the DTO layer already excluded it |
| Load `GET /api/projects` with tasks that have attachments | Same as above — response shape unchanged, but the underlying query should no longer fetch `data` |
| Under real network conditions, confirm a very large POST to `/api/tasks/[id]/attachments` is rejected quickly and doesn't spike server memory (e.g. via a load test with a multi-hundred-MB body) | Connection reset/`413` well before the full body is received; no corresponding memory spike on the server |

- As in prior phases, MongoDB transaction/replica-set behavior
  unrelated to this phase's changes is unaffected and was not
  re-verified live here.
- The 64KB multipart-overhead allowance in `MAX_UPLOAD_REQUEST_SIZE` is
  a static estimate based on this endpoint's actual usage (a single
  `file` field, no other form fields — confirmed in
  `TaskDetailDialog.jsx`); if the upload form ever grows additional
  fields, this constant should be revisited.

---

# Phase 2 — Concurrency & Ordering Fixes

## Scope
Three targeted concurrency fixes, all in the Kanban ordering/board area:
the done-column invariant, column creation ordering, and task creation
ordering. No changes to authentication, registration, email,
attachments, UI/visual design, or framework version. Every fix below was
made as the smallest change that closes the actual race, not a rewrite.

## Issue 1 — Done column wasn't atomic

**File:** `src/app/api/projects/[id]/columns/[columnId]/route.js`

The PATCH handler used to do two separate writes: `column.save()` to set
`isDoneColumn: true`, then `Column.updateMany()` to clear the flag on
every other column in the project. If the second write failed, or a
second request landed in between, the project could end up with two
done columns (the progress bar elsewhere assumes at most one) or an
unpredictable mix under a race between two requests marking two
*different* columns done.

**Fix:** Both writes now happen inside one MongoDB transaction, via a
new shared `withOptionalTransaction` helper (see "Refactor" below). If
`updateMany` fails, the update to the target column is rolled back too.
For two concurrent requests marking different columns done, both
transactions touch the same documents (each one's `updateMany` reaches
into the column the other is updating), so MongoDB aborts one as a
write conflict and the driver's own `session.withTransaction()` retries
it automatically against the now-committed state — whichever request
"wins" is nondeterministic, but the result is always exactly one done
column, never zero-via-corruption or two.

The update itself was rewritten from "fetch a Mongoose document, mutate
it, call `.save()`" to `Column.findOneAndUpdate()` with an explicit
`$set`. This isn't cosmetic: `document.save()` clears the document's
"modified paths" once a save is *attempted*, so if the transaction is
retried (exactly the scenario above), a second `.save()` call on the
same in-memory document can silently no-op instead of re-sending the
change — the transaction would commit "successfully" without the
update actually taking effect. `findOneAndUpdate` carries no such
state; every retry of the callback re-issues the identical write. This
was caught by writing a test that simulates a driver-level retry (see
Verification) — it failed against an earlier version of this fix that
used `.save()`, which is exactly the bug class this rewrite avoids.

**Preserved:** unmarking a column (`isDoneColumn: false`) still only
changes that one column — a project having zero done columns is valid
and unchanged. Renaming and reordering via the same PATCH endpoint are
unaffected (still validated the same way, just applied via `$set`
instead of document mutation).

## Issue 2 — Concurrent column creation could duplicate `order`

**Files:** `src/models/Column.js`, `src/app/api/projects/[id]/columns/route.js`

The create route read the current max `order` and inserted at `max + 1`
as two separate operations — two concurrent requests could read the
same max and insert two columns at the same order.

Checked whether this actually reaches the UI: **yes.** Unlike tasks
(see Issue 3), nothing re-sorts columns with a tiebreak — the Mongo
query (`Column.find(...).sort({order:1})`), `serialize.js`
(`columns.map(toColumnDTO).sort((a,b)=>a.order-b.order)`), and
`KanbanBoard.jsx` (`columns.sort((a,b)=>a.order-b.order)`) all used a
bare numeric sort. MongoDB doesn't guarantee a stable order for ties,
so two columns sharing an `order` value could visibly swap position
between reloads.

**Fix:**
- Added a unique compound index, `{ project: 1, order: 1 }`, to the
  `Column` schema — turns the race into a duplicate-key error instead
  of silently corrupting sort order.
- `columns/route.js` now retries (up to 5 attempts) with a freshly read
  max whenever that duplicate-key error occurs, so the race is
  invisible to the user — no lock, no error surfaced, just a retry
  against the state the other request just committed. The retry helper
  (`createColumnWithNextOrder`) is exported for testability, matching
  this codebase's existing pattern of extracting testable logic.
- Added `src/lib/columnOrderCompare.js` (`compareColumns`), mirroring
  the existing `compareTasks`, and switched all three sort sites above
  to use it. This is defense-in-depth: the unique index prevents new
  duplicates, but this keeps display order deterministic regardless
  (e.g. against any row that predates the index). `toColumnDTO` now
  also exposes `createdAt` so the client-side sort has the same
  tiebreak data tasks already expose.
- The project-creation route's `Column.insertMany()` for a new
  project's three starter columns is untouched — it already assigns
  distinct orders (0, 1, 2) in one call, so it can't collide.

**Not changed:** the column PATCH endpoint's `order` field is still a
free-form integer settable via the API (unused by the current UI, which
has no column drag-reorder) — with the new unique index, manually
setting it to a value another column already holds in the same project
will now surface as a 409 instead of silently creating a duplicate.
This is a stricter, not weaker, guarantee, and matches how duplicate
values are already handled everywhere else in this app (see
`mongoErrors.js`).

## Issue 3 — Concurrent task creation could duplicate `order`

**Files:** `src/lib/taskOrdering.js`, `src/app/api/tasks/route.js`

Audited `nextOrderForNewTask()`, `compareTasks()`, and every place tasks
are sorted before deciding what to change, per the instruction not to
weaken this invariant silently or reintroduce floating-point ordering.

**Finding: the existing "duplicate orders are a tolerated cosmetic tie"
design is genuinely safe as implemented**, unlike the column case above:
every place the app displays or reasons about task order —
`KanbanBoard.jsx`'s sibling list for drop-target calculation, its
per-column render list, and `planTaskMove()`'s sibling read — sorts
with `compareTasks`, which tiebreaks on `createdAt` then `_id` before
falling back to nothing. Two tasks sharing an `order` value therefore
always render in the same relative position across every reload and
every code path, and the next rebalance in that column (triggered
whenever two neighbors' orders are within 1 of each other, including a
tie) cleans it up. Confirmed via `computeMovePlan` test cases that a
tied pair of neighbors (gap of 0) triggers the same rebalance path as an
adjacent-order gap (gap of 1) — it isn't a special case that could be
missed.

Given that, adding a uniqueness constraint (the column fix's approach)
was deliberately **not** applied here: it would contradict the
documented design rationale in `taskOrdering.js`, and — unlike column
creation, which has no reorder UI — could surface a confusing
duplicate-key error to the user in the middle of an ordinary drag
operation if a concurrent move computed the same order first.

**Fix applied instead:** `nextOrderForNewTask()` (the max-order read)
and `Task.create()` (the insert) now run inside one transaction via the
same `withOptionalTransaction` helper the task-move endpoint already
uses. This doesn't make two truly simultaneous creates immune to
computing the same order (still a tolerated, self-healing tie, as
above) — what it fixes is a create racing an in-flight rebalance: before
this change, a plain read outside any session could observe a
column mid-rebalance (some sibling rows renumbered, others not yet) and
hand out an order based on that inconsistent snapshot. Inside a
transaction, a create can only ever see a rebalance as fully applied or
not yet started.

**Not changed:** `ORDER_STEP`, `computeMovePlan()`, `compareTasks()`,
and the rebalance logic in `planTaskMove()` are untouched — no
floating-point ordering introduced, no change to when a rebalance
triggers.

## Refactor: shared transaction helper

`withOptionalTransaction()` (session/retry/fallback plumbing for a
MongoDB transaction, with a plain-write fallback for a standalone
`mongod` in local dev) previously lived only in `lib/taskOrdering.js`,
written for task moves. It's now in `src/lib/mongoTransaction.js`, with
`lib/taskOrdering.js` re-exporting it unchanged for backward
compatibility — every existing caller (`tasks/[id]/route.js`) still
imports it from the same place. This is what let the done-column route
(Issue 1) and the task-create route (Issue 3) reuse the exact same
tested transaction/retry behavior instead of duplicating it.

## Verification

**Automated (`__manual_test__/`, not part of the shipped app — see
`__manual_test__/README.md`):** 26 assertions across 5 files, all
passing, run against the real, unmodified route/lib files (only
Mongoose/next-auth/Next.js dependencies mocked, via `@babel/register` +
the same `@/*` alias `jsconfig.json` defines):

- `01-pure-ordering.test.cjs` (9) — `compareColumns`, `compareTasks`,
  and `computeMovePlan`, including a duplicate-order-neighbors case
  confirming a tie triggers rebalance exactly like an adjacent-order
  gap does.
- `02-mongo-transaction.test.cjs` (5) — `withOptionalTransaction`'s
  happy path, error propagation (no silent partial success), a
  driver-retry scenario, the standalone-`mongod` fallback, and that an
  unrelated error isn't swallowed by that fallback.
- `03-column-order-retry.test.cjs` (4) — no-contention create, a
  simulated racer taking the computed order first (retry lands on a
  still-distinct order, verified no duplicate exists anywhere in the
  project afterward), retry exhaustion rethrowing rather than looping
  forever, and a non-collision error not being retried.
- `04-done-column-transaction.test.cjs` (5) — marking a column done
  clears every other column atomically; unmarking touches only one
  column; a failed `updateMany` rolls back the whole update (explicitly
  asserts the pre-existing done column is *not* disturbed and the
  target column's flag was *not* committed); a 5-step repeated-toggle
  sequence never exceeds one done column at any point; and the
  retry-safety test described in Issue 1 (a simulated driver retry
  still produces the correct committed state).
- `05-task-create-transaction.test.cjs` (3) — order computed as
  `max + ORDER_STEP` inside the transaction, empty-column start value,
  and that a failure mid-transaction leaves no partial task committed.

**`npm install`** — OK (227 + testing devDependencies, 0 vulnerabilities
via `npm audit`, prod and full).

**`npm run build`** — OK, compiles cleanly, all 16 routes generated (run
after every fix in this phase, not just once at the end).

**Manually reasoned through, not automatable here (see below for why):**
- Two users simultaneously marking different columns as done → covered
  by the transaction's write-conflict-and-retry semantics (Issue 1);
  the retry-safety test is the closest automated proxy available
  without a live replica set.
- Repeated done-column toggling → covered by the 5-step automated test.
- Concurrent column creation → covered by the retry-loop test with a
  simulated interleaving racer.
- Concurrent task creation → covered by the design audit above
  (tolerated tie, resolved everywhere by `compareTasks`) plus the
  transaction-wrapping test.
- Task movement into a column while another task is created → both
  paths now go through `withOptionalTransaction`; a create can't
  observe the move's rebalance half-applied, and vice versa. Not
  independently re-tested here — `planTaskMove()` and its transaction
  usage were not modified this phase.
- Task reorder and rebalance, task ordering after deletions → both
  paths (`computeMovePlan`, `nextOrderForNewTask`) are unmodified this
  phase and covered by existing/regression tests in
  `01-pure-ordering.test.cjs`.

**Known limitation, same as the prior phase:** this sandbox has no
network access to download a `mongod` binary, so none of the above ran
against a real MongoDB replica set — `mongoose.startSession()` /
`session.withTransaction()` are mocked with an in-memory
buffer-until-commit simulation faithful enough to test that the
*application code* scopes every write of an operation to one session
and correctly propagates a mid-transaction failure, but this does not
exercise MongoDB's actual server-side write-conflict detection between
two truly concurrent transactions. Recommended before relying on this
in a demo — against a real Atlas cluster:
1. Two browser tabs (or two `fetch` calls fired back-to-back) marking
   different columns done in the same project — confirm exactly one
   ends up done, in both possible "who wins" orders.
2. A small script firing 5–10 concurrent `POST` requests to create
   columns in the same project — confirm every resulting column has a
   distinct `order` (e.g. `db.columns.aggregate([{$group:{_id:
   {project:"$project",order:"$order"}, n:{$sum:1}}}, {$match:{n:{$gt:
   1}}}])` returns nothing) and no request returns anything other than
   201.
3. Same as (2) but creating tasks in the same column — ties on `order`
   are expected and fine; confirm the board still renders a stable,
   sensible order and that dragging one of the tied tasks triggers a
   rebalance (watch the other tasks' `order` values change to clean
   multiples of 1000).
4. Drag a task into a column at the same moment a second request
   creates a new task in that column — confirm both end up present with
   distinct-enough positions that the board renders sensibly (an exact
   tie here is tolerated by design; a missing task or a 500 is not).

# Phase 1 — Registration/Invitation Transaction Fix

## Scope
Single targeted fix: the registration write sequence in
`src/app/api/auth/register/route.js` was not fully atomic. No other
files changed. No UI changes, no framework version changes, no
unrelated refactors.

## Problem
`User.create()` ran before the invitation-consumption transaction
started:

1. `User.create(...)`
2. Find active invitations
3. Start MongoDB transaction
4. `Team.updateMany(...)`
5. `Invitation.deleteMany(...)`

If step 4 or 5 failed after step 1 had already committed, the database
was left with a registered user, a dangling invitation, and no team
membership — with no way to retry, since the email now appeared
"already registered." The prior changelog's claim that invitation
consumption was "transactionally safe" only covered steps 4–5; the
account creation itself sat outside that guarantee.

## Fix
`src/app/api/auth/register/route.js`: moved `User.create()` inside the
same `session.withTransaction()` block as the invitation lookup,
`Team.updateMany()`, and `Invitation.deleteMany()`. The sequence is now:

1. Pre-check for an existing user (fast path, unchanged; a real
   duplicate is still caught by the unique index below regardless).
2. Start a session and open one transaction that:
   - creates the user (`User.create([...], { session })`),
   - reads active invitations for that email with `.session(session)`,
   - if any are active, adds the user to those teams via
     `$addToSet` and clears every invitation (active + expired) for
     that email, all scoped to the same session.
3. Only after the transaction resolves successfully is a verification
   token generated and the verification email sent (best-effort, as
   before — a send failure is caught and logged, not surfaced as a
   registration failure).

A duplicate-key error (race between the pre-check and the transactional
`create()`) aborts the transaction before anything commits and is
mapped to the existing 409 response. Any other failure inside the
transaction aborts it the same way, so the user document is never left
committed without its corresponding invitation/membership state.

Preserved unchanged: email normalization, duplicate-email response
shape, expired-invitation semantics (an expired invitation still grants
no membership, and is only cleared once at least one active invitation
for that email exists — otherwise it's left for the TTL index, matching
prior behavior), the 14-day invitation TTL, anti-enumeration behavior
elsewhere in the auth flow, and the best-effort SMTP failure handling.

## Why this is safe under transaction retries
The MongoDB driver may re-run a `withTransaction` callback on a
transient error (e.g. a replica set stepdown mid-commit). Every
operation inside the callback here is a plain DB write scoped to
`session`; nothing with an external side effect (password hashing,
verification-token generation, email sending) happens inside it. A
retried attempt starts from an uncommitted, rolled-back state, so
re-running the callback cannot double-create a user or double-consume
an invitation.

## Verified
- `npm run build` — passes cleanly (all routes compile, static
  generation succeeds).
- A manual Node ESM test harness (`__manual_test__/`, not included in
  this deliverable) imported the real, unmodified route handler with
  only the Mongoose models, `mongoose.startSession`, and the email
  sender mocked. 29 assertions across 7 scenarios all passed:
  - no invitation
  - one active invitation
  - multiple active invitations across different teams
  - expired invitation only (no membership granted, invitation left
    for the TTL index — matches prior behavior)
  - mixed active + expired invitations for the same email (active
    grants membership, expired doesn't, both get cleared)
  - duplicate-email race (409, no duplicate user, no email sent)
  - simulated mid-transaction failure: confirmed the transaction
    reports an abort (not a commit), no verification email is sent,
    the invitation is left untouched, and the user-creation call and
    the failing write occurred inside the same single transaction
    attempt.
- Real MongoDB transaction atomicity (an actual replica-set rollback)
  was **not** verified against a live database in this environment —
  the sandbox has no network access to download a `mongod` binary for
  `mongodb-memory-server`. The manual test harness verifies that the
  application code issues all writes inside one `startSession()` /
  `withTransaction()` block correctly scoped with `{ session }`, which
  is what makes MongoDB's own atomicity guarantee apply; it does not
  itself exercise that guarantee against a real server. Live
  replica-set verification (per the manual test matrix from prior
  phases) is recommended before relying on this in a demo.

# Final Audit — Changelog

## Scope
Final correctness/security/data-integrity audit across the whole
cumulative codebase. No new features, no UI redesign, no framework
changes, no rewrites of working architecture. `npm run build` and
`npm audit --omit=dev` were run as gates; the app was read file-by-file
against the security, data-integrity, and frontend checklists from the
audit brief. See `FINAL_AUDIT.md` for the full checklist results.

## Fixes
- **`auth/register`, `auth/resend-verification`**: `sendVerificationEmail()`
  was called unguarded in both routes. If SMTP is configured but a send
  fails (bad credentials, provider outage), the error was previously
  uncaught: in `register`, the user account (and any invitation
  memberships) is already committed by that point, so the request would
  wrongly surface as a failed registration for an account that actually
  exists; in `resend-verification`, an uncaught throw would also produce a
  different response shape for "account exists but email failed" than for
  "no account", undermining that route's anti-enumeration guarantee.
  Both now catch and log the send failure and continue, matching the
  best-effort pattern already used for team-invite emails in
  `teams/[id]/members`.

## Confirmed correct, no changes needed
Every item on the audit checklist below was verified by reading the
actual implementation, not assumed from prior changelogs:
- Centralized `authz.js` access checks (project/task/team) are used
  consistently by every route; no duplicate or inconsistent
  authorization logic was found.
- No response path returns `passwordHash`, a verification token, or
  attachment `data` — `lib/serialize.js` DTOs are the only shape sent to
  the client, and every attachment-bearing query explicitly excludes
  `attachments.data` except the single download route, which requires
  the same access check as everything else.
  `X-Content-Type-Options: nosniff` is set on that response.
- Every API route checks `getServerSession` before touching the
  database, and every resource route re-checks authorization
  (manager/member/assignee rules) before reading or mutating.
- `isValidObjectId()` guards every route param and body field that
  reaches a Mongoose query, so a malformed id 400s instead of throwing
  an uncaught `CastError`; `validateOptionalDate()` does the same for
  date input.
- `withMongoErrorHandling()` / `mongoErrorResponse()` never forward an
  error's message, stack, or driver fields to the client — only a fixed
  set of generic, safe strings.
- Attachment uploads are capped by size (5MB/file), count (20/task), and
  running total (8MB/task) server-side, with MIME+extension+magic-byte
  validation, so the limits can't be bypassed by a lying `Content-Type`
  or a renamed file.
- Project creation (with its default columns), project deletion (with
  its columns/tasks), member removal (with assignee cleanup), and
  registration's invitation consumption (with invitation cleanup) all
  run inside a single Mongo transaction each — verified by reading each
  route, not just the changelog claims from prior phases.
- Kanban ordering (`taskOrdering.js`) still uses integer ranks with
  gap-exhaustion rebalancing; no floating-point ordering logic has crept
  back in anywhere.
- Frontend mutation call sites (`KanbanBoard`, `TaskDetailDialog`,
  `NewTaskModal`) all clear their loading/submitting flag in a `finally`
  block guarded by an `isMounted()` check, so a failed request can't
  leave a button stuck or update state after unmount.
- No `console.log`, `TODO`, or `FIXME` markers, and no raw `fetch()`
  calls to internal API routes outside `apiFetch`, were found anywhere
  in `src`.

## Remaining known limitations (unchanged from prior phases, not fixed here)
- Live-database behavior — TTL sweep timing on expired invitations, and
  concurrent drag-and-drop against a real Atlas replica set — still
  needs to be exercised against a real cluster; this can't be verified
  in a sandboxed build-only environment. The manual test matrices
  written into earlier changelog entries still apply.

---

# UI, Accessibility & Responsive Hardening — Changelog

## Scope
UI-only: keyboard accessibility, accessible labeling, dialog/focus
behavior, mobile layout, theme/hydration correctness, and visual
consistency across the app. No backend routes, business rules,
authentication/security logic, database models, or the Kanban ordering
strategy were touched, and no UI framework was introduced — everything
below stays inside the existing MUI-based design.

## Keyboard accessibility
- **`TaskCard`**: cards are now focusable (`role="button"`, `tabIndex=0`)
  and open with Enter/Space, so a keyboard-only user can reach and open
  any task without dragging. The per-card delete button is now revealed
  on keyboard focus as well as hover (previously hover-only, so it was
  effectively unreachable by keyboard even though it was technically
  tabbable). Dragging itself has no keyboard equivalent — that gap is
  covered by the existing "Column" field inside the task dialog, which
  lets a keyboard-only user move a task between columns without a drag.
- **`ColorSwatchPicker`**: swatches were plain `<Box onClick>` elements
  with no keyboard access at all. Rewritten as real `<button>` elements
  with `aria-label`/`aria-pressed` and a visible focus ring.
- **`KanbanBoard`**: the "Add task" and "New column" triggers were
  click-only `<Box>` elements; both are now real buttons. The inline
  column-rename field and the new-column field now close on **Escape**
  without saving (previously no way to back out once opened except
  clicking away). Renaming to the exact same name, or committing an
  empty value, no longer fires a pointless PATCH. The column's "..."
  menu button, and the column name itself (a rename shortcut), now have
  accessible labels and are keyboard-operable. The horizontally
  scrolling board region is keyboard-focusable so arrow keys can scroll
  it without a pointer.
- **`ConfirmDialog`**: **Cancel**, not the destructive action, now gets
  initial focus, so pressing Enter right after a delete dialog opens
  can't confirm the delete by reflex.

## Accessible labels
- **`Navbar`**: nav links and "Sign out" hide their text label below the
  `md`/`sm` breakpoints (icon-only) but had no `aria-label`, so a screen
  reader announced them with no accessible name at those sizes. All now
  carry explicit labels; the active nav item also gets `aria-current`.
- **`ThemeToggleButton`**: label now matches the action ("Switch to dark
  mode" / "Switch to light mode") instead of a static "Toggle dark mode".
- **`TaskDetailDialog`**: attachment download/delete icon buttons had a
  bare "Download"/"Delete" label with no way to tell which file it acted
  on when a task had more than one attachment — now include the filename.
- **Team member/invitation chips**: the delete ("x") icon on member and
  pending-invitation chips had no accessible name (MUI's Chip doesn't
  label it by default); both now use `titleAccess` to announce what
  they'll do (e.g. "Remove Priya from the team").

## Avatar fallbacks
- New shared `src/lib/avatarInitial.js`, used everywhere a one-letter
  avatar is rendered (navbar, task assignees, team member chips/avatars).
  Previously each call site did `name.slice(0, 1)` directly, which
  renders a blank avatar for an empty or whitespace-only name; the shared
  helper falls back to "?" and normalizes case.

## Mobile & overflow
- **`TaskDetailDialog`** and **`NewTaskModal`** now go full-screen below
  the `sm` breakpoint instead of a cramped, margined dialog on phones.
- Long **project names**, **task titles/descriptions**, **attachment
  filenames**, and **confirmation-dialog messages** can no longer force
  horizontal overflow — added `overflowWrap`/flex `minWidth: 0` fixes at
  each of those spots.
- **Chip labels** (team names, member names, invitation emails) now
  truncate with an ellipsis instead of stretching the chip — added once,
  as a theme-level default (`MuiChip` `label` style), rather than
  per-instance.

## Theme, hydration & motion
- **Initial theme flash removed**: the app previously always rendered
  "light" for the first paint, then corrected to the saved/system theme
  after mount — visible as a flash on a dark-mode visit. `layout.jsx` now
  runs a small blocking inline script that sets `data-theme-mode` on
  `<html>` before hydration, and matching CSS in `globals.css` paints the
  right background immediately; `ThemeModeProvider` reads that same
  attribute on mount instead of recomputing it, so there's one source of
  truth. `<html>` carries a narrowly-scoped `suppressHydrationWarning`
  for this one attribute, which React itself never renders.
- **Safer transition-timeout handle**: the dark/light crossfade's timeout
  ID was stored on `window.__themeTransitionTimeout`, a bare global any
  other script could collide with or read. Now held in a component-scoped
  `ref` instead.
- **`prefers-reduced-motion`** is now respected globally — every
  transition/animation collapses to effectively instant for anyone who's
  asked their OS for reduced motion.

## Consistency
- **Project delete** (`dashboard/projects/[id]/page.jsx`) closed its
  confirmation dialog and reported the error on the page underneath even
  on failure — the only destructive action in the app that didn't keep
  the dialog open with the reason inline (that pattern was already
  applied everywhere else: task/column/member delete). Brought in line.
- Added a `<main>` landmark around the dashboard's page content.

---

# Frontend Request Reliability — Changelog

## Scope
Client-side only: request handling, loading states, error handling, and
race conditions in `login`, `register`, `verify-email`, the dashboard
projects/teams pages, `KanbanBoard`, `TaskDetailDialog`, `NewTaskModal`,
`ConfirmDialog`, and `Navbar`. No backend routes, business rules,
dependency versions, MongoDB models, or attachment storage were touched.
No visual/design changes.

## New shared helper
- **`src/lib/clientAsync.js`** — two small hooks used throughout the pages
  below instead of duplicating the same guard in each file:
  - `useIsMounted()` — lets an async handler check, after an `await`,
    whether its component is still mounted before calling `setState`.
  - `useLatestRequest()` — tags each call to a reload function with a
    ticket; only the response for the most recently started call is
    allowed to apply its result, so a slow, older request can't overwrite
    state set by a faster, newer one.

## Bugs fixed
- **`verify-email/page.jsx`**: the verification request could fire twice
  for the same token (e.g. an effect re-run) and, because the token is
  single-use, the second call would fail and overwrite a real success
  with a reported failure. The effect now runs at most once per token.
- **`dashboard/teams/page.jsx`**: creating a team together with its first
  project was one try/catch — if the project step failed, the team had
  already been created, but the form reported "Couldn't create the team"
  and stayed in a state where resubmitting could create a second,
  duplicate team. The two steps are now handled separately: a project
  failure surfaces as a distinct notice ("<Team> was created, but the
  project couldn't be created: …") and the team list is refreshed instead
  of implying the whole operation can be retried from scratch.
- **Confirm-dialog error visibility** (`KanbanBoard` task/column delete,
  `TaskDetailDialog` task/attachment delete, team member removal): these
  previously closed the confirmation dialog even when the request failed,
  with the error only shown behind it (a page-level `Alert` or a
  `Snackbar` the closing dialog had been covering) — for column deletion
  in particular, "column still has tasks" is the *expected* failure mode,
  so this was the common case, not an edge case. `ConfirmDialog` now
  accepts an `error` prop and stays open on failure with the reason shown
  inline; it now also only closes automatically on success.

## Reliability hardening
- **Stale-response guarding**: `dashboard/projects/page.jsx`,
  `dashboard/projects/[id]/page.jsx` (`load` also runs as `onChanged`
  after every Kanban action, so reloads can overlap), `dashboard/teams/
  page.jsx`, and `dashboard/teams/[id]/page.jsx` now use
  `useLatestRequest()` so an in-flight reload can't clobber state from a
  newer one.
- **Unmount guarding**: `login`, `register`, `verify-email`, both project
  pages, both team pages, `KanbanBoard`, `TaskDetailDialog`, and
  `NewTaskModal` now check `useIsMounted()` before `setState` in async
  handlers, so closing a dialog or navigating away while a request is in
  flight no longer risks a late state update.
- **Consistent 401 handling**: `dashboard/projects/[id]/page.jsx` and
  `dashboard/teams/[id]/page.jsx` now redirect to `/login` on a 401
  instead of showing a generic "couldn't load" error (matching the
  existing behavior on the projects/teams list pages).
- **Double-submit / double-action guards added**:
  - `KanbanBoard`: a task can't be dropped again while its previous move
    is still in flight (per-task guard); the "add column" form and
    column rename (which can fire from both blur and Enter) each got a
    re-entrancy guard so a fast double-trigger can't send two requests.
  - `Navbar`: sign-out button disables itself after the first click.
  - `NewTaskModal`: Cancel is disabled while a submission is in flight.
- **`dashboard/teams/[id]/page.jsx`**: separated the "remove member"
  error from the general page error state, so an invite-form error and a
  remove-member error can no longer overwrite each other, and both are
  cleared appropriately when a new attempt starts.

## Verification
- `npm run build` passes cleanly (compiles, lints, and type-checks with
  no errors).
- Manually traced every async handler in the files above for try/catch/
  finally coverage, loading-state reset on both success and failure, and
  correct behavior on repeated clicks.

---



## Scope
Teams, members, and invitations only: `Team` model, `Invitation` model,
`/api/teams`, `/api/teams/[id]`, `/api/teams/[id]/members`,
`/api/teams/[id]/invitations/[invitationId]`, invitation consumption in
`/api/auth/register`, `TeamsPage`, and `TeamDetailPage`. Authentication
token architecture, project-level authorization rules (beyond what's
needed to keep team membership consistent), Kanban ordering, and the
attachment implementation were not touched.

## Audit findings

Several of the items on the audit list were already correctly handled by
the existing code and needed no change:
- The team manager can never be removed (`DELETE /members` already
  rejects `removeUserId === team.manager`).
- Invitation cancellation was already scoped to the exact
  `{ _id: invitationId, team: teamId }` pair, and `deleteOne` with no
  match is already a safe no-op (no error if the invitation is already
  gone).
- Pending invitations were already hidden from non-manager team members
  (`GET /api/teams/[id]` only queries `Invitation` when `isManager`).
- Registration's invitation consumption was already wrapped in a
  transaction (`Team.updateMany` + `Invitation.deleteMany`), and already
  keyed strictly on the exact normalized email — so an invited address
  registering under a different (even visually similar) email was never
  auto-added, and team membership was never granted just from knowing an
  invitation's sign-up link (the link carries no token; it only
  pre-fills the registration form).

The following gaps were found and fixed:

## Files changed

- **`src/lib/validation.js`** — `validateEmailInput()` re-implemented its
  own `trim().toLowerCase()` instead of calling the shared
  `normalizeEmail()` helper. Two normalization implementations that
  happen to agree today can silently drift apart later (e.g. if one adds
  Unicode normalization and the other doesn't); it now delegates to
  `normalizeEmail()` so every code path — registration, login,
  verification, and now team invites — normalizes identically.

- **`src/models/Invitation.js`** — added `expiresAt` (default: 14 days
  from creation) plus a TTL index (`expireAfterSeconds: 0`) so MongoDB
  physically removes an invitation once it expires, instead of it sitting
  in the collection forever. Existing invitation documents written before
  this field existed simply have no `expiresAt` and never expire — a safe
  default, since every query that matters now filters on `expiresAt`
  explicitly rather than relying on the field's mere presence.

- **`src/app/api/teams/[id]/members/route.js`**:
  - **`POST` (add member)** — an *existing user* is now added via
    `Team.updateOne({...}, { $addToSet: { members: id } })` instead of
    `team.members.push(id); team.save()`. The previous check-then-push
    had a race: two concurrent invites for the same user could each pass
    the "not already a member" check before either write landed, leaving
    a duplicate id in `members`. `$addToSet` is atomic at the database
    level, and a `modifiedCount === 0` result (meaning nothing changed
    because they were already in the set) is now treated as the same
    409 the pre-check returns — the pre-check is kept for a fast, clear
    error message, but it's no longer the only thing preventing a
    duplicate.
  - **`POST` (invite non-user)** — an existing invitation for the same
    email+team now only blocks a new one if it hasn't expired; an
    expired invitation is deleted and replaced with a fresh one (new
    `expiresAt`) rather than permanently blocking re-invites. Sending the
    invite email is now wrapped in `try/catch`: the invitation record is
    the source of truth, so a transient SMTP failure no longer turns an
    already-successful invite into a 500 that leaves the manager
    thinking it failed (a retry would just hit the 409-on-duplicate they
    can't otherwise see).
  - **`DELETE` (remove member)** — removing a member and un-assigning
    them from that team's tasks now happen inside one
    `mongoose.startSession()` transaction: `Team.updateOne` with
    `$pull: { members: id }`, followed by `Task.updateMany` (scoped to
    every project under that team) with `$pull: { assignees: id }`. See
    "Decision: task assignees on member removal" below for why this was
    chosen over the alternatives.

- **`src/app/api/teams/[id]/route.js`** — the manager's pending-invitations
  list now filters `expiresAt: { $gt: new Date() }`, so an invitation
  that can no longer be accepted isn't shown as "pending" (it disappears
  from the list; the TTL index removes the underlying document shortly
  after, on MongoDB's own background schedule).

- **`src/app/api/auth/register/route.js`** — the invitations query used to
  decide which teams to auto-join now also filters
  `expiresAt: { $gt: new Date() }`. The subsequent `deleteMany` for that
  email is intentionally left unfiltered — it still clears *every*
  invitation for that address, expired or not, so stale rows don't
  linger waiting for the TTL sweep once the person has actually
  registered.

- **`src/app/dashboard/teams/[id]/page.jsx`**:
  - `confirmRemoveMember()` and `cancelInvitation()` now clear the
    `error` banner at the start of the attempt (previously only
    `handleInvite()` did this) — a stale error from a previous action no
    longer lingers next to a new one that might succeed.
  - `cancelInvitation()` now no-ops if a cancellation is already in
    flight (`if (cancelingInviteId) return;`), and the invitation Chip's
    `onDelete` is disabled while any cancellation is pending — closes a
    double-click window where two `DELETE` requests could fire for the
    same invitation.

## Decision: task assignees on member removal

The audit explicitly called out that this needed an intentional,
consistent answer rather than being left as undefined behavior. Three
options were considered:

1. **Leave stale assignees in place.** Rejected — a removed member would
   still show up as "assigned" on tasks in a project they can no longer
   open, which is confusing and makes the task look actionable to
   someone who can't act on it.
2. **Block removal if the member has any task assignments.** Rejected —
   this punishes the manager for a normal offboarding action and
   requires them to manually hunt down and reassign every task first,
   with no tooling in this app to do that in bulk.
3. **Automatically un-assign them from every task in that team's
   projects, atomically with the removal.** **Chosen.** This is the same
   rule `validateAssignees()` already enforces going forward (an
   assignee must currently be the project's manager or a team member) —
   removing a member and leaving them assigned elsewhere would otherwise
   put existing data in a state new writes are never allowed to create.

Implemented as a single transaction: `Team.updateOne` pulls the member,
then every project under that team is looked up and `Task.updateMany`
pulls that user from `assignees` across all of them. Both writes commit
or roll back together — a crash between them can't leave the member off
the team but still assigned to tasks (or vice versa).

## Manual test matrix

No live MongoDB instance was available in this environment (no Atlas
credentials, and no path to a local `mongod` — network egress here is
restricted to package registries, not `fastdl.mongodb.org`, so
`mongodb-memory-server` couldn't download a binary either). The changes
were validated by `npm run build` (below) plus route-by-route code
review against this matrix; please re-run these manually against a real
Atlas connection before relying on this build:

| Scenario | Expected result |
|---|---|
| Add an existing user by email | 201, `status: "added"`, user appears in `members` |
| Add the same existing user again | 409 `"This user is already a team member"` |
| Invite a non-existent email | 201, `status: "invited"`, `Invitation` row created with `expiresAt` ~14 days out |
| Invite that same email again (invitation still valid) | 409 `"This email has already been invited"` |
| Invite that same email again (invitation manually expired in DB) | 201 — old invitation replaced, new `expiresAt` |
| Register with the invited email | Registers, is auto-added to the team, invitation row is deleted |
| Register with a similar-but-different email (e.g. trailing dot, different casing that doesn't normalize the same) | Registers normally, is **not** added to any team |
| Manager removes a non-manager member | 200, member gone from `members`, gone from `assignees` on every task in that team's projects |
| Manager attempts to remove themselves (the manager) | 400 `"The team manager cannot be removed"`, no change |
| Non-manager attempts to add/remove a member | 403 |
| Non-member requests `GET /api/teams/[id]` | 403 `"Access denied"` |
| Non-manager member requests `GET /api/teams/[id]` | 200, but no `pendingInvitations` field |
| Manager cancels a pending invitation | 200, invitation gone, unrelated invitations/teams untouched |
| Manager cancels an invitation that was already removed (double-click) | 200 `{ ok: true }`, no error |
| SMTP misconfigured/unreachable while inviting a non-user | Still 201 `status: "invited"`; invitation persists; error logged server-side only |

## Commands / results

```
npm install     # 0 errors
npm run build   # ✓ Compiled successfully, all 16 API routes + 8 pages generated
node --check    # run on every edited file, no syntax errors
```

## Remaining issues / explicitly out of scope

- Project-level authorization (`projectAccessFor`, `validateAssignees`)
  was not changed beyond relying on it as the existing precedent for the
  "assignee must be a current team member" rule — no new rule was
  invented for this phase.
- Authentication token architecture (NextAuth config, verification
  tokens, `tokenVersion`) was not touched.
- Kanban ordering and attachment implementation were not touched.
- Live-database verification (races under real concurrent load, actual
  TTL-index sweep timing) could not be executed in this environment; see
  "Manual test matrix" above.

---

# Attachment Security / Storage Safety — Changelog

## Scope
Task attachments only: attachment schema, upload route, download route,
delete route, DTO serialization, and the attachment UI in
`TaskDetailDialog.jsx`. Authentication, Kanban ordering, and everything else
in the app were not touched.

## Architecture decision: keep base64-in-document storage
The existing design — attachment bytes stored as base64 inside the `Task`
document, no external file store — can safely remain for this project. The
alternative (S3-compatible storage, GridFS, etc.) would add an external
service, credentials, and a deployment step this academic project doesn't
need. What the existing design actually needed was *limits and validation
that make it safe to keep self-contained*: a hard per-file/per-task size
budget that respects base64's ~33% expansion and MongoDB's 16MB
per-document BSON ceiling, a file-count cap, and real content validation
instead of trusting client-supplied metadata. All of that is addressed
below without introducing any new service.

## Files changed
- `src/lib/attachmentPolicy.js` — **new.** Single source of truth for every
  attachment rule: size/count limits, the MIME/extension allowlist, magic-byte
  signature checks, filename sanitization, and safe `Content-Disposition`
  construction. Previously this logic was duplicated inline in the upload
  route with no signature checking and a weaker `Content-Disposition`.
- `src/models/Task.js` — `AttachmentSchema` fields are now bounded
  (`filename`/`mimeType` `maxlength`, `size` `min: 0`, all `required`), and
  the `attachments` array itself now has a schema-level max-count validator
  mirroring `MAX_ATTACHMENTS_PER_TASK`. This is defense in depth: the route
  is what actually validates an upload, but no code path — present or
  future — can now silently persist an attachment that skips those checks.
- `src/lib/authz.js` — `getTaskAccess()` takes a new `includeAttachmentData`
  option (default `false`) and projects `-attachments.data` out of the
  query unless a caller explicitly needs the real bytes. Only the download
  route opts in.
- `src/app/api/tasks/[id]/attachments/route.js` (upload) — rewritten against
  `attachmentPolicy.js`: malformed multipart bodies are now caught and
  return 400 instead of a raw 500; a per-task attachment-count limit is
  enforced; filenames are sanitized before storage; and MIME/extension
  pairing is followed by a magic-byte check against the file's actual
  bytes. The response is re-fetched with `.select("-attachments.data")`.
- `src/app/api/tasks/[id]/attachments/[attachmentId]/route.js`
  (download/delete) — download now builds its `Content-Disposition` header
  through `buildContentDisposition()` (RFC 5987, ASCII-safe fallback, no
  header-injection surface) and sends `X-Content-Type-Options: nosniff`;
  it's also the only place that now opts into loading `attachments.data`.
  Delete no longer loads or re-fetches attachment bytes it doesn't need,
  and both routes are wrapped in `withMongoErrorHandling`.
- `src/lib/mongoErrors.js` — added a case for a MongoDB document exceeding
  the 16MB BSON limit, mapped to a 413 with a clear, actionable message.
  The size caps above should make this unreachable in practice; this is
  the fallback if they're ever changed without updating each other.
- `src/app/api/tasks/route.js`, `src/app/api/tasks/[id]/route.js`,
  `src/app/api/projects/[id]/route.js` — every task/project read or
  re-fetch used to build a response now excludes `attachments.data` via
  `.select()`. Most notably, opening a project previously pulled the full
  base64 payload of every attachment on every task in that project on
  every load; it now only loads attachment metadata for the whole board.
- `src/components/TaskDetailDialog.jsx` — the file input is reset before
  processing a selection (not just after), so re-selecting the same file
  after fixing a rejected upload works reliably; an explicit `uploading`
  guard protects against a stray double-submit; the "Add file" button
  disables once the per-task attachment limit is reached; oversized files
  and the count limit are checked client-side for immediate feedback
  (still enforced server-side regardless); and the allowed types, size
  limit, and total-storage limit are shown as a persistent caption rather
  than only in the empty state.

## Attachment safety checklist (audit items → resolution)
1. **5MB per-file limit** — enforced server-side (`MAX_FILE_SIZE`), unchanged
   from before but now centralized in `attachmentPolicy.js`.
2. **Total-size limit accounting for base64 expansion** — `MAX_TOTAL_ATTACHMENTS_SIZE`
   is 8MB of raw bytes (~10.9MB base64), leaving headroom under MongoDB's
   16MB document limit for the task's other fields.
3. **Attachment count limit** — new: 20 per task
   (`MAX_ATTACHMENTS_PER_TASK`), enforced in the route and mirrored at the
   schema level.
4. **Safe filename validation** — new: `sanitizeFilename()` strips path
   components, control characters, quotes, and backslashes, and caps
   length, before a filename is ever stored.
5–6. **MIME normalization/validation** — the declared MIME type is
   lower-cased and stripped of any `; charset=...` suffix before being
   checked or stored.
7. **Extension + MIME consistency** — unchanged in spirit, now shared via
   `ALLOWED_TYPES` so upload and any future caller can't drift apart.
8. **Magic-byte inspection** — new: PNG, JPEG, GIF, WebP, PDF, zip-based
   Office formats (`.docx`/`.xlsx`/`.pptx`), and legacy OLE Office formats
   (`.doc`/`.xls`/`.ppt`) are checked against their real signature bytes,
   not just the client-supplied MIME type. Plain text/CSV have no magic
   number by design, so those get a lighter heuristic (reject if the
   content contains a NUL byte, which real text never does).
9. **Malformed/unsupported content rejected safely** — a MIME/extension
   mismatch, a signature mismatch, an empty file, or a file over the
   size/count limits all return a clean 400 with an actionable message.
10. **Safe `Content-Disposition`** — new: `buildContentDisposition()`
    sends both an ASCII-safe `filename=` fallback and an RFC 5987
    `filename*=UTF-8''...`, built from an already-sanitized filename, so
    there's no path for a filename to inject header syntax or control
    characters.
11. **No base64 in normal Task DTOs** — `toAttachmentDTO()` already never
    read `data` (unchanged); what's new is that the *queries* feeding it no
    longer pull that field out of MongoDB in the first place (see above).
12. **Download requires normal task authorization** — unchanged behavior,
    confirmed by code review: `getTaskAccess()` (project → team membership)
    gates the download route exactly like every other task route.
13. **Delete requires normal task authorization** — same as above for the
    delete route; unchanged, confirmed by review.
14. **Malformed attachment IDs handled safely** — unchanged behavior,
    confirmed by review: `isValidObjectId()` short-circuits to a 404 before
    any query runs, for both download and delete.
15. **Malformed multipart bodies handled safely** — new: `req.formData()`
    is now wrapped in try/catch and returns 400 instead of an uncaught 500.
16. **Failed uploads don't partially mutate the task** — confirmed by
    design: the new attachment is only pushed onto the in-memory Mongoose
    document; nothing is persisted until `task.save()` succeeds, so a
    validation failure or thrown error leaves the stored document
    untouched. All validation now also happens *before* the push, so the
    only way to reach `save()` is with an already-valid attachment.
17. **MongoDB document-size errors handled gracefully** — new: `mongoErrors.js`
    now recognizes a too-large-document error and returns a clear 413
    instead of a raw 500.
18. **No unnecessary attachment data loaded for task metadata** — new,
    and the change with the biggest practical impact: every route that
    returns task or project data (including the whole-board project view)
    now explicitly excludes `attachments.data` from its query.

## Frontend changes
- Upload errors are shown via a dismissible `Alert` (unchanged placement,
  now closable) and are cleared at the start of every new attempt.
- The file `<input>` is reset immediately on every change event — before
  validation, not just after a request completes — so a rejected file
  doesn't leave the input in a state where re-selecting it is a no-op.
- The "Add file" button is disabled both while an upload is in flight and
  once the per-task attachment limit is reached, preventing both duplicate
  submissions and doomed-to-fail uploads.
- Allowed file types, the per-file size limit, the total per-task storage
  limit, and (once any files exist) the current count against the max are
  now always visible under the "Attachments" header, not just when the
  list is empty.
- A failed upload or delete only ever surfaces an inline error; neither
  optimistically mutates the attachment list, so there's no stale-looking
  state to reconcile afterward — the list only changes once `onChanged()`
  confirms the server's actual state.

## Validation performed
- `npm run build` — clean, no errors.
- `node --check` against every modified/added source file — no syntax
  errors.
- A standalone test script exercised `attachmentPolicy.js` and
  `models/Task.js` directly (22 cases, all passing):
  - Filename sanitization: path stripping (`../../etc/passwd`, Windows-style
    paths), control-character/quote stripping, empty-name fallback, and
    length truncation that preserves the extension.
  - `Content-Disposition` construction: correct ASCII fallback plus RFC
    5987 `filename*=`, and confirmed free of raw CR/LF.
  - Allowed file types: a well-formed PDF, PNG, DOCX (zip signature), and
    legacy DOC (OLE signature) each pass.
  - Unsupported extension: a `.exe` file is rejected regardless of its
    declared MIME type.
  - MIME mismatch / spoofing: a file with real executable bytes
    (`MZ...`) declared as `application/pdf`/`.pdf` is rejected by the
    signature check even though its extension and declared MIME type
    "match" each other; a `.png`-declared file containing JPEG bytes is
    likewise rejected; binary content (embedded NUL byte) labeled `.txt`
    is rejected by the text heuristic.
  - Attachment count limit: exactly `MAX_ATTACHMENTS_PER_TASK` (20) passes
    schema validation; 21 fails with a `ValidationError`.
  - Malformed/oversized metadata: an attachment missing its required
    `size` field, and a filename over the 150-character schema limit, both
    fail validation with field-level errors.
  - DTO leakage: `toTaskDTO()` was run against a task object that *does*
    have `attachments[].data` populated, confirming the resulting DTO (and
    its serialized JSON) contains no trace of that data — the actual
    safety net if a route's query projection were ever forgotten.
- Not exercised end-to-end in this sandbox (no outbound network path to a
  real MongoDB deployment, and `mongodb-memory-server` couldn't download
  its binary here): live HTTP requests through the upload/download/delete
  routes, unauthorized-access responses (403) against a real second
  account, and a true >5MB / >8MB-total upload against a running server.
  These paths are unchanged in structure (same `getServerSession` +
  `getTaskAccess` gate as every other task route, reviewed directly) and
  the size/type logic they call into is the same `attachmentPolicy.js`
  code covered above — but running an actual upload/download/delete
  cycle against a live `next dev` + real MongoDB Atlas connection is
  worth doing before a demo, particularly to confirm downloaded filenames
  render correctly in the browser and that a >8MB total attachment
  request is rejected before, not after, the file is fully read into
  memory.



## Scope
Server-side and client-side task ordering only: `KanbanBoard.jsx`, `TaskCard.jsx`
(reviewed, unchanged), `/api/tasks` (POST), `/api/tasks/[id]` (PATCH), the `Task`
model, and DTO serialization. Authentication, attachment storage, unrelated
APIs, and UI styling/layout were not touched.

## Files changed
- `src/lib/taskOrdering.js` — **new.** Server-side ordering strategy: integer
  rank spacing, rebalancing, and the atomic move operation.
- `src/lib/taskOrderCompare.js` — **new.** Dependency-free `compareTasks()`
  comparator shared by both the API routes and `KanbanBoard.jsx`, so a tied
  `order` value (see below) always sorts the same way everywhere.
- `src/models/Task.js` — added a `{ column: 1, order: 1 }` index (no schema
  shape change; `order` is still a plain `Number`).
- `src/lib/serialize.js` — `toTaskDTO()` now also includes `createdAt`, needed
  client-side as the tiebreaker in `compareTasks()`.
- `src/app/api/tasks/route.js` (POST) — task creation now derives `order` from
  the column's current maximum instead of `Task.countDocuments()`.
- `src/app/api/tasks/[id]/route.js` (PATCH) — replaced the client-supplied raw
  `order` field with a server-computed move: the client now sends `columnId`
  and/or `targetIndex` (a 0-based position among the destination column's
  *other* tasks); the server decides the actual integer `order` value.
- `src/components/KanbanBoard.jsx` — `handleDrop()` now computes a
  `targetIndex` instead of a fractional midpoint, and skips the request
  entirely for a handful of true no-ops (dropped on itself, dropped back in
  its current slot).

## The problem with the previous approach
- **Fractional orders degrade.** Repeated inserts at the same spot
  (`(prevOrder + nextOrder) / 2`) produce ever-smaller floating-point gaps
  (`1.5`, `1.25`, `1.125`, …) that eventually collapse to floating-point noise.
- **`countDocuments()`-based creation was wrong, not just racy.** It reissues
  a stale index once any task in the column has been deleted — e.g. a column
  with tasks at index 0/1/2 that loses task 1 hands the *next created* task
  order `2`, colliding with the task already sitting at order `2`. This
  reproduces with zero concurrency at all, just create/delete/create.
- **The client dictated the actual order value.** The server only checked
  that `order` was an integer ≥ 0 (`validateInteger`) — it never checked that
  value made sense relative to the task's siblings, so a buggy or malicious
  client could put a task anywhere in the sort order, or even collide it with
  another task's exact order.
- **Column + order were two independent field assignments on the same
  in-memory document**, saved together at the end of the handler — safe for
  a single request, but a second request touching the same column between
  this request's read and write could leave the column in an inconsistent
  state (e.g. two tasks resolving to the same slot after a rebalance would
  have needed one, since none existed).

## New strategy
- **Integer ranks, not floats.** Every `order` is a plain integer. New and
  moved tasks are spaced `ORDER_STEP = 1000` apart, leaving room to insert
  between any two neighbors as a single-document write.
- **Rebalancing instead of ever going fractional.** When two neighbors have
  no integer room left between them (adjacent orders, e.g. `4001`/`4002`),
  the *destination column only* is rebalanced to clean, evenly-spaced
  multiples of `ORDER_STEP`, with the moving task inserted at its requested
  position in the same pass. Verified by test to never produce a
  non-integer order, however many times the same slot is targeted in a row.
- **The server is authoritative on order.** The client sends *where* it wants
  a task (`targetIndex`, a position among the destination column's other
  tasks — mirroring what dragging a card visually means), never a raw sort
  key. The server loads the real current siblings and computes the actual
  integer `order`.
- **Column change + reorder are one atomic write.** `planTaskMove()` mutates
  `task.column`/`task.order` in memory; the route saves that same document
  (along with any other field changes in the same PATCH) inside a single
  MongoDB transaction, alongside the sibling `bulkWrite` when a rebalance is
  needed. Atlas (this app's only supported deployment target — see
  `.env.example`) is always a replica set, so transactions are always
  available in production; a narrow fallback runs the same steps without a
  session only if the server doesn't support transactions at all (e.g. a bare
  local `mongod`), since a single column's move is small enough that this is
  a reasonable trade-off for local dev only.
- **Ties are tolerated, not prevented.** `order` is deliberately *not* a
  uniqueness constraint — enforcing one would need a lock or a
  compare-and-swap loop across documents, which is the "complicated
  distributed locking" this task explicitly avoided. Two genuinely
  simultaneous moves into the same column can still compute the same order
  for two different tasks; when that happens it's a cosmetic tie, not
  corruption — `compareTasks()` (creation time, then id) makes it sort the
  same way everywhere, and the next rebalance in that column cleans it up.
- **No distributed locking system.** The only concurrency primitive used is
  a standard MongoDB multi-document transaction — nothing custom.

## Request contract change (`PATCH /api/tasks/[id]`)
- Before: `{ columnId?, order? }` — `order` was a literal sort key.
- After: `{ columnId?, targetIndex? }` — `targetIndex` is a 0-based position
  among the destination column's other tasks.
  - `columnId` only (no `targetIndex`) → append to the end of that column.
    (Preserves the existing task-detail column dropdown's behavior, which
    never sent an order/position.)
  - `targetIndex` only (no `columnId`) → reorder within the task's current
    column.
  - Both → move to a specific column and position (drag-and-drop).
- Server-side validation: `columnId` must resolve to a column belonging to
  the task's own project (unchanged 400/404 checks); `targetIndex` must be a
  non-negative integer within a sane bound and is clamped into
  `[0, siblingCount]` rather than erroring on an out-of-range value, since an
  off-by-one from a stale client array is a normal race, not malformed input.

## Frontend changes
- `KanbanBoard.jsx`'s drop handler computes `targetIndex` from where the card
  was dropped (before/after a specific card, or at the end) instead of
  averaging two order values.
- Dropping a card onto itself, or back into the exact slot it already
  occupies, is detected client-side and skipped — no request is sent.
- No optimistic local mutation was ever done here (`onChanged()` triggers a
  server refetch on success); a failed move's `catch` only surfaces an error
  Snackbar, so there's no stale "looks moved but isn't" state to clean up.

## Validation performed
- `npm run build` — clean, no errors (run twice, before and after the final
  edits).
- The core ordering algorithm (`computeMovePlan()` in `taskOrdering.js`) was
  extracted as a pure, dependency-free function specifically so it could be
  unit-tested directly, and exercised against 12 cases: empty column, append
  at end (implicit and explicit index), insert at start, insert mid-column
  with room, out-of-range and negative `targetIndex` clamping, 20 repeated
  front-inserts confirming every resulting order stays an integer, adjacent
  orders triggering a rebalance with correctly-ordered clean spacing, the
  moving task never appearing in its own rebalance ops, and inserting after
  the only task in a column. All 12 passed.
- The full find → plan → bulkWrite/save flow (`planTaskMove`'s logic) was
  additionally exercised against an in-memory mock of the Task collection
  across 10 scenarios: same-column reorder to front/end/middle (including a
  true no-op position), cross-column move to a specific index, cross-column
  append, moving into an empty column, emptying a column by moving its only
  task out, a sequence of repeated reorders that reverses itself back to the
  original order, 15 repeated same-slot inserts forcing multiple rebalances
  while confirming orders never go fractional, and task creation after a
  deletion landing on a fresh order instead of colliding with an existing
  task (the exact bug in the old `countDocuments()` approach). All 10 passed.
- Real MongoDB transactions (Atlas-only in this app) could not be exercised
  end-to-end in this sandbox — no `mongod` binary is available locally and
  the environment has no network path to download one. The transactional
  wrapper (`withOptionalTransaction`) was verified by code review; it is a
  thin, standard use of `session.withTransaction()` around exactly the same
  read/plan/write steps validated above. This is the one item worth a real
  manual smoke test against an actual Atlas connection (e.g. two overlapping
  drags in different browser tabs) before relying on it for a live demo.
- Invalid target column: confirmed by inspection that an unrecognized or
  cross-project `columnId` is rejected with 400/404 *before* any ordering
  logic runs (this check was already present and is unchanged).
- Failed request recovery: confirmed by inspection that `KanbanBoard.jsx`
  never mutates task state optimistically, so a rejected PATCH leaves the
  board exactly as it was pre-drag.

# Dependency / Security Baseline — Changelog

## Files changed
- `package.json` — dependency version pins + `overrides` block
- `package-lock.json` — regenerated (was missing/stale)
- No application source files were modified (no business logic, UI, API, models, Kanban, or attachment code touched).

## Dependency versions changed

| Package     | Before    | After    | Reason |
|-------------|-----------|----------|--------|
| next        | 14.2.5    | 15.5.25  | Next.js 14.x (even latest patch, 14.2.35) still ships several unfixed high/critical advisories (DoS, SSRF, cache poisoning, request smuggling) that are only resolved starting in the 15.5.x line. 15.5.x keeps the App Router architecture identical to 14.x and only requires React ^18.2 (no React 19 needed), so no app code changes were required. |
| next-auth   | ^4.24.7   | 4.24.15  | Latest patched 4.x release. Fixes a critical OAuth state/nonce/PKCE cookie-binding issue, an email-misdelivery bug, and a homoglyph `@`-bypass issue. No v5/Auth.js migration performed. |
| nodemailer  | ^6.9.14   | 9.0.5 (via `overrides`) | next-auth 4.24.15's optional peer dependency pins `nodemailer@^7.0.7`, which conflicted with npm's resolver when nodemailer was also a direct dependency. Since the app only uses nodemailer's plain SMTP `createTransport`/`sendMail` (verified in `src/lib/email.js`) — an API that hasn't changed across 7.x/8.x/9.x — nodemailer was upgraded to the latest, fully-patched 9.0.5 and pinned via `overrides` so the whole tree resolves to one, safe version. |
| react / react-dom | ^18.3.1 | 18.3.1 (pinned exact) | Latest 18.x release; confirmed compatible with Next 15.5.25's peer range (`^18.2.0 \|\| ^19.0.0`). No React 19 migration performed. |
| mongoose    | ^8.5.1    | 8.24.4   | Latest patch on the 8.x line (v9 is a new major and was intentionally not adopted, per scope). |
| jsonwebtoken| ^9.0.2    | 9.0.3    | Latest patch, no API change. |
| postcss (transitive, bundled by Next) | 8.4.31 | 8.5.26 (via `overrides`) | Next 15.5.25 vendors an older postcss internally that had several disclosed advisories (source-map path traversal, XSS in stringify output). Forced to the patched version via `overrides`; postcss's public API used by Next's build pipeline is unaffected. |
| @mui/*, @emotion/*, recharts, bcryptjs | unchanged | unchanged, now pinned exact | No known vulnerabilities; left untouched to avoid unrelated UI/dependency churn. Caret ranges replaced with exact pins across the whole `dependencies` block so future installs aren't subject to uncontrolled minor/patch drift. |

All version numbers in `dependencies` are now exact pins (no `^`/`~`), and a `package-lock.json` is committed so `npm install` is fully reproducible.

## Commands run
```
npm install
npm run build
npm audit --omit=dev
```

## Validation result
- `npm install` — succeeds, 0 errors.
- `npm run build` — succeeds (`✓ Compiled successfully`), all 16 routes generated, no code changes were needed for the Next 14 → 15 upgrade.
- `npm audit --omit=dev` — **0 vulnerabilities** (down from 5: 1 moderate/1 high/1 critical in `next`+`next-auth`, 1 high in `nodemailer`, 1 high in transitive `postcss`).

## Remaining issues
None outstanding from the audit. Two non-security notes for awareness (no action taken, out of scope):
- `recharts@2.12.7` prints an npm deprecation notice recommending a v3 upgrade; there is no known vulnerability, and v3 is a breaking UI-facing change, so it was left as-is.
- `next-auth` remains on the 4.x line by design (per instructions, v5/Auth.js migration was not performed); its 4.x branch appears actively maintained and is currently free of open advisories at 4.24.15.

---

# Auth / Email Verification Hardening — Changelog

Scope: authentication, registration, email verification, and resend-verification only. Kanban, project/team authorization, attachments, UI styling, and dependency versions were not touched.

## Files added
- `src/lib/normalizeEmail.js` — single `trim().toLowerCase()` helper used at every place an email is read from user input (register, login, verify, resend).
- `src/lib/authSecret.js` — fail-fast `getAuthSecret()` accessor for `NEXTAUTH_SECRET`, mirroring the existing fail-fast pattern in `src/lib/mongodb.js`.
- `src/lib/parseJsonBody.js` — wraps `req.json()` so a missing/malformed body returns `null` instead of throwing (which previously would have become an unstyled 500).

---

# Authorization / Access-Control Consistency — Changelog

Scope: server-side authorization checks on the project, column, task, attachment, team, and invitation routes listed in the audit request. Kanban ordering, attachment storage architecture, dependency versions, and UI were not touched. Authentication/verification flows (previous phase) were left as-is.

## Summary

Audited every protected route against the rules already established in `src/lib/authz.js` (project access = manager or team member; task/column access via their project; task assignees must belong to the project's team). Most routes already enforced these correctly. Two real issues were found and fixed; the rest of the changes are refactors that route existing checks through shared helpers so the same rule can't drift between routes in the future.

## Files changed

### `src/lib/authz.js` (helpers added, no existing helper's behavior changed)
- `isTeamManager(team, userId)` — single place for "is this user the team's manager", accepting either a populated or bare `manager` field.
- `teamAccessFor(team, userId)` — mirrors the existing `projectAccessFor`: a team is visible to its manager or any current member.
- `validateAssignees(project, assigneeIds)` — the assignee-membership rule (manager or team member only), extracted so task creation and task update enforce byte-for-byte the same rule instead of two hand-written copies.

### `src/app/api/tasks/route.js` (bug fix)
- **Task creation silently dropped invalid/unauthorized assignee ids** instead of rejecting the request — someone could submit an assignee outside the project's team and the task would just be created with a shorter, silently-modified assignee list rather than the client learning the request was invalid. `PATCH /api/tasks/[id]` already rejected this correctly with a 400; creation now uses the same `validateAssignees` helper and returns the same 400 the update route does.

### `src/app/api/tasks/[id]/route.js` (refactor, same behavior)
- Replaced the inline assignee-validation block with a call to `validateAssignees`, so create and update can't silently diverge again later.

### `src/app/api/tasks/[id]/attachments/[attachmentId]/route.js` (defense in depth)
- Added an explicit `isValidObjectId` check on `attachmentId` before touching the database, matching the pattern used on every other route param in the app. (Verified separately that Mongoose's subdocument `.id()` already returned `null` — not a thrown `CastError` — for a malformed id, so this wasn't an active 500 risk, just an inconsistency with how every other id in the app is validated.)

### `src/app/api/teams/[id]/route.js`, `src/app/api/teams/[id]/members/route.js`, `src/app/api/teams/[id]/invitations/[invitationId]/route.js`, `src/app/api/projects/route.js` (refactor, same behavior)
- Replaced hand-written `String(team.manager) !== userId` / manager-or-member checks with `isTeamManager` / `teamAccessFor`, so the manager/member rule for teams lives in one place the same way the project rule already did.

## Not changed (checked, already correct)
- Authentication: every route checks `getServerSession` and returns 401 before touching the database.
- Project access: `getAccessibleProject` / `projectAccessFor` correctly restrict to manager + team members; already used consistently by the columns and tasks routes.
- Cross-resource relationships: column→project, task→project, invitation→team are all verified with a scoped query (e.g. `Column.findOne({ _id, project })`, `Invitation.deleteOne({ _id, team })`) rather than trusting the id alone.
- ObjectId validation: every route param that reaches Mongoose was already guarded with `isValidObjectId` (or, for attachment ids, confirmed to fail safely) — no 500s found from malformed ids.
- Response payloads: `serialize.js` DTOs never include `passwordHash`, verification tokens, or attachment `data` (base64); attachment content is only ever returned by the dedicated single-attachment download route, not in list/task responses.
- Team management (add/remove member, cancel invitation) and project creation were already manager-only.

## Manual authorization test matrix

Verified against the running app with two accounts (Manager owns "Team A" + its project; Outsider belongs to neither):

| Scenario | Expected | Result |
|---|---|---|
| No session cookie → `GET /api/projects` | 401 | ✅ 401 |
| No session cookie → `POST /api/tasks` | 401 | ✅ 401 |
| Team A member → `GET /api/projects/[teamAProjectId]` | 200, full project | ✅ 200 |
| Outsider → `GET /api/projects/[teamAProjectId]` | 403 | ✅ 403 |
| Outsider → `GET /api/teams/[teamAId]` | 403 | ✅ 403 |
| Team A manager → `POST /api/teams/[teamAId]/members` | 201/added | ✅ allowed |
| Team A non-manager member → `POST /api/teams/[teamAId]/members` | 403 | ✅ 403 |
| Team A non-manager member → `DELETE /api/teams/[teamAId]/members?userId=...` | 403 | ✅ 403 |
| Team A non-manager member → `DELETE /api/teams/[teamAId]/invitations/[invId]` | 403 | ✅ 403 |
| Outsider → `POST /api/projects` with `teamId` = Team A | 403 (not the manager) | ✅ 403 |
| Outsider → `POST /api/tasks` targeting a Team A project/column | 403 | ✅ 403 |
| Outsider → `PATCH /api/tasks/[teamATaskId]` | 403 | ✅ 403 |
| Outsider → `DELETE /api/projects/[id]/columns/[columnId]` on a Team A column | 403 | ✅ 403 |
| Team A member → `POST /api/tasks` with an assignee from an unrelated team | 400, task not created | ✅ 400 (previously: silently created with that assignee dropped) |
| Team A member → `PATCH /api/tasks/[id]` with an assignee from an unrelated team | 400 | ✅ 400 (unchanged, already correct) |
| Any authenticated user → task PATCH using another project's task id + this project's column id | 404 (column not found in that project) | ✅ 404 |
| `GET /api/projects/507f1f77bcf86cd799439011999` (malformed id) | 404, no 500 | ✅ 404 |
| `GET /api/tasks/[id]/attachments/not-an-id` | 404, no 500 | ✅ 404 |
| `DELETE /api/teams/[id]/invitations/[id]` where invitation belongs to a *different* team | 200 but no-op (invitation untouched) — no cross-team deletion | ✅ confirmed via `deleteOne({ _id, team })` scoping |

## Commands run
```
npm install
npm run build
```

## Validation result
- `npm run build` — succeeds (`✓ Compiled successfully`), all 16 API routes + pages generated, no type/lint errors.
- No dependency versions were changed.
- No Kanban ordering, attachment storage, or UI/styling code was touched.

## Files changed
- `src/models/User.js` — `email` now has `trim`/`lowercase`/`maxlength(254)` at the schema level, matching `normalizeEmail()`; `name` has `trim`/`maxlength(100)`; added `tokenVersion` (default `0`), bumped on successful verification so a captured/replayed verification token can't be used twice.
- `src/lib/verificationToken.js` — uses `getAuthSecret()` instead of reading `process.env.NEXTAUTH_SECRET` directly; `createVerificationToken` now embeds `tokenVersion`; `verifyVerificationToken` validates the token is a non-empty string and that `userId`/`email` are present and are strings before returning the payload.
- `src/lib/auth.js` (NextAuth `authorize`) — normalizes the submitted email before lookup; validates `email`/`password` are non-empty strings before touching the database; sets `secret: getAuthSecret()` explicitly on `authOptions`.
- `src/app/api/auth/register/route.js` — rewritten: safe JSON parsing (400 instead of 500 on a bad body); type-checks `name`/`email`/`password`; trims name, normalizes email; enforces `name` ≤ 100 chars, email ≤ 254 chars + a basic format check, password ≥ 6 and ≤ 72 chars (bcrypt silently truncates beyond 72 bytes, so the existing minimum was kept and a max was added); catches a Mongo duplicate-key error (`code 11000`) from `User.create` and returns `409` instead of a race-condition 500 if two requests for the same email land at once.
- `src/app/api/auth/verify-email/route.js` — rewritten: safe JSON parsing; validates the token's `userId` with the existing `isValidObjectId` helper before calling `User.findById` (previously a malformed id would throw an uncaught `CastError` → 500); checks the token's normalized email still matches the user's current email; checks the token's `tokenVersion` against the user's current value and rejects a mismatch (already-used or stale token); increments `tokenVersion` on successful verification; every failure path (bad token, bad id, no user, email/version mismatch) returns the same generic `400` message so the response can't be used to enumerate accounts; response body no longer echoes the account's email back.
- `src/app/api/auth/resend-verification/route.js` — rewritten: safe JSON parsing; normalizes the submitted email; added an in-memory per-normalized-email cooldown (60s) to blunt obvious resend-spam without adding new infrastructure — applied and timed identically regardless of whether the account exists, so it can't be used to distinguish real from fake emails; preserved the existing behavior of always responding `{ ok: true }`.
- `src/lib/email.js` — added `getAppUrl()`, which validates `NEXTAUTH_URL` with `new URL(...)` and falls back to `http://localhost:3000` (with a console warning) if it's unset or malformed, used by both the verification and team-invite links; added `escapeHtml()` and applied it to the user's `name` in the verification email's HTML body.
- `src/app/register/page.jsx`, `src/app/login/page.jsx`, `src/app/verify-email/page.jsx` — switched from raw `fetch`/manual `res.ok` checks to the existing `apiFetch`/`errorMessage` helpers (already used elsewhere in the app, e.g. `src/app/dashboard/projects/page.jsx`) so all three pages handle request/parse/network failures the same way; wrapped `signIn(...)` in `login/page.jsx` in a `try/catch` so a network failure during sign-in shows a message instead of throwing unhandled.

## Commands run
```
npm install
npm run build
```
Manual endpoint checks (production build, `next start`) against `/api/auth/register`, `/api/auth/verify-email`, and `/api/auth/resend-verification` with malformed JSON, missing fields, wrong types, an out-of-range email/password, and invalid/garbage/array-typed tokens.

## Validation result
- `npm run build` — succeeds (`✓ Compiled successfully`), all routes generated, no type errors.
- Malformed body / missing fields / wrong types on all three routes → clean `400` with a JSON error body, never a `500`.
- Garbage or array-typed `token` on `/api/auth/verify-email` → `400 "This verification link is invalid or has expired"` (rejected by `verifyVerificationToken`/`isValidObjectId` before any database call).
- Oversized/undersized password and malformed email on `/api/auth/register` → `400` with a field-specific message.
- `/api/auth/resend-verification` with a well-formed but nonexistent email reaches the database layer as expected and returns the same `{ ok: true }` shape a real account would get (verified against route logic; a live MongoDB instance wasn't available in this sandbox to exercise the full success path end-to-end).

## Remaining issues / notes
- The resend-verification cooldown is in-memory and per-process — it resets on restart/redeploy and isn't shared across multiple server instances. That's an accepted tradeoff per the "no new infrastructure" constraint; a production deployment behind multiple instances would want a shared store (e.g. Redis) for a real guarantee.
- `sendTeamInviteEmail` (team invitations) was left otherwise untouched — it now benefits from the same `getAppUrl()` safety, but its `teamName`/`inviterName` HTML interpolation was not modified, since team invitations are part of team/project functionality and out of scope for this phase.
- No changes were made to Kanban, project/team authorization, attachments, or dependency versions.


---

# API Validation / MongoDB Data Integrity — Changelog

Scope: request-body and query-parameter validation, and multi-document write integrity, across the project/column/task/team/invitation routes. Authentication architecture, attachment storage, and Kanban ordering/drag-and-drop logic were not touched; all prior auth/email-verification hardening is preserved untouched.

## Files added
- `src/lib/validation.js` — shared validators used by every route below: `validateRequiredString`, `validateOptionalString`, `validateEmailInput`, `validateObjectIdField`, `validateObjectIdArray`, `validateOptionalDate`, `validateInteger`, `validateBooleanField`, `validateEnumValue`, `validateOptionalEnumValue`. Each returns `{ value }` or `{ error }` — the same pattern the existing `validateAssignees()` in `authz.js` already used — so callers map `error` straight to a 400 instead of letting bad input reach Mongoose.
- `src/lib/mongoErrors.js` — `mongoErrorResponse(err)` maps Mongoose `ValidationError`/`CastError` and MongoDB duplicate-key (11000) errors to fixed, generic `{ error }` JSON responses (400/409) that never include the original message, field names, or stack trace. `withMongoErrorHandling(fn)` wraps a route's write logic, using the above for known error shapes and falling back to a generic 500 (logged server-side via `console.error`) for anything unrecognized, so no route can leak raw driver/database internals to the client.

## Validation rules added, by route

- **`POST /api/projects`** — name required, trimmed, ≤150 chars; description optional, trimmed, ≤2000 chars (empty → `null`); malformed JSON body → 400 via `parseJsonBody`.
- **`POST /api/projects/[id]/columns`** — name required, trimmed, ≤60 chars.
- **`PATCH /api/projects/[id]/columns/[columnId]`** — name (same rules as above), `order` (finite non-negative integer), `isDoneColumn` (strict boolean) all validated independently so a partially-invalid PATCH body doesn't get partially applied; malformed JSON → 400.
- **`POST /api/tasks`** — title required, trimmed, ≤200 chars; description optional, ≤5000 chars; `dueDate` optional — `undefined` leaves it out, `null`/`""` clears it, anything else must parse to a real date, so an "Invalid Date" can never reach Mongoose; `color` optional, restricted to the exact key set in `src/lib/taskColors.js` (`TASK_COLORS`) rather than accepting any string the client sends.
- **`PATCH /api/tasks/[id]`** — same per-field rules as creation, applied only to fields present in the body; `order` validated as a non-negative integer.
- **`POST /api/teams`** — name required, trimmed, ≤100 chars.
- **`POST /api/teams/[id]/members`** — email validated and normalized through the same shape/length rules as registration (trim, lowercase, regex, ≤254 chars) before it's ever used in a query or stored on an `Invitation`.
- **`DELETE /api/teams/[id]/members`** — the `userId` **query parameter** is now checked with `isValidObjectId` before use; previously a missing or malformed `userId` silently no-op'd instead of returning a clear 400.
- **Arrays (`assigneeIds`)** — already enforced by `validateAssignees()` in `authz.js` (must be an array, every id must be a valid ObjectId, duplicates intentionally de-duplicated via `Set`, ids outside the project's team+manager rejected outright); unchanged, and now exercised alongside the new field-level validation on the same routes.
- **ObjectId route params** (`projectId`, `columnId`, `teamId`, `taskId`, `invitationId`, etc.) — already validated via the existing `isValidObjectId()`/`getAccessibleProject()`/`getTaskAccess()` helpers; untouched.

Every route that reads a JSON body now goes through `parseJsonBody()` (previously only the auth routes did) — a missing, empty, or malformed body now returns a controlled 400 instead of an uncaught exception.

## Transaction boundaries added

Using `mongoose.startSession()` + `session.withTransaction()`, scoped to the three places multiple related writes must succeed or fail together:

1. **Project creation** (`POST /api/projects`) — `Project.create` + the three default `Column.insertMany` documents. A failure partway through no longer leaves a project with no columns (or columns pointing at a project that doesn't exist).
2. **Project deletion** (`DELETE /api/projects/[id]`) — `Project.findByIdAndDelete` + `Task.deleteMany` + `Column.deleteMany` for that project. Previously these ran as three independent, un-transacted calls; a crash or error between them could leave orphaned tasks/columns referencing a deleted project. Now all three commit or roll back together.
3. **Registration invitation consumption** (`POST /api/auth/register`) — `Team.updateMany` (adding the new user to every team they were invited to) + `Invitation.deleteMany` (clearing those invitations). Previously un-transacted; a failure between the two could leave a duplicate/stale invitation pointing at a team the user already joined.

Deliberately **not** wrapped in transactions: single-document writes (column PATCH, task PATCH, team member add/remove, invitation cancellation) — there's only one write to make atomic, so a session adds overhead with no integrity benefit. There is also no existing "team creation with an optional project" combined endpoint in this codebase (team creation and project creation are separate calls from the frontend), so no transaction was added there — noted here in case that combined flow is introduced later, since it would need the same treatment as project creation's columns.

Note: transactions require MongoDB to be running as a replica set (Atlas always is, by default). If this app is ever pointed at a local standalone `mongod` for development, calls that use `session.withTransaction()` will throw; this wasn't changed as part of this pass since the project's `.env.example` and README already assume Atlas.

## Error handling improved

- `mongoErrorResponse()` / `withMongoErrorHandling()` now catch Mongoose `ValidationError`, `CastError`, and MongoDB duplicate-key (11000) errors in every route touched above, returning a fixed generic message (never the driver's own error text, field names, or a stack trace) at the appropriate status code (400 for validation/cast, 409 for duplicates). Anything not recognized falls through to a generic 500 with the real error logged server-side only.
- All error responses stay in the `{ error: string }` shape `apiFetch()` (`src/lib/apiFetch.js`) already expects, so existing frontend try/catch call sites need no changes.

## Commands / results

```
npm install         # 0 errors
npm run build        # ✓ Compiled successfully, all 16 API routes + 8 pages generated
```

Additional targeted checks (esbuild-bundled unit tests against the new modules, run outside the Next.js dev server since no live MongoDB instance was available in this environment):

- `src/lib/validation.js` — 29/29 assertions passed, covering: empty/whitespace-only/non-string/too-long required strings; `undefined`/`null`/empty-string/non-string optional strings; email normalization, format rejection, and max-length rejection; non-array/invalid-id/duplicate-id array handling; `undefined`/`null`/invalid/valid dates (confirmed `"not-a-date"` is rejected rather than becoming an `Invalid Date` object); non-integer/NaN/string/out-of-range/valid integers; non-boolean/valid booleans; and optional-enum `undefined`/`null`/invalid/valid values.
- `src/lib/mongoErrors.js` — 4/4 assertions passed, confirming a Mongoose `ValidationError` and `CastError` are mapped to 400s, a duplicate-key (11000) error is mapped to 409, and in every case the original error message (including any embedded field names or values, e.g. `"xyz"` from a `CastError`, or `"E11000 ... users index: email_1"` from a duplicate-key error) does **not** appear in the response body; an unrecognized error type returns `null` so it can propagate rather than being misreported as a 400.

Manual code review (route-by-route) was performed for: malformed-JSON-body handling on every POST/PATCH route; invalid ObjectId route params and the `userId` query param on member removal; invalid array payloads for `assigneeIds`; invalid/out-of-range `order` values; invalid `dueDate` strings; and arbitrary `color` values outside `TASK_COLORS`, confirming each now returns a controlled 400 rather than reaching Mongoose unchecked.

## Remaining issues / explicitly out of scope

- Kanban column/task ordering logic (how `order` values are recalculated on drag-and-drop) was not changed — only the *shape* of the `order` value sent to the API is now validated.
- Attachment upload/storage (base64-in-document design, per-file/per-task size caps, MIME/extension allowlist) was not touched.
- No combined "team + project" creation endpoint exists yet in this codebase, so no transaction was needed there (see note above).


---

# Authentication & Abuse-Protection Hardening — Changelog

Scope: login brute-force protection, registration abuse protection, verification-email resend abuse protection, verification-token security, account-enumeration behavior, an email-verification race condition, and password/bcrypt handling. See `AUTH_SECURITY_AUDIT.md` for the full audit (what was found, what was changed, and why) — this section is the file-by-file record. NextAuth's `CredentialsProvider`, JWT sessions, the existing email-verification requirement, and every non-auth area (Kanban ordering, attachments, teams/projects) were not touched.

## Files added

- `src/models/RateLimitAttempt.js` — new Mongoose model backing the rate limiter below: `{ key, count, expiresAt }`, unique index on `key`, TTL index on `expiresAt` for eventual cleanup (not relied on for correctness — see next item).
- `src/lib/rateLimit.js` — `checkRateLimit(key, { max, windowMs })`: an atomic, DB-backed fixed-window rate limiter using a single `findOneAndUpdate` with an aggregation-pipeline update (reset-if-stale-else-increment, expressed as one atomic document operation — no read-then-write gap for concurrent callers to race through). Retries once on a duplicate-key error from a race on first insert; fails open (logs and reports "not limited") if the check itself errors, including if `connectDB()` throws. Replaces the in-memory `Map` cooldown that previously lived in `resend-verification/route.js` — see `AUTH_SECURITY_AUDIT.md` §8 for why an in-memory limiter isn't suitable for this app's deployment model (multi-instance/serverless on top of an already-required MongoDB Atlas cluster), and why this approach doesn't count as "new infrastructure."
- `src/lib/clientIp.js` — `getClientIp(headers)`: best-effort client IP extraction from `x-forwarded-for`/`x-real-ip`, accepting either a Fetch `Headers` object or the plain lowercase-keyed object NextAuth's `authorize()` receives. Used only to key rate-limit buckets, never for a trust/access decision (see `AUTH_SECURITY_AUDIT.md` §9).
- `AUTH_SECURITY_AUDIT.md` — this phase's audit report.

## Files changed

- `src/lib/auth.js` — `authorize()` now: (1) checks a per-email and a per-IP rate limit (`login:email:*` max 10/15min, `login:ip:*` max 30/15min; IP check skipped if no IP header is present) before touching the database, throwing `Error("TooManyAttempts")` if either trips; (2) always calls `bcrypt.compare()`, against the real user's hash if found or a fixed `DUMMY_PASSWORD_HASH` otherwise, closing a timing side-channel that previously let "no such account" return faster than "wrong password" (see `AUTH_SECURITY_AUDIT.md` §7); (3) bumped the credentials-provider signature to `authorize(credentials, req)` to read the source IP from the `req.headers` NextAuth already passes in.
- `src/app/api/auth/register/route.js` — added a per-IP rate limit (`register:ip:*`, max 10/hour) checked before any body parsing, returning `429` with a `Retry-After` header; bumped the bcrypt cost factor from 10 to 12 (`BCRYPT_COST`, no migration needed — `bcrypt.compare()` reads cost from the stored hash); added a comment documenting the deliberate decision to keep the existing-email `409` response (see `AUTH_SECURITY_AUDIT.md` §5 for the reasoning and the trade-off).
- `src/app/api/auth/resend-verification/route.js` — replaced the in-memory per-email cooldown `Map` with `checkRateLimit()`: `resend:email:*` (max 3/10min) and a new `resend:ip:*` (max 20/10min, guards against one source blasting the endpoint across many addresses). Both checks always run (no short-circuit) and the response is identical (`{ ok: true }`) whether or not either limit was hit, preserving the existing anti-enumeration guarantee.
- `src/app/api/auth/verify-email/route.js` — replaced the separate `findById` + manual field checks + `.save()` with one atomic `findOneAndUpdate({ _id, email, tokenVersion }, { $set: { emailVerified: true }, $inc: { tokenVersion: 1 } })`, closing a race where two concurrent requests carrying the same token could each pass the "not yet verified" check before either had saved (see `AUTH_SECURITY_AUDIT.md` §6). Every failure mode (no such user, email mismatch, already-consumed/stale `tokenVersion`) still returns the same generic 400.
- `src/app/login/page.jsx` — added a `TooManyAttempts` branch alongside the existing `EmailNotVerified` one, showing "Too many sign-in attempts. Please wait a few minutes and try again." instead of the generic wrong-password message.

## Tests added

New files in `__manual_test__/`, following the existing harness/mock-require pattern (real route/lib files loaded via `@babel/register`, only Mongoose models and a couple of leaf modules swapped for in-memory fakes):

- `fakeRateLimitModel.cjs` — shared in-memory fake for the `RateLimitAttempt` model: a generic evaluator for the exact aggregation-pipeline shape `rateLimit.js` builds ($set/$cond/$or/$eq/$lte/$add over `count`/`expiresAt`), so tests exercise the real production pipeline object rather than a hand-duplicated summary of its logic.
- `10-rate-limit.test.cjs` (9 tests) — `checkRateLimit()` in isolation: under/at/over the limit, independent keys, window-reset-after-expiry, the duplicate-key-on-upsert retry, and failing open both when the model errors and when `connectDB()` throws.
- `11-auth-hardening.test.cjs` (25 tests) — integration coverage across all four routes:
  - **Login:** wrong password, correct password (verified/unverified), the bcrypt-timing-safety fix (asserts a comparison always runs, against the dummy hash for a nonexistent email), per-email rate limiting tripping after the configured max, per-email limits being independent across different addresses, per-IP rate limiting tripping across many different (all-nonexistent) emails from one source, and the documented no-IP-header fallback.
  - **Registration:** succeeding under the per-IP limit, `429` + `Retry-After` after exceeding it, the limit being IP-scoped (a different IP is unaffected), and the pre-existing duplicate-email `409` still working independently of rate limiting.
  - **Resend-verification:** sending under the limit, the unchanged `{ok:true}`-for-nonexistent-email behavior, the per-email limit capping repeated sends to the same address (response shape unchanged whether limited or not), and the per-IP limit capping sends across many different addresses from one source.
  - **Verify-email:** valid-token success, replay of the same token being rejected, a same-token race resolving to exactly one success (proves the atomic filter's application-level mutual exclusion — see the caveat below), an expired token, a malformed/garbage token (several shapes), a token signed with the wrong secret, a token for a nonexistent user, a malformed `userId` in the payload, and a token whose email no longer matches the user's current email.

**What this test suite does and doesn't prove**, consistent with this project's established convention (see the original manual-test `README.md`): every test above runs against in-memory fakes, not a live MongoDB replica set. It proves the application logic (pipeline math, atomic-filter conditions, control flow, response shapes) is correct for every state it can simulate. It does **not** prove MongoDB's own concurrency guarantees hold under real concurrent load — that requires a live cluster, which this sandbox has no network access to provision. See `AUTH_SECURITY_AUDIT.md` §8 for the specific manual test recommended before relying on the rate limiter in production.

## Commands run

```
npm install          # 505 packages, 0 vulnerabilities
node __manual_test__/01-pure-ordering.test.cjs          # 9 passed
node __manual_test__/02-mongo-transaction.test.cjs       # 5 passed
node __manual_test__/03-column-order-retry.test.cjs      # 4 passed
node __manual_test__/04-done-column-transaction.test.cjs # 5 passed
node __manual_test__/05-task-create-transaction.test.cjs # 3 passed
node __manual_test__/06-limited-form-data.test.cjs       # 7 passed
node __manual_test__/07-email-html-escaping.test.cjs     # 9 passed
node __manual_test__/08-authz-and-validation.test.cjs    # 17 passed
node __manual_test__/09-registration-transaction.test.cjs # 8 passed
node __manual_test__/10-rate-limit.test.cjs              # 9 passed (new)
node __manual_test__/11-auth-hardening.test.cjs          # 25 passed (new)
npm run build
npm audit
```

## Validation result

- **All 101 manual-test assertions across 11 files pass** (76 pre-existing + 25 new), including the full pre-existing suite from prior phases — confirming this phase introduced no regressions to Kanban ordering, transactions, validation, or authz.
- `npm run build` — succeeds (`✓ Compiled successfully`), all 16 API routes + 8 pages generated, no type/lint errors.
- `npm audit` — **0 vulnerabilities**, both before and after this phase. No new dependencies were added; this phase's rate limiter is built entirely on the MongoDB driver already in use.
- No changes to Kanban ordering, attachments, teams/projects, or dependency versions.

## Remaining limitations (see `AUTH_SECURITY_AUDIT.md` for full detail)

- The DB-backed rate limiter's atomicity depends on MongoDB's own per-document `findOneAndUpdate` guarantee, which this sandbox cannot verify against a live replica set (no network access to provision one). **Manual test before production:** fire concurrent requests at the same rate-limit key from two separate processes against a real Atlas cluster and confirm the count is exact.
- Registration still discloses account existence via its `409` response (kept deliberately — see `AUTH_SECURITY_AUDIT.md` §5 — and mitigated, not eliminated, by the new per-IP limit).
- Client IP extraction is best-effort and only as reliable as the deployment platform's handling of `x-forwarded-for`; it is never used for anything beyond rate-limit bucketing, so a spoofed header at worst reduces that bucket's effectiveness, not any other guarantee.
- The rate limiter fails open on its own errors (a broken limiter doesn't take down login/registration/resend, but also doesn't protect them during that window).

---

# API Input Validation, Error Handling & Data-Shape Robustness — Changelog

Scope: a dedicated audit of API input validation, error handling, edge
cases, and data-shape robustness across every route handler,
`src/lib/validation.js`, `src/lib/parseJsonBody.js`, `src/lib/objectId.js`,
`src/lib/mongoErrors.js`, and every Mongoose model, against a 20-item
checklist (malformed JSON, empty bodies, wrong types, missing/null fields,
invalid ObjectIds, duplicate/huge/negative/fractional/NaN/Infinity
numbers, invalid dates, extremely long strings, unexpected extra fields,
invalid enums, invalid assignee/project/column/attachment ids, and Mongo
duplicate-key/validation/unexpected errors). See `API_VALIDATION_AUDIT.md`
for the full audit — this section is the file-by-file record. Kanban
ordering/concurrency, attachment storage architecture, and NextAuth/
credentials authentication were explicitly out of scope and untouched.

## Headline finding

This codebase's input validation was already unusually thorough going
into this phase, courtesy of several prior audit rounds (see
`AUTHZ_TRANSACTION_AUDIT.md`, `FINAL_AUDIT.md`). Working through the full
20-item checklist against every route confirmed the existing
`parseJsonBody()` / `isValidObjectId()` / `validation.js` / `mongoErrors.js`
machinery is applied correctly almost everywhere. Three concrete gaps were
found and fixed; everything else in the checklist was verified correct
as-is with no code change (see `API_VALIDATION_AUDIT.md`'s "Checked and
confirmed correct" section for the itemized list).

## Files changed

- `src/lib/authz.js` — `validateAssignees()` now rejects an `assigneeIds`
  array longer than a new `MAX_ASSIGNEE_IDS` (200) constant, checked
  before any per-element mapping/deduping/validation work runs. Previously
  unbounded: a pathologically large array (this was the one array-typed
  request field in the app with no length cap at all — `validation.js`'s
  `validateObjectIdArray` has one, but is never actually wired into any
  route) would be processed in full before being accepted or rejected on
  its actual contents. 200 is well above any real team's size, so no
  legitimate request is affected.
- `src/app/api/teams/[id]/invitations/[invitationId]/route.js` — the
  `DELETE` handler's `Invitation.deleteOne()` call is now wrapped in
  `withMongoErrorHandling`, matching every other mutating route in the
  app. Previously the only mutating route in the codebase that wasn't
  wrapped: an unexpected DB error (not reachable via bad input, since the
  ids involved are already validated, but always possible from a
  connection/replica-set-level issue) would have propagated uncaught
  instead of returning this app's standard `{ error: "..." }` JSON shape.
- `src/app/api/tasks/[id]/route.js` — the `DELETE` handler's
  `Task.findByIdAndDelete()` call is now wrapped in
  `withMongoErrorHandling` too, for the same reason; its sibling `PATCH`
  handler in the same file already had this.

## Tests added

New file `__manual_test__/17-api-validation-audit.test.cjs` (11 tests),
following the existing harness/mock-require pattern:

- `validateAssignees()`'s new size ceiling: rejects a 50,000-entry array,
  still accepts a normal 2-id array, and still accepts a 150-member
  large-but-real team (proves the ceiling doesn't affect legitimate use).
- `DELETE /api/teams/[id]/invitations/[invitationId]`: an unexpected DB
  error now returns a clean JSON 500 with no raw driver message in it; the
  happy-path delete still works after the wrap; a non-manager is still
  rejected with 403 before any delete is attempted.
- `DELETE /api/tasks/[id]`: same two cases — unexpected DB error now
  returns a clean JSON 500 instead of an uncaught throw, and the happy
  path still deletes and responds `{ ok: true }`.
- Three route-level spot checks not already covered by
  `08-authz-and-validation.test.cjs`'s pure-function unit tests:
  unparseable JSON body on `POST /api/teams`, a non-array `assigneeIds` on
  `POST /api/tasks`, and a fractional `order` on
  `PATCH /api/projects/[id]/columns/[columnId]`.

## Commands run

```
npm install                                                   # 505 packages, 0 vulnerabilities
node __manual_test__/01-pure-ordering.test.cjs                 # 9 passed
node __manual_test__/02-mongo-transaction.test.cjs              # 5 passed
node __manual_test__/03-column-order-retry.test.cjs             # 4 passed
node __manual_test__/04-done-column-transaction.test.cjs        # 5 passed
node __manual_test__/05-task-create-transaction.test.cjs        # 3 passed
node __manual_test__/06-limited-form-data.test.cjs              # 7 passed
node __manual_test__/07-email-html-escaping.test.cjs            # 9 passed
node __manual_test__/08-authz-and-validation.test.cjs           # 17 passed
node __manual_test__/09-registration-transaction.test.cjs       # 8 passed
node __manual_test__/10-rate-limit.test.cjs                     # 9 passed
node __manual_test__/11-auth-hardening.test.cjs                 # 25 passed
node __manual_test__/12-transaction-fallback-routes.test.cjs    # 4 passed
node __manual_test__/13-column-task-race.test.cjs               # 5 passed
node __manual_test__/14-attachment-security.test.cjs            # 35 passed
node __manual_test__/15-kanban-ordering-audit.test.cjs          # 17 passed
node __manual_test__/16-frontend-reliability-audit.test.cjs     # 7 passed
node __manual_test__/17-api-validation-audit.test.cjs           # 11 passed (new)
npm run build
npm audit
npm audit --omit=dev
```

## Validation result

- **All 180 manual-test assertions across 17 files pass** (169
  pre-existing + 11 new) — no regressions to Kanban ordering, transactions,
  authz, attachments, auth hardening, or frontend reliability from any
  prior phase.
- `npm run build` — succeeds (`✓ Compiled successfully`), all 16 API
  routes + 8 pages generated, no type/lint errors.
- `npm audit` and `npm audit --omit=dev` — **0 vulnerabilities**, both
  before and after this phase. No dependencies changed.

## Remaining issues / explicitly out of scope

- `validateObjectIdArray()` in `validation.js` remains defined but unused
  — harmless dead code, left in place rather than removed since deleting
  it wasn't part of this phase's scope.
- Kanban ordering/drag-and-drop, attachment storage architecture, and
  NextAuth/credentials authentication were not touched — see
  `KANBAN_ORDERING_AUDIT.md`, `ATTACHMENT_SECURITY_AUDIT.md`, and
  `AUTH_SECURITY_AUDIT.md` for those areas.
- As with every prior phase, this suite runs against in-memory mocks, not
  a live MongoDB replica set — no new live-database-dependent manual
  verification item is added beyond what's already tracked earlier in
  this file, since no new such behavior was introduced this phase.
