# Manual test harness — Phase 2 (ordering & concurrency)

Not part of the shipped app; a standalone Node test harness for the
concurrency fixes in this phase, following the same approach as the
prior phase's registration-transaction tests (see CHANGELOG.md): the
real, unmodified route/lib files are loaded directly (via `@babel/register`,
which understands the same `@/*` -> `src/*` alias as `jsconfig.json`), with
only their Mongoose/Next.js/next-auth dependencies swapped for small
in-memory fakes.

## Run

```
npm install
node __manual_test__/01-pure-ordering.test.cjs
node __manual_test__/02-mongo-transaction.test.cjs
node __manual_test__/03-column-order-retry.test.cjs
node __manual_test__/04-done-column-transaction.test.cjs
node __manual_test__/05-task-create-transaction.test.cjs
node __manual_test__/06-limited-form-data.test.cjs
node __manual_test__/07-email-html-escaping.test.cjs
node __manual_test__/08-authz-and-validation.test.cjs
node __manual_test__/09-registration-transaction.test.cjs
node __manual_test__/10-rate-limit.test.cjs
node __manual_test__/11-auth-hardening.test.cjs
node __manual_test__/12-transaction-fallback-routes.test.cjs
node __manual_test__/13-column-task-race.test.cjs
node __manual_test__/14-attachment-security.test.cjs
node __manual_test__/15-kanban-ordering-audit.test.cjs
node __manual_test__/16-frontend-reliability-audit.test.cjs
node __manual_test__/17-api-validation-audit.test.cjs
node __manual_test__/18-ip-trust-hardening.test.cjs
node __manual_test__/19-invitation-rate-limit.test.cjs
node __manual_test__/20-nodemailer-version-regression.test.cjs
```

(No `npm test` script was added — this app has none today, and adding
one was outside this phase's scope.)

`10-rate-limit.test.cjs` and `11-auth-hardening.test.cjs` (added in the
Authentication & Abuse-Protection Hardening phase — see CHANGELOG.md)
share `fakeRateLimitModel.cjs`, an in-memory fake for the new
`RateLimitAttempt` model used by `src/lib/rateLimit.js`. Same caveat as
below: it proves the application's aggregation-pipeline logic is
correct, not that a live MongoDB server executes concurrent updates
against it with the atomicity the design depends on.

`14-attachment-security.test.cjs` (Task Attachment Security audit — see
ATTACHMENT_SECURITY_AUDIT.md and CHANGELOG.md) covers filename
sanitization, MIME/extension/magic-byte validation, the
`getTaskAccess()` attachment-data projection, DTO hygiene, and both
attachment routes' authorization, limits, and atomic upload/delete
behavior. Same caveat as the rate-limit tests: the atomic
`Task.updateOne()` filter used to close the upload count/total-size race
is exercised by mocking `Task.updateOne` and asserting the route sends
the right filter and reacts correctly to both possible outcomes — not by
a live MongoDB server actually serializing two concurrent requests. See
ATTACHMENT_SECURITY_AUDIT.md's manual test matrix for what to run against
a real Atlas cluster.

`15-kanban-ordering-audit.test.cjs` (Kanban Ordering & Drag-and-Drop
audit — see KANBAN_ORDERING_AUDIT.md and CHANGELOG.md) covers
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

`17-api-validation-audit.test.cjs` (API Validation audit — see
API_VALIDATION_AUDIT.md and CHANGELOG.md) covers the three confirmed
gaps that phase's 20-point validation checklist found (an unbounded
`assigneeIds` array, and two routes' unexpected-error handling), plus a
few route-level spot checks for malformed-body/wrong-type edge cases not
already covered by `08-authz-and-validation.test.cjs`. This file exists
in the shipped test suite as of that phase but was missing from this
README's run list until the Final Release Cleanup phase caught the
mismatch — see CHANGELOG.md.

`18-ip-trust-hardening.test.cjs` (Final Release Cleanup phase — see
FINAL_RELEASE_CLEANUP.md) covers `src/lib/clientIp.js`'s
`RATE_LIMIT_TRUST_PROXY` trust gate (well-formed/malformed/missing
`x-forwarded-for` and `x-real-ip`, multi-hop chains, IPv6), and
`register/route.js`'s no-ip-fallback bucket that keeps registration
rate-limited even when `RATE_LIMIT_TRUST_PROXY=none` makes the real
per-client IP unavailable.

`19-invitation-rate-limit.test.cjs` (Final Release Cleanup phase — see
FINAL_RELEASE_CLEANUP.md) covers `POST /api/teams/[id]/members`'s new
invitation-email rate limiting: per-manager, per-team, and per-IP
limits: that authorization is still checked first; that the
existing-invite 409 and existing-user "added" paths are unaffected; and
that adding an already-registered user (no email sent) is never
rate-limited by this specific limiter.

`20-nodemailer-version-regression.test.cjs` (Final Security Patch —
Nodemailer 9.0.5 -> 9.1.1 — see FINAL_SECURITY_PATCH.md and
CHANGELOG.md) confirms the installed package resolves to the patched
9.1.x line, and exercises the real (unstubbed) `createTransport()` /
`sendMail()` surface against email.js's exact config shape using
nodemailer's built-in `streamTransport` mode, so no network connection
is opened. Unlike `07-email-html-escaping.test.cjs`, which stubs
`createTransport()` out entirely, this test calls into the real
installed dependency to catch a breaking API change from the version
bump. Also re-runs `sendVerificationEmail()`'s no-SMTP-configured
fallback path with the real import loaded.

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
  config), which this sandbox has no network access to download. See
  CHANGELOG.md's manual test matrix for what to run against a real
  cluster before relying on this in production.

Some console.error output during the "failure" test cases (e.g.
`simulated network drop mid-transaction`) is expected — it's
`withMongoErrorHandling`'s normal server-side logging for an
unrecognized error, not a test failure.
