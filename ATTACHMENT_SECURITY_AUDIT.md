# Task Attachment Security, Validation, Memory & Storage Audit

Scope: everything about task attachments — per-file/total/count limits,
multipart request-size limits, MIME/extension/magic-byte validation,
filename sanitization, Content-Disposition safety, authorization on
download/delete, Base64 exposure in DTOs and queries, memory amplification,
the 16MB BSON ceiling, download/content-sniffing behavior, concurrent
upload/delete races, failure behavior, and client/server limit consistency.
No authentication changes, no team-authorization changes beyond what
attachment access itself requires, no Kanban ordering changes, no UI
redesign. Every file in scope was read directly before any change.

Files inspected: `lib/attachmentPolicy.js`, `lib/limitedFormData.js`,
`models/Task.js`, `app/api/tasks/[id]/attachments/route.js`,
`app/api/tasks/[id]/attachments/[attachmentId]/route.js`, `lib/authz.js`,
`lib/serialize.js`, `components/TaskDetailDialog.jsx`, `lib/mongoErrors.js`,
and every other file in the codebase that queries the `Task` model.

## Starting point: this was already a well-hardened subsystem

Unlike some of the codebase's other subsystems at the start of prior
phases, attachments arrived at this audit already covering most of the
list below — `lib/attachmentPolicy.js` and `lib/limitedFormData.js` read
like the output of a previous, careful pass (their inline comments
reference "Phase 3 attachment-security fix," and `06-limited-form-data.test.cjs`
already existed). This audit's job was mostly to verify those claims by
reading the actual code and writing tests against it, not to build this
from scratch. One real, previously-unnoticed bug was found (see below).

## What was already correct (verified, not just re-read from comments)

- **Per-file size** — enforced server-side (`MAX_FILE_SIZE`, 5MB) after
  the file is in memory, independent of anything the client claims.
- **Multipart request-size** — `lib/limitedFormData.js` rejects an
  over-budget request from a declared `Content-Length` without reading
  the body at all, and independently aborts the stream mid-read the
  moment actual bytes cross the limit — so a client that lies about
  `Content-Length` can't use that lie to get an oversized body accepted.
  Verified this still holds with the existing `06-limited-form-data.test.cjs`
  plus new route-level tests in `14-attachment-security.test.cjs`.
- **MIME + extension + magic-byte validation** — `validateAttachmentFile()`
  requires all three to agree: an extension not paired with its declared
  MIME type is rejected before the file's bytes are even inspected, and a
  file whose actual bytes don't match the claimed type (e.g. a renamed
  `.exe` served as `image/png`, or an arbitrary binary renamed to `.txt`)
  is caught by the signature/heuristic check. Verified with new tests
  covering: mismatched extension/MIME, disallowed MIME (`image/svg+xml`,
  which also rules out an SVG-based script-injection vector), a
  double-extension disguise (`resume.pdf.exe`), a corrupted/mislabeled
  PNG, and a binary renamed to `.txt`.
- **Filename sanitization** — `sanitizeFilename()` strips path
  components (defeats `../../etc/passwd`-style traversal), control
  characters, quotes, and backslashes (defeats header injection via a
  crafted filename), and truncates absurdly long names while keeping the
  extension. Verified with new tests.
- **Content-Disposition safety** — always `attachment` (never `inline`),
  built from the already-sanitized filename with both an ASCII fallback
  and an RFC 5987 `filename*` for non-ASCII names, plus
  `X-Content-Type-Options: nosniff` on the response — so even a
  successfully-uploaded file with a browser-sniffable but misleading
  payload can't get rendered inline instead of downloaded.
