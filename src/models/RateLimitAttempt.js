import { Schema, model, models } from "mongoose";

// Backs src/lib/rateLimit.js's fixed-window counter. One document per
// rate-limited key (e.g. "login:email:foo@bar.com"); `count` and
// `expiresAt` are both maintained atomically by that module, never
// written to directly anywhere else.
const RateLimitAttemptSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
});

// MongoDB's TTL monitor sweeps expired documents roughly once every 60
// seconds, not the instant `expiresAt` passes — this index is purely for
// eventual cleanup so the collection doesn't grow forever. It is never
// relied on for correctness: rateLimit.js treats any document whose
// `expiresAt` has already passed as stale and resets it itself, on read,
// regardless of whether the TTL sweep has physically deleted it yet.
RateLimitAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.RateLimitAttempt || model("RateLimitAttempt", RateLimitAttemptSchema);
