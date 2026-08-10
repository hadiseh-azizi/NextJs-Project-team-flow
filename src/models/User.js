import { Schema, model, models } from "mongoose";

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default models.User || model("User", UserSchema);
