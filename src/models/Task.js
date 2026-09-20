import { Schema, model, models } from "mongoose";
import { MAX_ATTACHMENTS_PER_TASK, MAX_FILE_SIZE, MAX_TOTAL_ATTACHMENTS_SIZE } from "@/lib/attachmentPolicy";

// Attachments are stored inline as base64 — no external file storage needed,
// so the app works the same in local dev and in a serverless deployment.
// Kept small on purpose (see the size/count caps in lib/attachmentPolicy.js,
// enforced in the upload route). The constraints below are a second,
// schema-level line of defense — the route is what actually sanitizes and
// validates an upload, but a required/bounded field here means no code
// path (present or future) can silently write an attachment that skips
// that route's checks.
const AttachmentSchema = new Schema({
  filename: { type: String, required: true, trim: true, maxlength: 150 },
  mimeType: { type: String, required: true, trim: true, maxlength: 100 },
  size: { type: Number, required: true, min: 0, max: MAX_FILE_SIZE },
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
  attachments: {
    type: [AttachmentSchema],
    validate: [
      {
        validator: (arr) => arr.length <= MAX_ATTACHMENTS_PER_TASK,
        message: `A task cannot have more than ${MAX_ATTACHMENTS_PER_TASK} attachments`,
      },
      {
        // Mirrors the route's running-total check (lib/attachmentPolicy.js)
        // at the schema level. This only runs on document validation (e.g.
        // `task.save()`), not on the atomic `Task.updateOne(...)` the
        // upload route now uses as its actual enforcement (see that
        // route's comments for why) — it exists purely as a backstop
        // against any other, future code path that mutates `attachments`
        // via `.push()` + `.save()` and forgets to re-check the total.
        validator: (arr) => arr.reduce((sum, a) => sum + (a.size || 0), 0) <= MAX_TOTAL_ATTACHMENTS_SIZE,
        message: `A task's attachments cannot exceed ${MAX_TOTAL_ATTACHMENTS_SIZE} bytes in total`,
      },
    ],
  },
  createdAt: { type: Date, default: Date.now },
});

// Every ordering query filters by column and sorts by order (see
// lib/taskOrdering.js) — this index keeps that a cheap indexed scan
// instead of a collection-wide sort as a project's task list grows.
TaskSchema.index({ column: 1, order: 1 });

export default models.Task || model("Task", TaskSchema);
