// H4: hard bounds for the public shared-board response
// (GET /api/shared/board/[token]).
//
// Before this, the route returned every column, every task, every assignee
// and every attachment record of a project to an anonymous caller, so one
// request's cost and size were set by whoever owned the project. A large
// board could exceed the platform's ~4.5 MB response limit (see
// PLATFORM_BODY_LIMIT_BYTES in lib/attachmentPolicy.js), which would break
// the link for every viewer, and a deliberately inflated board turned the
// public link into a cheap amplifier.
//
// Plain constants and pure helpers with no imports, so both the server
// (serialize.js, the route) and the shared page can use them.
//
// What is bounded, and why these numbers:
//
//  - Columns: 50. The board is a horizontal strip; nobody reads past that
//    many, and the app's own reorder route already treats 200 as absurd.
//  - Tasks: 500 per response. Real boards are far smaller; this keeps the
//    database query and the payload proportionate for an unauthenticated
//    caller.
//  - Assignees per task: 10 (the true count is still sent, see
//    `assigneeCount`). The card shows four avatars and a "+N".
//  - Attachments per task: 20, which is what the Task schema already allows.
//    Only filename/type/size are ever sent, never contents.
//  - Description: 280 characters. The shared card clamps it to two lines
//    anyway and anonymous viewers cannot open a task, so the rest of a
//    5,000-character description is never visible to them.
//  - Bytes: the serialized task list is also held to a byte budget, because
//    the counts above can still add up to more than the platform allows when
//    text is long or multi-byte. 3,000,000 bytes leaves headroom under the
//    4.5 MB limit for the columns and the envelope.
//
// When a board exceeds a limit nothing is dropped quietly. The response says
// so (`limits`), every column still reports its true `taskCount`, and the
// page shows a notice. Truncation is deterministic: columns keep their board
// order, and tasks are taken in board order (order, createdAt, id), so every
// column shows a contiguous run of its first tasks.

export const SHARED_BOARD_MAX_COLUMNS = 50;
export const SHARED_BOARD_MAX_TASKS = 500;
export const SHARED_BOARD_MAX_ASSIGNEES_PER_TASK = 10;
export const SHARED_BOARD_MAX_ATTACHMENTS_PER_TASK = 20;
export const SHARED_BOARD_MAX_DESCRIPTION_CHARS = 280;
export const SHARED_BOARD_MAX_TASK_BYTES = 3_000_000;

// Cuts to at most `max` UTF-16 code units, ending in an ellipsis when
// something was removed, without splitting a surrogate pair in half.
export function truncateText(value, max) {
  if (typeof value !== "string" || value.length <= max) return value;
  let end = max - 1;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // don't end on a lone high surrogate
  return `${value.slice(0, end).trimEnd()}…`;
}

const encoder = new TextEncoder();

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value)).length;
}

// The longest leading run of `items` whose serialized size stays within
// `budgetBytes` (commas between array items included). Always a prefix, never
// a selection, so what is cut is always the tail of the board order.
export function takeWithinByteBudget(items, budgetBytes) {
  let used = 2; // the surrounding []
  let count = 0;
  for (const item of items) {
    const size = jsonBytes(item) + (count > 0 ? 1 : 0);
    if (used + size > budgetBytes) break;
    used += size;
    count += 1;
  }
  return items.slice(0, count);
}
