import { Schema, model, models } from "mongoose";

// A Column (a.k.a. "list") is entirely user-defined — people decide how many
// columns a board has and what they're called. All columns are equal: none
// is a "done"/"completed" column by name or position. Whether a task is
// completed is the task's own `completed` flag (see models/Task.js).
// Older documents may still carry a stored `isDoneColumn` field; it is no
// longer part of the schema, so it is never read, returned or written.
const ColumnSchema = new Schema({
  name: { type: String, required: true },
  project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Enforces the invariant that ordering logic elsewhere assumes but never
// checked: no two columns in the same project share an `order` value.
// Without this, concurrent column creation could compute the same
// "current max + 1" twice and insert two columns at the same order —
// unlike task ordering (see lib/taskOrdering.js), nothing downstream
// re-sorts columns with a tie-break, so a duplicate here isn't cosmetic:
// it makes the board's column order genuinely nondeterministic across
// reloads (MongoDB doesn't guarantee a stable order for ties). The create
// route (see columns/route.js) retries on the resulting duplicate-key
// error rather than surfacing it to the user.
ColumnSchema.index({ project: 1, order: 1 }, { unique: true });

export default models.Column || model("Column", ColumnSchema);
