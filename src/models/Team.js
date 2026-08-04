import { Schema, model, models } from "mongoose";

// A Team is a group of people who work together. Each Team has one manager
// (its creator) who can add/remove members and create projects for the team.
const TeamSchema = new Schema({
  name: { type: String, required: true },
  manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
  members: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now },
});

export default models.Team || model("Team", TeamSchema);
