import { Schema, model, models } from "mongoose";

// How long an invitation stays valid before it's treated as stale. Long
// enough that a real person checking their email a few days late isn't
// locked out, short enough that a manager's pending-invitations list
// doesn't accumulate invites nobody ever acted on.
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Tracks an email invited to a team before that person has an account.
// Once someone registers with a matching email, the register route
// consumes any matching (non-expired) invitations and adds them to those
// teams.
const InvitationSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  // Past this point the invitation is no longer honored by registration
  // and is hidden from the manager's pending list. The TTL index below
  // also physically removes the document once it's past this date, so
  // stale invitations don't linger forever — existing documents written
  // before this field existed simply never expire, which is a safe
  // default (they still go through the same expiresAt-aware queries, so
  // being newly readable-but-un-indexed doesn't grant them any behavior
  // the queries don't already check).
  expiresAt: { type: Date, default: () => new Date(Date.now() + INVITATION_TTL_MS) },
});

InvitationSchema.index({ email: 1, team: 1 }, { unique: true });
// TTL index: MongoDB's background task removes a document once its
// expiresAt has passed. expireAfterSeconds: 0 means "expire exactly at
// the stored date" rather than N seconds after it.
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.Invitation || model("Invitation", InvitationSchema);
