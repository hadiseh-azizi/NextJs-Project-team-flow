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

export default models.Column || model("Column", ColumnSchema);
