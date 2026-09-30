import { Schema, model, models } from "mongoose";

// A member who lacks direct edit permission on a project (see
// `Project.editingMode` in models/Project.js) can submit one of these
// instead of being silently blocked. `actionType` distinguishes the two
// kinds the app can safely re-apply on its own once approved
// (`moveTask`/`toggleComplete`, via `targetTask`/`targetColumn`) from the
// kinds that are only ever a description for the manager to act on by
// hand (`editTask`/`other`) — see the change-requests approval route for
// why an arbitrary free-text request is never auto-applied.
export const CHANGE_REQUEST_ACTION_TYPES = ["moveTask", "toggleComplete", "editTask", "other"];
export const CHANGE_REQUEST_STATUSES = ["pending", "approved", "rejected"];

const ChangeRequestSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  requester: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actionType: { type: String, required: true, enum: CHANGE_REQUEST_ACTION_TYPES },
  // Present for a request about a specific task (moveTask, toggleComplete,
  // editTask); null for a project/column-level or general request.
  targetTask: { type: Schema.Types.ObjectId, ref: "Task", default: null },
  // For `moveTask`, the requested destination column. Not used by any
  // other action type.
  targetColumn: { type: Schema.Types.ObjectId, ref: "Column", default: null },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: CHANGE_REQUEST_STATUSES, default: "pending" },
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  respondedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // Set when an approved moveTask/toggleComplete request couldn't actually
  // be re-applied at decision time (e.g. the task was since deleted or
  // moved already) — see the approval route. The request still reads as
  // "approved" (the manager's decision stands), this just records that
  // the automatic follow-through didn't happen so it isn't silently lost.
  applyError: { type: String, default: null },
});

// Every list view here is scoped to one project and (for the manager's
// queue) filtered to pending requests, newest first.
ChangeRequestSchema.index({ project: 1, status: 1, createdAt: -1 });

export default models.ChangeRequest || model("ChangeRequest", ChangeRequestSchema);
