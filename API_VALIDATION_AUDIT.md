# API Input Validation, Error Handling & Data-Shape Robustness Audit

Scope of this document: the 20-item checklist for this phase — malformed
JSON, empty bodies, wrong field types, missing/null fields, invalid
ObjectIds, duplicate/huge/negative/fractional/NaN/Infinity numbers, invalid
dates, extremely long strings, unexpected extra fields, invalid enum
values, invalid assignee/project/column/attachment ids, and Mongo
duplicate-key / validation / unexpected errors — across every API route
handler, `src/lib/validation.js`, `src/lib/parseJsonBody.js`,
`src/lib/objectId.js`, `src/lib/mongoErrors.js`, and every Mongoose model.
Every file listed above was opened and read in full before any conclusion
was drawn. Kanban ordering/concurrency logic, attachment storage
architecture, and NextAuth/credentials authentication were explicitly out
of scope and were not modified (see `KANBAN_ORDERING_AUDIT.md`,
`ATTACHMENT_SECURITY_AUDIT.md`, `AUTH_SECURITY_AUDIT.md` for those).

## Headline finding: this codebase's validation was already unusually thorough

Three prior phases (`AUTHZ_TRANSACTION_AUDIT.md`, the validation work
folded into it, and `FINAL_AUDIT.md`) already built and wired up a
consistent set of shared primitives:

- `parseJsonBody()` — swallows `req.json()`'s throw on malformed/empty/
  non-JSON bodies and returns `null`, which every POST/PATCH route checks
  before touching the body.
- `isValidObjectId()` — validates an id is not just hex-and-24-chars but
  round-trips through `new Types.ObjectId(id)` to its own canonical string,
  which rejects the handful of technically-hex-but-non-canonical inputs
  Mongoose's own `isValid()` alone would let through.
- `validation.js`'s `validateRequiredString` / `validateOptionalString` /
  `validateEmailInput` / `validateObjectIdField` / `validateObjectIdArray`
  / `validateOptionalDate` / `validateInteger` / `validateBooleanField` /
  `validateEnumValue` / `validateOptionalEnumValue` — a consistent
  `{ value } | { error }` contract used (or available to be used) by every
  route.
- `mongoErrors.js`'s `mongoErrorResponse()` / `withMongoErrorHandling()` —
  maps `ValidationError`/`CastError`/duplicate-key(11000)/oversized-BSON-
  document errors to safe, fixed, user-facing messages and status codes,
  never leaking the driver's raw message (which can contain field names,
  attempted values, or index names); anything else falls through to a
  generic 500, logged server-side.

Working through every route against the 20-item checklist confirmed this
machinery is applied correctly almost everywhere: malformed JSON, wrong
types, missing/null fields, invalid ObjectIds (path params, body fields,
and the one query param in the app), invalid dates, out-of-range/
fractional/NaN/Infinity numbers, invalid enum values, and cross-project
column/task references are all rejected with a controlled 4xx before
reaching Mongoose. Three concrete gaps were found and fixed; they're
detailed below. Everything else in this section is what was verified
correct as-is, with no code change.

## Issue 1 — `assigneeIds` had no array-size ceiling (checklist #8, huge arrays)

`src/lib/validation.js` has `validateObjectIdArray(value, { max = 500 })`
for exactly this purpose — but it's never actually called from any route.
The array validator every route for assignees actually uses is a separate,
purpose-built one in `src/lib/authz.js`: `validateAssignees(project,
assigneeIds)`, used by both `POST /api/tasks` and `PATCH /api/tasks/[id]`.
It correctly rejected non-arrays, non-ObjectId entries, and ids outside
the project's team, and correctly deduplicated repeated ids (checklist
#7) — but it had no length check at all. A request with tens of thousands
of entries in `assigneeIds` would have every entry `String()`-coerced, put
through a `Set`, and individually passed to `isValidObjectId()` before
being rejected (if any entry were invalid) or accepted (if, say, the same
valid id were repeated enough times to pad the array). That's real,
avoidable CPU/memory work spent on a payload that was never going to be
legitimate — the kind of thing that should be rejected on shape alone,
immediately.

This is also the "audit whether validation rules are duplicated
inconsistently between routes" item (checklist, final paragraph): two
different array-of-ObjectId validators exist in this codebase with two
different behaviors on this exact axis, and the one actually wired into a
route was the one without the cap.

