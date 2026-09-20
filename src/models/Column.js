import { Schema, model, models } from "mongoose";

// A Column (a.k.a. "list") is entirely user-defined — people decide how many
// columns a board has and what they're called. `isDoneColumn` lets someone
// mark one column as "this is where finished work lives", which is what
// powers the progress percentage elsewhere in the app; it defaults to false
// so a newly added column is just a plain column until someone flags it.
const ColumnSchema = new Schema({
  name: { type: String, required: true },
  project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  order: { type: Number, default: 0 },
  isDoneColumn: { type: Boolean, default: false },
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
