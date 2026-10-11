# Manual test harness

Not part of the shipped app; a standalone Node test harness for the
application's server-side logic: the
real, unmodified route/lib files are loaded directly (via `@babel/register`,
which understands the same `@/*` -> `src/*` alias as `jsconfig.json`), with
only their Mongoose/Next.js/next-auth dependencies swapped for small
in-memory fakes.

## Run

```
npm install
npm test                      # every NN-*.test.cjs file, one process each
npm test -- 35 reorder        # only files whose name contains "35" or "reorder"
node __manual_test__/35-column-reorder.test.cjs   # a single file, directly
```

`npm test` (`scripts/run-tests.cjs`) discovers the files by name, so a new
test file is picked up automatically. It replaces the hand-maintained list
of `node ...` commands that used to live here, which had drifted from the
files actually in this directory.

Notes on individual files:

- `50-config-email-membership-m7-m10.test.cjs` takes ~15 s (it includes a
  real 5 s SMTP greeting-timeout check); the bcrypt-based auth tests
  (`11`, `30`, `49-security-m1-m6`) are also slow. The full run takes a
  few minutes.
- `45-share-token-live-mongo.test.cjs` and the live-index half of
  `49-hot-path-indexes-h6.test.cjs` need `MONGODB_TEST_URI`; without a live
  mongod they print SKIPPED and exit 0.
- `register.cjs` sets `PASSWORD_HASHER=bcryptjs` so the many files that mock
  `bcryptjs` with fast fakes keep working (`src/lib/passwordHash.js` would
  otherwise prefer the native `bcrypt` addon). `59-low-account-team-lifecycle-l17-l19`
  switches it per case to test the native path and the fallback.
- Two files share the number `49-` (`49-security-m1-m6`,
  `49-hot-path-indexes-h6`); both run.

`10-rate-limit.test.cjs` and `11-auth-hardening.test.cjs` (added in the
Authentication & Abuse-Protection Hardening phase)
share `fakeRateLimitModel.cjs`, an in-memory fake for the new
`RateLimitAttempt` model used by `src/lib/rateLimit.js`. Same caveat as
below: it proves the application's aggregation-pipeline logic is
correct, not that a live MongoDB server executes concurrent updates
against it with the atomicity the design depends on.

`14-attachment-security.test.cjs` (Task Attachment Security audit) covers filename
sanitization, MIME/extension/magic-byte validation, the
`getTaskAccess()` attachment-data projection, DTO hygiene, and both
attachment routes' authorization, limits, and atomic upload/delete
behavior. Same caveat as the rate-limit tests: the atomic
`Task.updateOne()` filter used to close the upload count/total-size race
is exercised by mocking `Task.updateOne` and asserting the route sends
the right filter and reacts correctly to both possible outcomes — not by
a live MongoDB server actually serializing two concurrent requests. That needs a real Atlas cluster to
verify.

`15-kanban-ordering-audit.test.cjs` (Kanban Ordering & Drag-and-Drop
audit) covers
`planTaskMove()` end to end against an in-memory `Task` collection
(move to beginning/middle/end, drop immediately before/after a specific
task, moving a task around itself, rebalance-on-no-room, cross-column
moves), the `PATCH /api/tasks/[id]` route with a transactional in-memory
buffer (reorder, cross-column move, rollback-on-failure), a documented
concurrent-tie scenario for two simultaneous moves into the same column,
a concurrent move+create scenario, and `currentSiblingIndex()` (the
tie-break-aware helper the client's no-op detection now shares with
`compareTasks`). Same transaction caveat as the tests above: this proves
the application code's read-plan-write sequence is correctly scoped to
one session and rolls back cleanly, not that a live replica set
serializes two truly concurrent transactions the way `withTransaction`'s
driver-level retry assumes.

`17-api-validation-audit.test.cjs` (API Validation audit) covers the three confirmed
gaps that phase's 20-point validation checklist found (an unbounded
`assigneeIds` array, and two routes' unexpected-error handling), plus a
few route-level spot checks for malformed-body/wrong-type edge cases not
already covered by `08-authz-and-validation.test.cjs`.

