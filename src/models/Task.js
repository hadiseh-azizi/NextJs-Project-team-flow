import { Schema, model, models } from "mongoose";

// Attachments are stored inline as base64 — no external file storage needed,
// so the app works the same in local dev and in a serverless deployment.
// Kept small on purpose (see the 5MB cap enforced in the upload route).
const AttachmentSchema = new Schema({
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: String, required: true }, // base64-encoded file contents
  uploadedAt: { type: Date, default: Date.now },
});

const TaskSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, default: null },
  column: { type: Schema.Types.ObjectId, ref: "Column", required: true },
  order: { type: Number, default: 0 },
  dueDate: { type: Date, default: null },
  color: { type: String, default: null }, // pastel label key, e.g. "rose" — see lib/taskColors.js
  project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  assignees: [{ type: Schema.Types.ObjectId, ref: "User" }], // Trello-style: 0..N people
  attachments: [AttachmentSchema],
  createdAt: { type: Date, default: Date.now },
});

export default models.Task || model("Task", TaskSchema);
