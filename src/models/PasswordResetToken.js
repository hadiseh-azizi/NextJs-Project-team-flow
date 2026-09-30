import { Schema, model, models } from "mongoose";

// Bridges a "Forgot password" request to a single password change, without
// ever putting a reusable secret at rest in the database — same reasoning
// as AutoLoginToken (see src/models/AutoLoginToken.js), and a deliberate
// contrast with Project.shareToken (see src/lib/shareToken.js), which is
// stored as plain text *by design* because it must be shown again later.
// A reset link is the opposite case: it's used at most once and never
// needs to be displayed again, so hashing it costs nothing and closes off
// a database read (backup, replica, leaked query result) being replayable
// as a working reset link. One document per issued token;
// consumePasswordResetToken() (see src/lib/passwordResetToken.js) deletes
// it atomically on its first — and only — successful use.
const PasswordResetTokenSchema = new Schema({
  // sha256 of the raw token. The raw value only ever exists in memory on
  // the server and in the emailed link — never persisted.
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
});

// MongoDB's TTL monitor sweeps expired documents roughly once a minute,
// not the instant expiresAt passes — this index is purely for eventual
// cleanup. consumePasswordResetToken() never relies on the sweep having
// run yet; it treats an expired-but-not-yet-deleted document as invalid
// itself (same pattern as AutoLoginToken/RateLimitAttempt).
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.PasswordResetToken || model("PasswordResetToken", PasswordResetTokenSchema);
