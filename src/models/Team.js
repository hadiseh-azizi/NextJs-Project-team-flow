import { Schema, model, models } from "mongoose";
import { MAX_TEAM_NAME_LENGTH } from "@/lib/fieldLimits";
import { textLimit } from "@/lib/schemaLimits";

// A Team is a group of people who work together. Each Team has one manager
// (its creator) who can add/remove members and create projects for the team.
const TeamSchema = new Schema({
  name: { type: String, required: true, validate: textLimit("name", MAX_TEAM_NAME_LENGTH) },
  manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
  members: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now },
},
// updatedAt only; see models/Project.js.
{ timestamps: { createdAt: false, updatedAt: true } });

// H6: "my teams" (GET /api/teams and lib/authz.js's accessible-team
// calculation) is `{ $or: [{ manager: userId }, { members: userId }] }` —
// like the Project list, an $or needs an index on every branch. `members`
// is an array, so this is a multikey index (one entry per member id), which
// is what lets `{ members: userId }` match without scanning. Non-unique:
// a user may belong to many teams and a manager may own many.
TeamSchema.index({ members: 1 });
TeamSchema.index({ manager: 1 });

export default models.Team || model("Team", TeamSchema);
