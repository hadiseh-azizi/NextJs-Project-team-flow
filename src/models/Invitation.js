import { Schema, model, models } from "mongoose";

// Tracks an email invited to a team before that person has an account.
// Once someone registers with a matching email, the register route
// consumes any matching invitations and adds them to those teams.
const InvitationSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});

InvitationSchema.index({ email: 1, team: 1 }, { unique: true });

export default models.Invitation || model("Invitation", InvitationSchema);