`18-ip-trust-hardening.test.cjs` (Final Release Cleanup phase) covers `src/lib/clientIp.js`'s
`RATE_LIMIT_TRUST_PROXY` trust gate (well-formed/malformed/missing
`x-forwarded-for` and `x-real-ip`, multi-hop chains, IPv6), and
`register/route.js`'s no-ip-fallback bucket that keeps registration
rate-limited even when `RATE_LIMIT_TRUST_PROXY=none` makes the real
per-client IP unavailable.

`19-invitation-rate-limit.test.cjs` (Final Release Cleanup phase) covers `POST /api/teams/[id]/members`'s new
invitation-email rate limiting: per-manager, per-team, and per-IP
limits: that authorization is still checked first; that the
existing-invite 409 and existing-user "added" paths are unaffected; and
that adding an already-registered user (no email sent) is never
rate-limited by this specific limiter.

`20-nodemailer-version-regression.test.cjs` (nodemailer security floor —
9.1.1 -> 10.0.14, audit H4) confirms the installed package, the exact
`package.json` dependency and override pins, and the `package-lock.json`
entry are all at or above 10.0.14, and exercises the real (unstubbed)
`createTransport()` / `sendMail()` surface against email.js's exact config
shape using nodemailer's built-in `streamTransport` mode, so no network
connection is opened. Unlike `07-email-html-escaping.test.cjs`, which stubs
`createTransport()` out entirely, this test calls into the real
installed dependency to catch a breaking API change from a version
bump. Also re-runs `sendVerificationEmail()`'s no-SMTP-configured
fallback path with the real import loaded.

`22-rename-entities.test.cjs` (Rename Projects/Tasks/Teams/Columns
feature) covers the two new endpoints this phase adds — `PATCH
/api/projects/[id]` and `PATCH /api/teams/[id]` — for authorization
(manager-only, 401/403 before any write), validation (empty and
whitespace-only names rejected with 400, nothing persisted), and the
happy path (name trimmed and persisted via the expected `$set`). It
also re-checks, at the route level, that the two rename paths this
phase reuses rather than duplicates — task title (`PATCH
/api/tasks/[id]`) and column name (`PATCH
/api/projects/[id]/columns/[columnId]`) — still reject a
whitespace-only name without saving.

`25-group-tasks-by-project.test.cjs` (Separate Open/Closed Tasks by
Project) covers `src/lib/groupByProject.js`, the pure
helper `OverviewStats.jsx` uses to group its "My open tasks" and "Tasks
completed" lists by project: per-project ordering and item order are
preserved, a project with nothing in the current list produces no group
(no empty/broken section), and grouping works for an arbitrary number of
projects with no task ever appearing under the wrong one. The
component's own rendering (headings, the per-project color dot) isn't
covered by this harness for the same reason noted in
`16-frontend-reliability-audit.test.cjs` — no DOM/React renderer in this
sandbox — and was verified by inspection and `npm run build`.

`26-project-membership.test.cjs` (Per-Project Team Membership) covers `projectAccessFor()`'s legacy-(unrestricted) vs.
access-restricted distinction, `validateAssignees()` staying in step
with it, `filterAccessibleProjects()`, `applyProjectMembership()`'s
seed-then-mutate behavior, the `POST`/`DELETE
/api/projects/[id]/members` route, and `GET /api/projects/[id]` /
`GET /api/projects` end to end through the real (unmocked) authz.js.

