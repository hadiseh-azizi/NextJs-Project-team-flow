import { Schema, model, models } from "mongoose";

// Bridges a just-completed, first-time email verification to a single
// automatic sign-in, without ever putting a password (or anything
// reusable as one) in the verification link or the verify-email API
// response. One document per issued token; consumeAutoLoginToken() (see
// src/lib/autoLoginToken.js) deletes it atomically on its first — and
// only — successful use.
const AutoLoginTokenSchema = new Schema({
  // sha256 of the raw token. The raw value only ever exists in memory on
  // the server and in the one-time verify-email API response body on the
  // client — never persisted — the same "don't store the reusable
  // secret itself" pattern used for password hashing.
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
});

// MongoDB's TTL monitor sweeps expired documents roughly once a minute,
// not the instant expiresAt passes — this index is purely for eventual
// cleanup. consumeAutoLoginToken() never relies on the sweep having run
// yet; it treats an expired-but-not-yet-deleted document as invalid
// itself (same pattern as RateLimitAttempt/lib/rateLimit.js).
AutoLoginTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.AutoLoginToken || model("AutoLoginToken", AutoLoginTokenSchema);
