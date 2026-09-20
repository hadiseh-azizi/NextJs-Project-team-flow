# Authorization, Data Integrity & MongoDB Transaction Hardening Audit

Scope of this document: the 20-item audit checklist for this phase
(cross-team/cross-project access, manager/member authorization, transaction
boundaries and fallback behavior, and race conditions between authorization
checks and writes). Every file below was read directly, in full, before any
conclusion was drawn — not inferred from README.md, FINAL_AUDIT.md, or any
prior phase's CHANGELOG.md entry.

## Headline finding: raw transactions with no fallback (checklist #14, #15)

README.md's documented behavior:

> Several sensitive operations run inside real Mongo transactions
> (`session.withTransaction`). Transactions only work on a replica set — an
> Atlas cluster always is one, so there's no problem there. If you instead
> connect to a local standalone `mongod`, these operations automatically
> run without a transaction (with no isolation between two simultaneous
> requests) instead of failing — fine for solo development, but testing
> real concurrent behavior needs a real replica set (e.g. Atlas itself).

`lib/mongoTransaction.js`'s `withOptionalTransaction(fn)` implements exactly
this: it runs `fn(session)` inside `session.withTransaction()`, and if that
throws an error matching "transactions aren't supported" (error code 20, or
a message mentioning "replica set" / "transaction numbers" / "transactions
are not supported"), it falls back to running `fn(null)` with no session at
all. Any other error propagates normally.

Three routes already used this helper correctly before this phase (task
creation, task move, the done-column toggle). Grepping for
`mongoose.startSession` across `src/` found four more that didn't:

| Route | Operation |
|---|---|
| `DELETE /api/projects/[id]` | delete project + its tasks + its columns |
| `DELETE /api/teams/[id]/members` | remove member + unassign their tasks |
| `POST /api/auth/register` | create user + consume matching invitations |
| `POST /api/projects` | create project + its default columns |

Each of these called `mongoose.startSession()` and
`session.withTransaction()` directly, with a bare `try { ... } finally {
session.endSession() }` around it — no `catch` for the
"transactions unsupported" case, meaning that error would propagate
straight up to `withMongoErrorHandling`, which doesn't recognize it either,
so it would surface as a generic 500. Three of these four are in README's
own list of "these operations fall back automatically" — they didn't.
The fourth (project creation) wasn't in README's list at all, meaning the
documentation itself was incomplete about which operations use
transactions, on top of being wrong about what happens when they can't.

**Practical impact**: against a standalone (non-replica-set) MongoDB —
README's own stated "fine for solo development" scenario — a developer
running this project locally without setting up a replica set would find
that registering an account, deleting a project, creating a project, or
removing a team member all fail with a 500. That's a substantial fraction
of the app's write surface.

**Fix**: all four now call `withOptionalTransaction` instead, matching the
already-established pattern. This was a mechanical, low-risk change in
each case — the transaction bodies themselves were already correct; only
the session-management wrapper needed to change. Each route's fallback
safety was still reasoned through individually rather than assumed:

- **Project deletion** — `findByIdAndDelete` + two `deleteMany`s. All
  three are individually idempotent (re-deleting an already-gone id, or a
  `deleteMany` matching zero documents, is a no-op), so neither a
  driver-level retry of the transactional path nor a crash mid-sequence on
  the fallback path can double-apply or corrupt anything. Worst case
  without a session: a crash between the three deletes leaves orphaned
  tasks/columns — the same class of trade-off README already accepts for
  local, non-concurrent use.
- **Member removal** — one `updateOne` with `$pull` on the team, one
  `updateMany` with `$pull` on tasks. Both are `$pull`, which is naturally
  idempotent (pulling an id that's already gone is a no-op).
- **Registration** — `User.create` + conditional `Team.updateMany` +
  `Invitation.deleteMany`. The existing code comment already reasoned
  through retry-safety here ("every operation is a plain DB write scoped
  to `session`, so a retried attempt starts from a clean, uncommitted
  slate") — that reasoning holds identically for the no-session fallback
  path, since it's the same one-shot sequence of writes with no external
  side effects (hashing, token generation, and email sending all happen
  outside the transaction already).
- **Project creation** — `Project.create` + `Column.insertMany`, both
  brand-new documents. Worst case on the fallback path is a project
  created without its default columns if the process crashes between the
  two writes — annoying, recoverable by hand, not corrupting.

README.md's transaction paragraph is corrected to list project creation
alongside the other four operations.

## Orphaned-task race: column deletion vs. task creation (#13, #16, #17)

A column can be deleted at any time while it has zero tasks — there's no
requirement that the column stay "in view" or that no one else is acting
on the project. Two routes touch this boundary:

- `POST /api/tasks` checked the target column existed once, via a plain
  query issued *before* all of the request's field validation and well
  before the eventual `Task.create` — a gap easily wide enough (validation
  + a network round trip) for the column to be deleted in between,
  producing a task that references a column that no longer exists.
- `DELETE /api/projects/[id]/columns/[columnId]` counted tasks in the
  column, then deleted it, as two separate, non-transactional queries —
  a task could be created in the column in the gap between the count and
  the delete.

**Fix**: both checks now happen inside the same transaction as the write
they guard. Task creation re-verifies the column exists (via a
session-scoped read) immediately before computing the new task's order and
inserting; column deletion re-verifies the task count (via a
session-scoped read) immediately before deleting. This shrinks the window
from "the whole request" down to "two reads inside one transaction," which
removes the version of this race that was actually reachable given real
request latency.

**What this does not do**: MongoDB's transaction write-conflict detection
only fires when two transactions modify the *same document*. Task creation
never writes to the Column document (it only reads it and inserts a new,
unrelated Task document), so two fully concurrent transactions — one
reading "column exists" from a snapshot taken before the other's delete
commits, the other deleting from its own independent snapshot — can still
interleave into an orphaned task in the millisecond-scale case. Closing
that completely would require the create path to also write to the Column
document (e.g. bump a version field) purely to force a conflict with the
delete path, plus handling the resulting retry as a normal "column's gone"
outcome rather than a transient error. That's real, standing complexity
for a race whose practical trigger — someone deleting a column at the
exact instant someone else's already-in-flight request creates a task
into it — is the same order of likelihood as the task-order ties that
`lib/taskOrdering.js` already documents and deliberately accepts rather
than engineering around with distributed locking. This is called out
explicitly rather than left implicit, per the instruction to reason
through fallback/race safety case by case instead of reflexively
maximizing isolation.

## Manager-visibility query hardening (#12)

`lib/authz.js`'s `projectAccessFor` and `teamAccessFor` already defend
against a manager not being present in a team's `members[]` array — both
check `isManager` and membership as independent, `OR`-ed conditions. Two
places elsewhere in the codebase didn't carry that same defensiveness:
`src/app/dashboard/page.jsx` and `GET /api/projects` both derived "which
teams can this user see projects through" via
`Team.find({ members: userId })` alone, with no `manager` clause.

Today this is not exploitable: team creation always inserts the manager
into `members` (`POST /api/teams`), and member removal explicitly refuses
to remove the manager (`DELETE /api/teams/[id]/members`), so the invariant
"a team's manager is always in its own `members[]`" holds for every team
this app can currently produce. But the two call sites baked in an
assumption the rest of the authz layer explicitly avoids, and the
consequence of that assumption breaking (via a future migration, a manual
DB edit, or a future feature change) would be a manager silently losing
visibility into their own team's projects on their own dashboard — a
quiet, hard-to-notice regression rather than a loud error.

**Fix**: added `accessibleTeamIds(userId)` to `lib/authz.js`, matching on
`$or: [{ manager: userId }, { members: userId }]`, and pointed both call
sites at it instead of duplicating the `Team.find` inline.

## Resource enumeration via 403 vs. 404 (#10)

`GET`/`DELETE /api/projects/[id]` and `GET /api/teams/[id]` return 404 for
a missing or malformed id and a separate 403 for "exists, but you don't
have access" — an attacker who can distinguish those two responses can, in
principle, enumerate which ids exist. Reviewed and left as-is: MongoDB
ObjectIds are effectively unguessable (24 hex characters — timestamp plus
random/counter bytes, not sequential), so distinguishing the two statuses
here doesn't hand an attacker a practical way to discover real ids; the
main enumeration defenses that matter (unguessable ids in the first place,
and the rate limiting covered in the prior "Auth Hardening" phase) are
already in place. Collapsing this to a single status everywhere would be
worse UX (a legitimately-deleted resource and one you never had access to
would look identical) for no real security gain, so it wasn't changed.
Task, column, and attachment routes already collapse "missing" and
"denied" into a single 403/404 uniformly within each route (via
`getAccessibleProject`/`getTaskAccess` returning `null` for both cases) —
reviewed for consistency and found already correct.

## Everything else audited (#1–#9, #11, #18–#20)

Read in full, no changes needed:

- **Cross-team / cross-project access (#1, #2)** — every project and task
  route resolves access through `getAccessibleProject` / `getTaskAccess` /
  `projectAccessFor`, which check manager-of-project OR member-of-team;
  no route queries across teams without this check.
- **Manager/member and project-manager authorization (#3, #4)** —
  consistent use of `isTeamManager` / `projectAccessFor().isManager` for
  manager-only actions (team member add/remove, project deletion, project
  creation) across every route that needs it.
- **Team-member add/remove authorization (#5)** — `POST`/`DELETE
  /api/teams/[id]/members` both require `isTeamManager`; the team's
  manager itself can't be removed.
- **Task assignee authorization (#6)** — `validateAssignees` (shared
  between task creation and update) restricts assignees to the project's
  manager or team members; an id outside that set is a 400, not silently
  dropped or silently accepted.
- **Column authorization (#7)** — every column route (`columns/route.js`,
  `columns/[columnId]/route.js`) requires `getAccessibleProject` first.
- **Attachment authorization (#8)** — both attachment routes require
  `getTaskAccess`, which itself walks task → project → team; attachment
  binary data is excluded from every list/board response via
  `-attachments.data`, confirmed still correctly applied everywhere it
  matters.
- **Invitation authorization (#9)** — invitation deletion is scoped by
  both `invitationId` and `team: id` in the same query, so an invitation
  id from a different team can't be deleted through another team's route;
  creating an invitation requires `isTeamManager`.
- **Manager visibility consistency (#11)** — covered above (manager query
  hardening); no other inconsistency found between what a manager can act
  on vs. what they can see.
- **Concurrent member removal / task assignment (#17)** — `$pull`/`$addToSet`
  operations throughout are idempotent and don't depend on read-then-write
  patterns that a concurrent request could invalidate.
- **Concurrent project creation/deletion (#18)** — project creation
  doesn't have a uniqueness constraint to race against (multiple projects
  with the same name in the same team are allowed by design, matching
  existing business rules); deletion is now transactional per the
  headline finding above.
- **Concurrent done-column updates (#19)** — already correctly handled
  before this phase (`columns/[columnId]/route.js` PATCH, verified intact,
  no changes needed).
- **Registration/invitation consumption races (#20)** — covered by the
  headline finding (registration now correctly falls back) plus the
  existing unique-index-driven duplicate-key handling, which was already
  correct and unchanged.

## Testing

Full breakdown, and what was and wasn't verified against a live database,
is in `CHANGELOG.md`. Summary: **110 tests passed, 0 failed** across 13
mocked/unit test files (no live MongoDB available in this environment);
`npm run build` compiled and typechecked successfully. Live replica-set
behavior — the actual transaction fallback and retry semantics under real
concurrent load — still needs to be verified against Atlas directly; the
mocked tests here confirm the *code paths* are correct, not the live
driver/server behavior.

### Manual test matrix for live MongoDB (Atlas)

These scenarios can't be exercised in this sandbox and should be run
against a real Atlas replica set before considering this phase fully
verified:

1. Register two accounts with the same email in rapid succession (e.g. two
   browser tabs submitting at once) — expect exactly one account created,
   the second gets a 409.
2. Remove a team member while, concurrently, assigning that same member to
   a new task on one of the team's projects — expect either the removal or
   the assignment to reflect the other's result consistently (no task left
   assigned to someone who isn't a member, and no removal that silently
   fails to unassign an in-flight new assignment — acceptable outcome is
   "last write wins" on the assignment itself, not a half-applied removal).
3. Delete a project while a task is being created in one of its columns at
   the same moment — expect either the task creation to fail with "Access
   denied" (project gone) or the deletion to fail because... (no actual
   blocking exists; acceptable outcome is a fully-deleted project with no
   orphaned task, or a fully-created task in a project that then gets
   deleted along with it — not a task surviving in a deleted project).
4. Toggle the "done" column flag on two different columns in the same
   project at the exact same moment — expect exactly one done column
   afterward, never zero or two (this is the pre-existing, already-tested
   behavior; re-verify it still holds after this phase's changes, since
   none of this phase's edits touched that route's logic).
5. Delete an empty column while simultaneously creating a task into that
   same column — expect either the deletion to fail (task created just in
   time, column non-empty) or the creation to fail with "Column not
   found" — not a task left referencing a deleted column. This is the
   scenario this phase's fix narrows but does not fully close (see above);
   running it many times in a tight loop against Atlas is the way to
   confirm the residual window is as narrow in practice as reasoned above.
