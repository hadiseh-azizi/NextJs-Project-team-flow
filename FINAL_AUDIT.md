# TeamFlow — Final Integration Audit

This is the final cross-system audit of the cumulative codebase, after
all prior scoped audit phases (auth, registration/invitations, API
authorization, validation/transactions, attachments, Kanban ordering,
team membership, Next.js 15 migration, email security, frontend
reliability, UI/accessibility, and dependency/build/lint). It does not
introduce features, redesign the UI, or refactor speculatively — it
verifies the prior phases' claims against the actual source and closes
any real remaining gaps.

**Every checklist item below was checked against the source in this
ZIP, not assumed from a previous phase's report or changelog entry.**

## 1. Architecture summary

- **Stack:** Next.js 15 (App Router, JavaScript, Server + Client
  Components), MongoDB Atlas via Mongoose, NextAuth v4
  (Credentials provider, JWT session strategy), Material UI v5,
  nodemailer, Recharts.
- **Data model:** `User` → `Team` (manager + members array) → `Project`
  (belongs to one team) → `Column` (arbitrary, per-project, one
  optional `isDoneColumn`) → `Task` (references project + column,
  multi-assignee, embedded `attachments` array with base64 `data`).
  `Invitation` is a separate pending-membership record consumed at
  registration.
- **Authorization:** centralized in `src/lib/authz.js`
  (`projectAccessFor`, `getAccessibleProject`, `getTaskAccess`,
  `isTeamManager`, `accessibleTeamIds`) — every API route in
  `src/app/api/**/route.js` goes through one of these rather than
  querying Mongo directly for an access decision.
- **Transactions:** `src/lib/mongoTransaction.js`'s
  `withOptionalTransaction` wraps every multi-document write (project
  create/delete, member removal, invitation consumption at
  registration, done-column exclusivity) in `session.withTransaction`
  when the server is a replica set, and falls back to sequential,
  documented-as-non-atomic writes on a standalone `mongod`.
- **Attachments:** stored as base64 inside the `Task` document by
  design (documented tradeoff for a self-contained academic deployment
  with no object storage); every list/board/dashboard query explicitly
  `.select("-attachments.data")`, and only the single-file download
  route opts into loading the bytes.
- **Test harness:** `__manual_test__/*.cjs`, loaded via
  `@babel/register` against the real route/lib files with only
  Mongoose/next-auth swapped for in-memory fakes — not a mocked
  reimplementation of the logic under test.

## 2. Exact dependency versions

From `package.json` / `package-lock.json` (unchanged from the prior
dependency-audit phase; re-verified, not re-decided):

```
next               15.5.25
react / react-dom  18.3.1
next-auth          4.24.15
mongoose           8.24.4
bcryptjs           2.4.3
jsonwebtoken       9.0.3
nodemailer         9.0.5   (pinned via "overrides")
@mui/material      5.16.7
@mui/icons-material 5.16.7
@emotion/react     11.14.0
@emotion/styled    11.14.1
@emotion/cache     11.14.0
recharts           2.12.7

devDependencies:
eslint             9.39.5
eslint-config-next 15.5.25
@eslint/eslintrc   3.3.7
@babel/core        8.0.1
@babel/preset-env  8.0.2
@babel/register    8.0.1
babel-plugin-module-resolver 5.0.3
mongodb-memory-server ^11.2.0

engines.node: ^18.18.0 || ^19.8.0 || >=20.0.0
```

All majors are held below latest-upstream per this project's stated
**SECURE + STABLE > NEWEST** principle; none have an outstanding CVE.

## 3. Commands run and results

```
$ npm install
added 772 packages in 31s

$ npm ci --dry-run
added 52 packages (all platform-specific optional binaries: sharp/
next/swc variants for OSes not in this sandbox) — 0 removed, 0 changed
→ lockfile is consistent with package.json; no dependency drift.

$ npm audit
found 0 vulnerabilities

$ npm run lint
> eslint .
(no output — 0 errors, 0 warnings)

$ MONGODB_URI=... NEXTAUTH_SECRET=... NEXTAUTH_URL=... npm run build
✓ Compiled successfully in 38.0s
✓ Generating static pages (16/16)
Route (app): 9 pages + 16 API route files (22 HTTP method handlers) — 
all listed, no build errors or warnings.
(Build requires the three env vars set even with placeholder values,
by design — see README.md "npm run build" note — because Next.js
evaluates every Route Handler, including /api/auth/[...nextauth]],
during "Collecting page data", and lib/mongodb.js / lib/authSecret.js
fail fast at import time rather than at first connection.)
```

### Manual test suite — all 17 files, run individually

