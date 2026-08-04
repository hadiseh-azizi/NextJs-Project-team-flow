import { Schema, model, models } from "mongoose";

// Each project belongs to exactly one team, and is owned by the project
// manager who created it. Only the manager and that team's members can
// access the project — no cross-team visibility.
const ProjectSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String, default: null },
  manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  createdAt: { type: Date, default: Date.now },
});

export default models.Project || model("Project", ProjectSchema);