**Fix**: added a `MAX_ASSIGNEE_IDS = 200` ceiling directly in
`validateAssignees()`, checked before the map/dedupe/per-id validation
work runs. 200 is generous — no real team using this app has anywhere
near that many members — so no legitimate request is affected; it exists
purely to reject a pathological payload up front. `validateObjectIdArray`
itself was left as-is (unused but not incorrect; kept in case a future
route needs a general-purpose id-array validator) rather than deleted, to
keep this phase's diff focused on the confirmed issue.

## Issue 2 & 3 — two DELETE routes weren't wrapped in `withMongoErrorHandling` (checklist #18–20)

Grepping every route file for the mongo-error wrapper and cross-checking
against every exported HTTP method found two mutating routes that skip it,
against an otherwise-universal pattern (every other POST/PATCH/DELETE that
writes to the database wraps its write in `withMongoErrorHandling`; GET
routes consistently don't, since they don't write and their inputs are
already validated ids by the time they'd touch Mongoose):

| Route | Method | Was wrapped? |
|---|---|---|
| `DELETE /api/teams/[id]/invitations/[invitationId]` | DELETE | **No** |
| `DELETE /api/tasks/[id]` | DELETE | **No** (its sibling `PATCH` in the same file was) |

In both cases the id(s) involved are already validated (`isValidObjectId`)
before the write, so a `CastError` isn't reachable — the practical risk is
narrower than, say, an unvalidated field reaching a schema. But an
unexpected driver-level error (a dropped connection, a replica-set
stepdown, a timeout) is always possible regardless of how clean the input
is, and without the wrapper that error would propagate uncaught: Next.js
would return its own framework-level error response instead of this app's
`{ error: "..." }` JSON shape. `apiFetch()` (`src/lib/apiFetch.js`)
already tolerates a non-JSON error response by falling back to a generic
"Request failed (500)" message, so this wasn't a user-facing crash — but
it was a real inconsistency: every other mutating route in the app
guarantees a well-formed JSON error body and a message that never contains
raw driver internals, and these two didn't.

**Fix**: wrapped both routes' database calls in `withMongoErrorHandling`,
matching the established pattern exactly (see the routes for the exact
diff — each is a small, mechanical wrap with no change to the underlying
logic).

## Checked and confirmed correct (no change needed)

- **Malformed/empty JSON bodies** — every POST/PATCH route calls
  `parseJsonBody()` and checks for `null` before reading any field.
  Verified directly (not just by convention) for `teams`, `teams/[id]/
  members`, `projects`, `projects/[id]/columns`, `projects/[id]/columns/
  [columnId]`, `tasks`, and `tasks/[id]`.
- **Wrong field types** — every string/date/integer/boolean/enum field
  read from a request body goes through the matching `validate*` helper,
  which type-checks before any further processing (e.g.
  `validateRequiredString` rejects a number or array outright rather than
  coercing it with `String()`).
- **Missing required fields / null values** — required fields (task/
  project/team/column names, emails) are rejected as missing whether
  they're absent, `null`, or an empty/whitespace-only string. Optional
  fields (`description`, `dueDate`, `color`) correctly distinguish
  `undefined` ("not provided, leave unchanged" — relevant for PATCH) from
  `null`/`""` ("explicitly cleared").
- **Invalid ObjectIds** — every path parameter that's used as a Mongo id
  (project, team, task, column, attachment, invitation ids) is checked
  with `isValidObjectId()` before use, including the one query parameter
  in the app (`?userId=` on member removal). A malformed id at any of
  these points returns a 400/403/404 (whichever the route already uses for
  "not found or not yours to see" at that point), never a `CastError`.
- **Duplicate array entries** — `validateAssignees()` deduplicates via
  `Set` before validating membership, so a client re-submitting the same
  id twice (e.g. a double-click) isn't a hard error.
- **Negative numbers / NaN / Infinity / fractional numbers** —
  `validateInteger()` rejects all four categories explicitly
  (`Number.isFinite`, `Number.isInteger`, and an explicit `min`/`max`
  range), used for column `order` (PATCH) and task `targetIndex` (PATCH).
- **Invalid dates** — `validateOptionalDate()` rejects anything that
  doesn't parse to a real calendar date (including the classic
  `new Date("garbage")` → `Invalid Date` trap, which is not `null` and
  would otherwise reach Mongoose as a non-null-but-nonsensical value) while
  still allowing `null`/`""` to explicitly clear the field.
