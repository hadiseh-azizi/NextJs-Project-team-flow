import { Schema, model, models } from "mongoose";

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
  name: { type: String, required: true },
  description: { type: String, default: null },
  manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  members: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: undefined },
  // Who's allowed to directly edit this project's tasks/columns/settings.
  // "everyone" (the schema default, and the app's original behavior)
  // lets anyone with project access edit directly; "manager_approval"
  // restricts direct editing to the manager and whoever's listed in
  // `editors` below — everyone else can still view, and can submit a
  // ChangeRequest instead (see models/ChangeRequest.js). This is a
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
  shareToken: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

// Sparse because most projects never enable sharing and would otherwise
// all collide on `null`; unique so two projects can never end up
// pointing at the same token even under a very unlucky retry/race.
ProjectSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

export default models.Project || model("Project", ProjectSchema);