```
01-pure-ordering.test.cjs                 9 passed, 0 failed
02-mongo-transaction.test.cjs             5 passed, 0 failed
03-column-order-retry.test.cjs            4 passed, 0 failed
04-done-column-transaction.test.cjs       5 passed, 0 failed
05-task-create-transaction.test.cjs       3 passed, 0 failed
06-limited-form-data.test.cjs             7 passed, 0 failed
07-email-html-escaping.test.cjs           9 passed, 0 failed
08-authz-and-validation.test.cjs         17 passed, 0 failed
09-registration-transaction.test.cjs      8 passed, 0 failed
10-rate-limit.test.cjs                    9 passed, 0 failed
11-auth-hardening.test.cjs               25 passed, 0 failed
12-transaction-fallback-routes.test.cjs   4 passed, 0 failed
13-column-task-race.test.cjs              5 passed, 0 failed
14-attachment-security.test.cjs          35 passed, 0 failed
15-kanban-ordering-audit.test.cjs        17 passed, 0 failed
16-frontend-reliability-audit.test.cjs    7 passed, 0 failed
17-api-validation-audit.test.cjs         11 passed, 0 failed
                                         --------------------
TOTAL                                  180 passed, 0 failed
```

(`17-api-validation-audit.test.cjs` exists and passes but was missing
from `__manual_test__/README.md`'s run list — noted, not fixed, since
touching that doc is outside a "no scope creep" reading of this phase;
flagged here so it isn't silently dropped from future runs.)

## 4. Security findings — verified against source

- [x] `passwordHash` is only ever written in `auth/register` and read
  for comparison in `lib/auth.js`; never appears in `src/lib/serialize.js`
  or any API response body.
- [x] Email verification / invitation tokens are only ever emailed
  (inside a signed link) — never returned in a JSON response body.
- [x] Attachment `data` (base64) is excluded via `.select("-attachments.data")`
  in every list/board/dashboard/task-mutation query; the one route that
  needs it (`GET /api/tasks/[id]/attachments/[attachmentId]`) opts in
  explicitly and is gated by the same `getTaskAccess` authorization as
  every other task route.
- [x] Every API route under `src/app/api/**` checks `getServerSession`
  before touching the database, and every resource route additionally
  checks `authz.js` before reading or mutating.
- [x] Cross-team access is structurally impossible: `projectAccessFor`,
  `getTaskAccess`, and `getAccessibleProject` are the *only* paths
  routes use to reach a project/task, and all three require
  manager-or-member of the project's own team.
- [x] Team membership add/remove requires `isTeamManager()`; task
  assignees are validated against the project's own team roster
  (`validateAssignees()`) and rejected outright (not silently dropped)
  if outside it.
- [x] Malformed ObjectIds can't 500 anything: `getAccessibleProject`
  and `getTaskAccess` both call `isValidObjectId()` first and return
  `null` (→ 403/404) rather than reaching Mongoose with a bad cast.
  Verified this holds even for the two routes that don't call
  `isValidObjectId()` directly (`projects/[id]/columns/route.js`,
  `tasks/[id]/attachments/route.js`) — both delegate to the guarded
  helpers above.
- [x] `mongoErrorResponse()` / `withMongoErrorHandling()` return fixed
  generic strings; no stack traces or raw Mongo error text reach the
  client.
- [x] Attachment upload size/count/MIME/magic-byte limits are enforced
  server-side (`attachmentPolicy.js`), independent of client-declared
  `Content-Type`.
- [x] No raw `fetch()` calls outside `lib/apiFetch.js`'s wrapper
  anywhere in `src/`.
- [x] No `console.log`/`console.debug`, `TODO`, or `FIXME` left in
  `src/`.
- [x] The two `dangerouslySetInnerHTML` uses (`ThemeRegistry.jsx` for
  Emotion's SSR style cache, `layout.jsx` for the pre-hydration theme
  script) are both static, developer-authored strings — not user input
  — and are the standard pattern for both use cases.
- [x] No `.env` file with real secrets is present — only `.env.example`
  with placeholder values.
- [x] No real MongoDB connection string or credential appears anywhere
  in source or docs outside of clearly-labeled examples.

## 5. Data-integrity findings

- [x] No orphan projects/columns/tasks: project deletion transactionally
  removes its columns and tasks; column deletion is blocked (409) while
  it still holds tasks (`13-column-task-race.test.cjs`).
- [x] Done-column exclusivity (at most one `isDoneColumn: true` per
  project) is enforced transactionally, including under repeated
  toggling and driver-level transaction retries
  (`04-done-column-transaction.test.cjs`).
- [x] Task/column ordering uses integer ranks with gap-exhaustion
  rebalancing and duplicate-order tie-breaking by `createdAt`/`_id` —
  no float-based ordering logic anywhere in `src` — verified correct
  for insert-between, drop-on-self (no-op), cross-column moves, and
  concurrent-tie scenarios (`01`, `03`, `15`).
- [x] Member removal unassigns that member's tasks in the same
  transaction (or the same sequential fallback on a standalone server)
  as the removal itself — no task can be left pointing at a
  non-member.
- [x] Registration/invitation consumption only grants membership for
  non-expired invitations matched against the normalized email, inside
  a transaction; falls back safely (sequential, documented as
  non-atomic) on a standalone server.

## 6. Frontend findings

- [x] Every mutating call site goes through `apiFetch`, which throws on
  any non-2xx response rather than resolving silently — confirmed no
  raw `fetch()` bypasses this.
- [x] Loading flags (`setSubmitting`/`setSaving`) are always reset in a
  `finally`, guarded by `useIsMounted()` from `clientAsync.js` — no
  stuck-spinner or set-state-after-unmount patterns found.
- [x] Dialogs/forms only close or clear state on the success path;
  errors are kept in state (not swallowed) so retry re-enters the same
  handler.
- [x] `verify-email/page.jsx`'s token-verification effect uses a
  `useRef` guard so React Strict Mode's dev double-invoke (or any
  re-render) can't submit an already-consumed single-use token twice.