- **Extremely long strings** — every free-text field has an explicit
  `maxLength` enforced server-side (task title 200, description 5000,
  project name 150, project description 2000, team name 100, column name
  60), independent of whatever the frontend's `maxLength` attribute
  happens to allow.
- **Unexpected extra fields** — routes only ever read the specific fields
  they expect off the parsed body; nothing is spread verbatim into a
  Mongoose write. An extra, unrecognized field in a request body is
  silently ignored rather than rejected, matching this app's existing
  intentional behavior (the audit brief explicitly asked not to "blindly
  reject harmless unknown fields").
- **Invalid enum values** — `color` is checked against `TASK_COLORS`'
  actual key list via `validateOptionalEnumValue()`; a client can't smuggle
  through an arbitrary string just because the frontend happens to only
  send known values.
- **Invalid assignee IDs** — `validateAssignees()` (now with the size cap
  from Issue 1) rejects both malformed ids and ids that don't belong to
  the project's manager/team, at both task creation and task update.
- **Invalid project/column combinations** — task creation validates the
  destination column belongs to the specified project (re-checked inside
  the same transaction as the insert, not just once up front — see
  `AUTHZ_TRANSACTION_AUDIT.md` for why that timing matters); task column-
  change via PATCH does the same `Column.findOne({ _id, project })` check
  before planning the move. A column id from a different project is
  rejected as "not found," not silently accepted.
- **Invalid attachment IDs** — both the download and delete routes check
  `isValidObjectId(attachmentId)` before looking it up as a Mongoose
  subdocument id, and treat "valid id, but no such attachment on this
  task" as the same clean 404 as "malformed id."
- **Mongo duplicate-key errors** — `mongoErrorResponse()` maps MongoDB's
  `code: 11000` (checked both on `MongoServerError` specifically and as a
  bare `err.code` fallback, since the exact error class can vary by
  driver/version) to a `409` with a fixed message, for every collection
  that has a uniqueness constraint (`User.email`, `Column`'s
  `(project, order)` compound index, `Invitation`'s `(email, team)`
  compound index).
- **Mongoose validation errors** — `err.name === "ValidationError"` maps
  to a `400` with a fixed message; verified this is reachable (not just
  theoretical) via the `Task.attachments` array's two custom validators
  (max count, max total size), which exist specifically as a schema-level
  backstop behind the upload route's own checks.
- **Unexpected Mongo errors** — every mutating route (after Issues 2/3's
  fix, now *every* mutating route without exception) wraps its database
  work in `withMongoErrorHandling`, which logs unrecognized errors
  server-side and returns a generic, fixed `500` message — never the raw
  error's `message`, `stack`, or any driver-specific field.
- **Multipart/form-data fields** (the one file-upload endpoint,
  `POST /api/tasks/[id]/attachments`) — request size is capped and
  enforced by counting bytes off the stream directly (not trusting a
  possibly-absent or lied-about `Content-Length`) before the body is
  handed to the platform's multipart parser at all; a missing file field,
  a zero-byte file, an oversized file, a MIME/extension mismatch, and a
  file whose actual byte signature doesn't match its claimed type are all
  rejected with a specific 400/413 rather than reaching Mongoose. This
  area was already covered in full by a prior phase
  (`ATTACHMENT_SECURITY_AUDIT.md`); re-verified here, not re-audited from
  scratch, since it was out of this phase's scope to change.
- **Pagination/query values** — the only query parameter in the entire API
  surface (`?userId=` on `DELETE /api/teams/[id]/members`) is validated
  with `isValidObjectId()` before use; there is no list endpoint with
  offset/limit/cursor parameters to check.

## Files changed

- `src/lib/authz.js` — added `MAX_ASSIGNEE_IDS = 200` and the length check
  in `validateAssignees()` (Issue 1).
- `src/app/api/teams/[id]/invitations/[invitationId]/route.js` — wrapped
  the `DELETE` handler's `Invitation.deleteOne()` call in
  `withMongoErrorHandling` (Issue 2).
- `src/app/api/tasks/[id]/route.js` — wrapped the `DELETE` handler's
  `Task.findByIdAndDelete()` call in `withMongoErrorHandling` (Issue 3).

## Tests added

New file `__manual_test__/17-api-validation-audit.test.cjs` (11 tests),
following the existing harness/mock-require pattern:

- **`validateAssignees` size ceiling** — an oversized (50,000-entry) array
  is rejected with a "too many" error; a normal 2-id array still works
  unchanged; a large-but-plausible 150-member team is still accepted
  (proves the ceiling doesn't affect any real usage).
- **`DELETE /api/teams/[id]/invitations/[invitationId]`** — an unexpected
  DB error now returns a clean JSON `500` whose message never contains the
  raw driver error text; the happy path (successful delete) still works
  correctly after the wrap; a non-manager is still rejected with `403`
  before any delete is attempted (confirms the authorization check itself
  wasn't disturbed by the wrap).
- **`DELETE /api/tasks/[id]`** — same two cases: an unexpected DB error
  now returns a clean JSON `500` instead of an uncaught throw, and the
  happy path still deletes and responds `{ ok: true }`.
- **Route-level spot checks** not already covered by
  `08-authz-and-validation.test.cjs`'s pure-function unit tests: `POST
  /api/teams` rejects a genuinely unparseable JSON body with `400`; `POST
  /api/tasks` rejects a non-array `assigneeIds` (e.g. a bare string) with
  `400`; `PATCH /api/projects/[id]/columns/[columnId]` rejects a
  fractional `order` value with `400`.

## Commands run

```
npm install                                                # 505 packages, 0 vulnerabilities
node __manual_test__/01-pure-ordering.test.cjs              # 9 passed
node __manual_test__/02-mongo-transaction.test.cjs           # 5 passed
node __manual_test__/03-column-order-retry.test.cjs          # 4 passed
node __manual_test__/04-done-column-transaction.test.cjs     # 5 passed
node __manual_test__/05-task-create-transaction.test.cjs     # 3 passed
node __manual_test__/06-limited-form-data.test.cjs           # 7 passed
node __manual_test__/07-email-html-escaping.test.cjs         # 9 passed
node __manual_test__/08-authz-and-validation.test.cjs        # 17 passed
node __manual_test__/09-registration-transaction.test.cjs    # 8 passed
node __manual_test__/10-rate-limit.test.cjs                  # 9 passed
node __manual_test__/11-auth-hardening.test.cjs              # 25 passed
node __manual_test__/12-transaction-fallback-routes.test.cjs # 4 passed
node __manual_test__/13-column-task-race.test.cjs            # 5 passed
node __manual_test__/14-attachment-security.test.cjs         # 35 passed
node __manual_test__/15-kanban-ordering-audit.test.cjs       # 17 passed
node __manual_test__/16-frontend-reliability-audit.test.cjs  # 7 passed
node __manual_test__/17-api-validation-audit.test.cjs        # 11 passed (new)
npm run build
npm audit
npm audit --omit=dev
```

## Validation result

- **All 180 manual-test assertions across 17 files pass** (169
  pre-existing + 11 new), confirming this phase introduced no regressions
  to Kanban ordering, transactions, authz, attachments, auth hardening, or
  frontend reliability from any prior phase.
- `npm run build` — succeeds (`✓ Compiled successfully`), all 16 API
  routes + 8 pages generated, no type/lint errors. (Build-time page-data
  collection requires `MONGODB_URI`/`NEXTAUTH_SECRET`/`NEXTAUTH_URL` to be
  set to *something* syntactically valid, same as every prior phase's
  build — no real credentials are needed or were used.)
- `npm audit` and `npm audit --omit=dev` — **0 vulnerabilities** both
  ways. No dependencies were added, removed, or changed this phase.

## Remaining issues / explicitly out of scope

- `validateObjectIdArray()` in `validation.js` remains unused. It's not
  incorrect — just dead code that happens to duplicate part of what
  `validateAssignees()` now also does. Left in place rather than removed,
  since deleting unused-but-harmless code wasn't part of this phase's
  scope and a future route needing a plain "array of ids, no
  business-rule filtering" validator can reach for it directly.
- Kanban ordering/drag-and-drop logic, the attachment storage
  architecture, and NextAuth/credentials authentication were not touched,
  per this phase's explicit scope — see `KANBAN_ORDERING_AUDIT.md`,
  `ATTACHMENT_SECURITY_AUDIT.md`, and `AUTH_SECURITY_AUDIT.md`
  respectively for those areas' own audits.
- As with every prior phase, this test suite runs entirely against
  in-memory mocks, not a live MongoDB replica set — it proves the
  application-level logic (validation branches, error-mapping, response
  shapes) is correct for every input it simulates, not that a live
  MongoDB Atlas cluster's own error shapes match exactly what
  `mongoErrorResponse()` expects. No new manual-verification item is added
  by this phase beyond the ones already tracked in `CHANGELOG.md`, since
  no new live-database-dependent behavior was introduced.