- **Authorization before attachment access** — both the download and
  delete routes go through `getTaskAccess()`, which walks task → project →
  team and denies anyone who isn't the project's manager or a member of
  its team, with a flat 403 (not a 404 that would leak whether the task
  exists to someone who can't see it). Because the attachment is looked
  up as `task.attachments.id(attachmentId)` *within* the already
  access-checked task, there's no cross-task IDOR: an attachment ID that
  belongs to a different task simply isn't found. Verified with new
  401/403/404 tests on both routes.
- **Base64 exposure in DTOs** — `toAttachmentDTO()` only ever reads
  `filename`/`mimeType`/`size`/`uploadedAt` off the source document, so
  even if a caller accidentally loaded `data` (or a future field gets
  added to `AttachmentSchema`), it can't leak through the DTO layer by
  accident. Verified with a test that deliberately hands it a document
  carrying a `data` field and confirms it doesn't survive.
- **Memory amplification / accidental Base64 loading in queries** —
  every `Task` query in the codebase outside the single-attachment
  download route explicitly excludes it:

  | File | Query | Excludes `attachments.data`? |
  |---|---|---|
  | `lib/authz.js` (`getTaskAccess`) | `Task.findById(...).select(...)` | Yes, unless `includeAttachmentData: true` is passed explicitly |
  | `app/api/projects/[id]/route.js` | `Task.find({ project: id })` | Yes (`.select("-attachments.data")`) |
  | `app/api/projects/route.js` | `Task.find({ project: { $in: ... } })` | Yes |
  | `app/api/tasks/[id]/route.js` (PATCH) | `Task.findById(...)` | Yes |
  | `app/api/tasks/[id]/route.js` (DELETE) | `Task.findByIdAndDelete(...)` | Yes — even though the deleted doc is discarded, excluding it means a task with several MB of attachments doesn't get that data hydrated into memory just to be thrown away |
  | `app/api/tasks/route.js` (POST) | `Task.findById(...)` | Yes |
  | `lib/taskOrdering.js` | `Task.findOne(...)` / `Task.find(...)` | Yes (narrow `.select()` that never mentions `data`) |
  | `app/api/tasks/[id]/attachments/[attachmentId]/route.js` (GET) | `getTaskAccess(..., { includeAttachmentData: true })` | **No — intentionally**, this is the one route that needs the real bytes |

  `getTaskAccess()`'s opt-in flag is the single choke point for this, and
  is unit-tested directly (`14-attachment-security.test.cjs`) to confirm
  the projection is applied by default and skipped only when explicitly
  requested.
- **16MB BSON ceiling** — `MAX_TOTAL_ATTACHMENTS_SIZE` (8MB raw → ~10.9MB
  base64) leaves multiple MB of headroom under the 16MB document limit
  for the rest of a task's fields, and `mongoErrors.js` has a defensive,
  message-pattern-matched fallback that turns a hypothetical
  document-too-large error from the driver into a clean 413 instead of a
  raw 500, in case the caps are ever misconfigured.
- **Download behavior / content sniffing** — covered above under
  Content-Disposition; also verified the response actually serves the
  stored `mimeType` and the exact byte length via `Content-Length`.
- **Client/server limit consistency (mostly)** — the per-file-size and
  attachment-count limits are already imported by `TaskDetailDialog.jsx`
  from the same `lib/attachmentPolicy.js` constants the server enforces,
  so client-side UI copy and pre-upload checks can't drift from the
  server. One gap here — see fixes below.

## Real bug found: a check-then-write race on the count/total-size limits

**This is the one finding from this audit that wasn't already covered.**

The upload route read `task.attachments` once at the top of the request,
checked the count and running total against it, and only pushed +
`task.save()`d after both checks passed. That's a classic
check-then-write race: two uploads to the *same task*, arriving close
enough together, can each read the array before the other's write
commits, each see themselves as "one under the limit," and each pass —
landing the task over either the 20-attachment count cap or the 8MB
total-size cap once both writes land.

I initially assumed Mongoose's document versioning (`__v`) would close
this the same way it protects against other lost-update races elsewhere
in this app, and looked at using `optimisticConcurrency: ['attachments']`
on the schema (scoped only to the attachments path, so it wouldn't affect
concurrent edits to a task's title/description/move, which is all outside
this audit's scope). **I verified directly against Mongoose's source
that this specific idea doesn't work here** — and it's worth recording
why, so nobody reaches for it again later expecting it to help:

> Mongoose's `document.$__version()` only adds `__v` to a save's `where`
> clause if `__v` itself is considered "selected" on that document
> (`this.$__isSelected(key)`). Every route that mutates attachments loads
> the task via `getTaskAccess()`, which uses `.select("-attachments.data")`
> — a nested-field exclusion projection. I confirmed empirically (by
> hydrating a document with that exact projection shape and inspecting
> `$__delta()`'s output) that Mongoose's `isSelected()` heuristic
> misreads this projection shape as "some fields may be missing," and
> concludes `__v` isn't safely selected — silently skipping the version
> check entirely. In other words: the memory-optimization projection
> this codebase already correctly uses everywhere (to avoid loading
> attachment bytes for auth/mutation) accidentally disables Mongoose's
> optimistic concurrency for exactly the documents this fix would need
> to protect. Switching the write path to load the *full* document
> (dropping the projection) to make versioning work would reintroduce
> the multi-MB memory-amplification problem that projection exists to
> prevent — trading one audit finding for another.

**Fix**: replaced `task.attachments.push(...) + task.save()` with a
single atomic `Task.updateOne()` whose *filter* re-checks both limits
against the document's true current state at write time:

```js
await Task.updateOne(
  {
    _id: task._id,
    $expr: {
      $and: [
        { $lt: [{ $size: "$attachments" }, MAX_ATTACHMENTS_PER_TASK] },
        { $lte: [{ $add: [{ $sum: "$attachments.size" }, file.size] }, MAX_TOTAL_ATTACHMENTS_SIZE] },
      ],
    },
  },
  { $push: { attachments: { filename, mimeType, size: file.size, data } } }
);
```

This makes the check-and-write one atomic operation on the database
itself, so two concurrent uploads are serialized by MongoDB rather than
by anything in the Node process — whichever commits first is evaluated
against the real current state, and the second against what the first
just wrote. If the update matches zero documents (the race was lost, or
the limit changed underneath the earlier in-route checks), the route now
returns **409 Conflict** with a message suggesting a refresh, instead of
either silently succeeding over the limit or surfacing a confusing 500.
The up-front, non-atomic checks earlier in the route are kept — they
give a specific, friendly 400 in the overwhelmingly common
non-concurrent case; the atomic filter is the actual guarantee, not the
primary UX path.

The delete route was also switched from `subdoc.deleteOne() + task.save()`
to an atomic `Task.updateOne({ _id }, { $pull: { attachments: { _id } } })`.
Deleting can't push a task over any limit, so there's no equivalent
correctness bug there — this change is about not depending on loading
and re-saving the full (metadata-only) attachments array just to remove
one element, and about keeping both routes on the same, simpler pattern.

**Schema-level defense in depth added alongside this**: `AttachmentSchema`
now caps `size` at `MAX_FILE_SIZE`, and the `attachments` array gained a
second validator (next to the existing count validator) checking the
summed `size` against `MAX_TOTAL_ATTACHMENTS_SIZE`. These run on
`.save()`/`.validate()`, not on the new atomic `updateOne()` path — they
exist as a backstop for any future code that mutates attachments via
`.push()` + `.save()` instead of the atomic route, not as the primary
enforcement mechanism.

## Minor gap closed: client/server total-size check

`TaskDetailDialog.jsx` already pre-checked per-file size and attachment
count client-side (using the shared `attachmentPolicy.js` constants)
before ever calling the upload endpoint, but not the running total-size
limit — a file that would push the task over 8MB total was only caught
after a round trip to the server. Added the same running-total check
client-side, using the identical arithmetic the server uses. This is
UX only; the server-side check (and now the atomic race-guard) remains
the actual enforcement.

## Failure behavior

- **Upload validation failure** (bad type/extension/signature, over any
  limit): rejected before any database write; the in-memory `task`
  object loaded for the checks is never mutated or saved, so a rejected
  upload can't leave a task half-updated.
- **Upload database failure** (including a hypothetical BSON-too-large
  error): the atomic `updateOne()` either fully applies or doesn't;
  there's no intermediate state, and `mongoErrors.js`'s existing
  message-pattern fallback still converts a too-large-document error
  into a clean 413 rather than a raw 500.
- **Upload race lost** (matched zero documents): 409, distinct from the
  400s used for the up-front checks, since retrying may now succeed (or
  fail for a different, current reason) rather than being the same
  request failing the same way again.
- **Delete of an already-gone or wrong-task attachment id**: 404, both
  for a malformed id (validated before it reaches Mongoose, avoiding an
  uncaught `CastError`) and for one that doesn't exist on this task.

## What couldn't be tested in this sandbox

Same limitation noted in the prior transaction-hardening audit: there's
no live MongoDB (replica-set or otherwise) available here, so nothing
above was verified against a real server actually executing the
`$expr`/`$size`/`$sum` atomic filter under true concurrent load. What
*is* verified: the query shape uses only standard, long-stable MongoDB
query-language features (`$expr` in a query filter has been supported
since MongoDB 3.6; `$size`/`$sum`/`$add` as aggregation expressions
inside `$expr` are unchanged since then too — Atlas, this app's only
supported deployment target, is comfortably past that version), and the
route correctly builds that filter and handles both possible outcomes
(`matchedCount` 1 or 0). Manual test matrix for Hadiseh to run against a
real Atlas cluster before relying on this:

1. Fire two uploads to the same task at (as close to) the same instant,
   where the task currently has 19 attachments — expect exactly one
   `201` and one `409`, and the task ends up with 20 attachments, never
   21.
2. Same setup, but sized so the *count* is fine and only the *running
   total* would be exceeded by both succeeding (e.g. current total 6MB,
   two concurrent 2.5MB uploads) — expect one `201`, one `409`, final
   total ≤ 8MB.
3. Two concurrent deletes of two *different* attachments on the same
   task — expect both to succeed (`200`), and the task ends up with both
   removed (no lost update from the simpler `$pull`-per-call approach).
4. A single upload sized so the resulting document would cross 16MB
   (only reachable by deliberately misconfiguring the caps for this
   test) — expect a 413 with the "too large to store" message, not a
   500.

## Tests added

`__manual_test__/14-attachment-security.test.cjs` (35 cases): filename
sanitization (traversal, control characters, header-breaking characters,
length truncation), MIME/extension/magic-byte validation (valid PNG/PDF,
mismatched extension, disallowed MIME, double-extension disguise,
corrupted signature, binary-renamed-to-`.txt`), `getTaskAccess()`'s
attachment-data projection (default-excluded, opt-in included, denied
for an outsider), DTO hygiene (`toAttachmentDTO`/`toTaskDTO` never leak
`data` even when it's present on the source document), and route-level
coverage for both attachment endpoints: 401/403 on both, oversized
declared `Content-Length` rejected before any DB access, oversized file,
zero-byte file, attachment-count limit, total-size limit, a mislabeled
file rejected before ever reaching `Task.updateOne`, a valid upload's
atomic filter shape, the 409-on-lost-race path, a malformed attachment id
handled as 404 rather than an uncaught `CastError`, a real download's
headers (`nosniff`, forced `attachment` disposition, correct
`Content-Type`), and delete's atomic `$pull` shape plus its 404 for a
wrong/missing attachment id.

Full suite (all 14 files) passes: **145 passed, 0 failed.**
`npm run build` passes cleanly (placeholder `MONGODB_URI`/`NEXTAUTH_SECRET`
env vars, same as the existing test harness, since this sandbox has no
live database — `next build`'s static analysis and page-data collection
don't otherwise require one).