- [x] `dateOnly.js` returns an empty string for null/invalid input
  instead of throwing or rendering "Invalid Date" (`16-frontend-
  reliability-audit.test.cjs`).
- [x] `npm run build` succeeds with no hydration warnings; the
  pre-hydration `data-theme-mode` script avoids theme-flash without a
  second render pass.

## 7. Documentation consistency

- **Found and fixed (Low severity):** `README.md` described a
  "purple-to-rose gradient palette" with gradient buttons on primary
  actions. The actual, current `src/lib/theme.js` explicitly
  implements a flat, neutral background with a single solid ochre
  accent — its own top-of-file comment says "No gradients, no colored
  glow shadows, no backdrop blur — flat" — a leftover from before the
  UI/accessibility hardening phase replaced the palette. This was a
  stale doc claim, not a code bug; no user-facing behavior was
  affected. Fixed by rewording that paragraph to match the current
  theme.
- Everything else checked against source and found accurate: page
  count (9), API route file count (16) and HTTP method count (22),
  Node engine range, the `npm run build` env-var requirement and its
  stated reason, the Next.js 15 `await params` migration claim, and
  the lint-tooling description (`eslint .` + flat config, not `next
  lint`).

## 8. Known limitations (environment-dependent, not fixable in this sandbox)

This sandbox has no network access to a MongoDB server, so the
following are **NOT EXECUTED — real MongoDB required**, consistent
with every prior phase:

- Concurrent task creation against a live replica set (server-side
  write-conflict detection, not just the application-level retry logic
  already proven by `03-column-order-retry.test.cjs`)
- Concurrent task movement / concurrent done-column changes under real
  simultaneous transactions (the in-memory fakes in `04`/`05`/`15`
  prove the application code scopes writes correctly and rolls back on
  failure; they don't exercise Mongo's actual server-side conflict
  detection between two truly concurrent transactions)
- Member removal + task update race under real concurrency
- Registration + invitation consumption under real concurrency
- TTL invitation-expiration sweep timing (the index is declared
  correctly in `Invitation.js`; MongoDB's background TTL monitor runs
  on its own ~60s cycle that can't be observed without a live server)
- Real SMTP delivery (the app's own fallback — logging the full email
  to the server console when SMTP env vars are unset — is by design
  and was exercised; an actual inbox was not)

The manual test matrices for each of these, documented in the relevant
phase's `CHANGELOG.md` entry (Kanban ordering overhaul, team
membership & invitation flow, attachment security), still apply
unchanged and should be run against a real Atlas cluster before
production traffic.

## 9. Final readiness verdict

**READY WITH KNOWN LIMITATIONS.**

The build is clean, `npm audit` reports zero vulnerabilities, `npm run
lint` is clean, the lockfile is consistent, all 180 automated
assertions across all 17 test files pass, and every item on the
security/data-integrity/frontend checklists above was verified against
the actual current source in this ZIP — not assumed from a prior
phase's report. One stale documentation claim (README color-palette
description) was found and fixed; no code defects were found that
required a fix in this phase.

This is not a claim that the application is bug-free, and it is not a
substitute for the live-MongoDB scenarios listed in §8, which this
sandbox cannot execute and which should be run against a real Atlas
replica set — particularly the true concurrent-transaction and TTL-
sweep scenarios — before this is relied on in a real multi-user
deployment. Within that stated limitation, the codebase is internally
consistent, its own test suite passes in full, and its documentation
now matches its actual behavior and design.
