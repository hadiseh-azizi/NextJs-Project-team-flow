import { Schema, model, models } from "mongoose";
import { MAX_PROJECT_NAME_LENGTH, MAX_PROJECT_DESCRIPTION_LENGTH } from "@/lib/fieldLimits";
import { textLimit } from "@/lib/schemaLimits";

// Each project belongs to exactly one team, and is owned by the project
// manager who created it. Only the manager and the individual users in
// `members` can access the project — team membership alone is no longer
// enough (see lib/authz.js's projectAccessFor).
//
// `members` is left with no schema default on purpose, so a project saved
// before this field existed has no `members` key in MongoDB at all —
// distinct from a project that has the field but it's empty. authz.js
// treats "field absent" as a legacy, unrestricted project (every team
// member has access, matching the app's original behavior) and "field
// present" (even `[]`) as access-restricted (only the manager and whoever
// is listed). Every project created going forward gets `members: []` set
// explicitly at creation (see POST /api/projects), so it's restricted
// from the start; a legacy project only becomes restricted the first time
// its Team Manager adds or removes someone through the project's access
// UI, at which point it's seeded with its full current team roster so no
// one who already had access loses it as a side effect (see
// applyProjectMembership() in lib/authz.js).
const ProjectSchema = new Schema({
  name: { type: String, required: true, validate: textLimit("name", MAX_PROJECT_NAME_LENGTH) },
  description: { type: String, default: null, validate: textLimit("description", MAX_PROJECT_DESCRIPTION_LENGTH) },
  manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  members: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: undefined },
  // Who's allowed to directly edit this project's tasks/columns/settings.
  // "everyone" (the schema default, and the app's original behavior)
  // lets anyone with project access edit directly; "manager_approval"
  // restricts direct editing to the manager and whoever the manager has
  // individually selected in `editors` below — everyone else can still
  // view the project, read-only. This is a
  // schema default, not a "field present vs. absent" distinction like
  // `members` above — but routes read it via lib/authz.js's
  // canEditProject(), which treats a missing value the same as
  // "everyone" rather than relying on Mongoose to apply the default on
  // .lean() reads (it doesn't).
  editingMode: { type: String, enum: ["everyone", "manager_approval"], default: "everyone" },
  // Individually granted editors, only meaningful while `editingMode` is
  // "manager_approval" — left unset (not even `[]`) until a manager
  // grants someone edit access, same "absent by default" pattern as
  // `members`. Every id here must also be in `members`/have project
  // access; see the editors route for that check.
  editors: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: undefined },
  // Read-only public board sharing (see lib/shareToken.js and
  // app/api/projects/[id]/share/route.js). `shareToken` is stored as
  // plain text, not hashed like AutoLoginToken — a deliberate difference,
  // not an oversight: that token bridges one single automatic sign-in and
  // is never shown again, so hashing it costs nothing. This token is the
  // opposite case — a durable, reusable "anyone with this link can view"
  // capability the manager needs to see and copy again later (e.g. after
  // reopening the Share dialog), so it can't be a one-way hash. Its
  // security instead comes from being 192 bits of cryptographically
  // random data (unguessable) and from `shareEnabled` gating every
  // lookup, so disabling sharing revokes it instantly regardless of who
  // still has the old URL.
  shareEnabled: { type: Boolean, default: false },
  // No default, on purpose: a project that isn't shared has NO `shareToken`
  // key in MongoDB at all. Do not set this to `null` anywhere — a sparse
  // index skips documents where the field is *missing*, but still indexes
  // an explicit `null`, so two projects holding `null` collide (E11000).
  // Disable sharing with `$unset`, never `$set: { shareToken: null }`.
  shareToken: { type: String, default: undefined },
  createdAt: { type: Date, default: Date.now },
},
// updatedAt only: `createdAt` stays the explicit field above, so existing
// documents and every createdAt read/sort behave exactly as before. DTOs
// pick fields by name (lib/serialize.js), so updatedAt is never sent to clients.
{ timestamps: { createdAt: false, updatedAt: true } });

// Sparse because most projects never enable sharing and have no
// `shareToken` field at all (sparse skips those documents); unique so two
// projects can never end up pointing at the same token even under a very
// unlucky retry/race. This only holds while the field stays *absent* when
// sharing is off — see the note on `shareToken` above. Databases that
// already contain `shareToken: null` documents must run
// scripts/migrations/001-unset-null-share-token.cjs.
ProjectSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

// H6: the project list / dashboard query is
// `{ $or: [{ manager: userId }, { team: { $in: teamIds } }] }` — an $or
// can only use indexes if EVERY branch has one, so both are needed (one
// alone would still fall back to a collection scan). `team` also serves
// the per-team lookups (e.g. clearing a removed member from a team's
// projects). Both are plain non-unique indexes: many projects share a
// team or a manager, so existing data can't violate them.
ProjectSchema.index({ team: 1 });
ProjectSchema.index({ manager: 1 });

export default models.Project || model("Project", ProjectSchema);
