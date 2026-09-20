import { Schema, model, models } from "mongoose";

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  // lowercase+trim here keeps the unique index consistent with the
  // normalizeEmail() helper used at every read/write call site — without
  // this, the DB's uniqueness check is case-sensitive while the app
  // treats "Foo@Bar.com" and "foo@bar.com" as the same account.
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  // Bumped whenever a verification token is successfully consumed, so a
  // captured/replayed token (e.g. from an email client prefetching links)
  // can't verify the account a second time — the token's embedded version
  // will no longer match.
  tokenVersion: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export default models.User || model("User", UserSchema);