`27-project-editing-permission.test.cjs` (Project-Level Editing
Permission; the change-request flow was later removed in favor of
manager-controlled edit access) covers `canEditProject()` /
`isManagerApprovalMode()` (the second, narrower gate on top of
`projectAccessFor()`'s view-access one above) and
`applyProjectEditPermission()`; the new `POST`/`DELETE
/api/projects/[id]/editors` route; `PATCH /api/projects/[id]` accepting
the new `editingMode` field. A last section spot-checks that the
mutation routes (tasks, columns, attachments) actually call
`canEditProject` and 403 when it returns false, proving the wiring
rather than re-testing the pure logic above, and asserts that the
removed change-request flow stays removed (no `ChangeRequest` model,
no `change-requests` API routes, no `RequestChangeDialog` /
`ChangeRequestsPanel` components).

`30-auto-signin-after-verification.test.cjs` (Automatic Sign-In After
Email Verification feature) covers the new `lib/autoLoginToken.js`
(issue/consume: single-use, short-lived, hashed-at-rest, rejects
tampered/expired/malformed input without touching the database);
`verify-email/route.js` issuing a one-time `autoLoginToken` alongside its
existing `{ok:true}` response only on a genuine first-time success, and
that this is best-effort — a failure generating that token never turns
an already-committed verification into an error response, nor does an
invalid/expired/reused verification token ever trigger issuance in the
first place; and `auth.js`'s new `authorize()` branch for that token
(resolves the correct user while ignoring any client-supplied
email/password, rejects an invalid/expired/reused/not-actually-verified
token or one resolving to no user, is rate-limited per-IP independently
of the existing login limiter), plus a regression check that the
existing email/password sign-in path never touches
`consumeAutoLoginToken` at all.

`32-forgot-password-reset.test.cjs` (Forgot Password / Reset Password
feature) covers `lib/passwordResetToken.js` (hashed-at-rest, single-use,
expiring, a new request invalidates the old link, malformed input never
reaches the database); `forgot-password/route.js` (identical `{ok:true}`
for known and unknown emails and under SMTP failure or rate limiting,
per-email and per-IP limits); `reset-password/route.js` (server-side
password validation, generic 400 for every bad-token case, replay and
expiry rejected, per-IP 429, nothing sensitive logged); an end-to-end
check that the old password stops working and the new one passes the real
`authorize()`; the strength scorer; and the reset email's content and
HTML escaping.

`58-low-docs-sw-redirect-l11-l16.test.cjs` (Low-priority maintenance, L11-L16)
checks that no source, test or README mentions a missing upper-case
`.md` document; the shared-board service worker (`public/sw.js`, run in a `vm`
with an in-memory Cache Storage: build-versioned cache name, old-cache
cleanup on activate, `/_next/static/`-only asset scope, network-first with
offline fallback, entry cap); `redirectIfSignedIn()` for the login/register
layouts; `buildContentDisposition()`/`encodeRfc5987()` (RFC 5987 `attr-char`
output, Unicode round trip, lone surrogates); the `columnContentWidthSx`
`cqw` fallback, including the CSS MUI actually generates for it; and the
split task/column `deleting` state in `KanbanBoard.jsx` (source-level, as
there is no React renderer here). Real-browser behavior is not covered.

`62-shared-board-h4.test.cjs` (audit H4, public shared-board endpoint) covers: the limiter's opt-in
`failClosed` mode (and that the default stays fail-open for other endpoints); `GET /api/shared/board/[token]`
rate limiting with a trusted IP, with an unknown IP, and with `RATE_LIMIT_TRUST_PROXY=none` (spoofed
headers ignored, one bounded fallback bucket, window expiry, ceiling and `Retry-After`); 503 when the
limiter or `connectDB` fails; unchanged 404 semantics for malformed/unknown/disabled/revoked/regenerated
tokens; valid read-only access without private data; and the response bounds (column/task/assignee/
attachment/description limits, deterministic prefix truncation, true per-column counts, the byte budget
and a worst-case board against the ~4.5 MB platform limit). `31-share-project-board.test.cjs` was
updated: its old "no IP means never rate-limited" check asserted the H4 weakness and now asserts the
fallback bucket instead.

## What these do and don't prove

- The in-memory fakes in `04-done-column-transaction.test.cjs` and
  `05-task-create-transaction.test.cjs` simulate MongoDB's transaction
  commit/rollback semantics (buffer writes, only apply them if the
  transaction callback resolves) well enough to prove the *application
  code* correctly scopes every write of a given operation to one
  session/transaction, and correctly propagates a mid-transaction
  failure instead of leaving a partial state.
- They do **not** exercise MongoDB's actual server-side write-conflict
  detection between two truly concurrent transactions — that requires a
  live replica set (Atlas, or `mongodb-memory-server` with a replica-set
  config), which this sandbox has no network access to download. Verify that against a real
  cluster before relying on this in production.

Some console.error output during the "failure" test cases (e.g.
`simulated network drop mid-transaction`) is expected — it's
`withMongoErrorHandling`'s normal server-side logging for an
unrecognized error, not a test failure.
