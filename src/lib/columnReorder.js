import { compareColumns } from "@/lib/columnOrderCompare";

// Pure helpers behind PATCH /api/projects/[id]/columns/order — kept out of
// the route file so the "is this a valid reorder?" rules can be unit
// tested without a database.

export const MAX_REORDER_COLUMNS = 200;

// Checks the *shape* of a requested order: an array of unique, non-empty
// string ids. Whether those ids actually belong to the project is a
// separate check against the database (see planColumnReorder).
export function validateColumnOrderPayload(value, isValidId) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "columnOrder must be a non-empty array of column ids" };
  }
  if (value.length > MAX_REORDER_COLUMNS) {
    return { error: `columnOrder can't contain more than ${MAX_REORDER_COLUMNS} columns` };
  }
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string" || !isValidId(raw)) {
      return { error: "columnOrder contains an invalid column id" };
    }
    if (seen.has(raw)) return { error: "columnOrder contains a duplicate column id" };
    seen.add(raw);
  }
  return { value: [...value] };
}

// Compares the requested order against the project's real columns.
//   - `foreign`: ids that aren't columns of this project (another
//     project's column, or one that no longer exists)
//   - `missing`: project columns the request left out (typically a
//     column someone else added while this client was open)
// A reorder is only applied when both are empty, so a request can never
// drop a column from the board or smuggle another project's column in.
export function planColumnReorder(existingColumns, requestedIds) {
  const existingIds = new Set(existingColumns.map((c) => String(c._id)));
  const requested = new Set(requestedIds);
  const foreign = requestedIds.filter((id) => !existingIds.has(id));
  const missing = [...existingIds].filter((id) => !requested.has(id));

  // The order the board is currently *displaying* (same tie-break the
  // client and every read path use) — used to skip a no-op write.
  const currentIds = [...existingColumns].sort(compareColumns).map((c) => String(c._id));
  const orderByStoredId = new Map(existingColumns.map((c) => [String(c._id), c.order]));
  const alreadyNormalized =
    currentIds.length === requestedIds.length &&
    currentIds.every((id, i) => id === requestedIds[i] && orderByStoredId.get(id) === i);

  return { foreign, missing, alreadyNormalized };
}

// Returns `columns` arranged to match `orderedIds`. Ids that no longer
// exist are skipped, and columns the list doesn't mention (e.g. one just
// added by someone else) keep their relative order at the end — so an
// optimistic order can never hide a column.
export function applyColumnOrder(columns, orderedIds) {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const placed = new Set();
  const result = [];
  for (const id of orderedIds) {
    const column = byId.get(id);
    if (column && !placed.has(id)) {
      result.push(column);
      placed.add(id);
    }
  }
  for (const column of columns) {
    if (!placed.has(column.id)) result.push(column);
  }
  return result;
}

// Moves the item at `from` to index `to`, returning a new array.
export function moveItem(list, from, to) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Index of the slot whose centre is closest to `center`. `slots` is
// [{ left, width }, ...] in the same coordinate space as `center`.
export function nearestSlotIndex(slots, center) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const distance = Math.abs(slots[i].left + slots[i].width / 2 - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

// How far (px, horizontally) the column at `index` has to slide to make
// room while the column at `from` is hovering over slot `over`. The
// dragged column itself is positioned by the pointer, not by this.
export function shiftForColumn(slots, index, from, over) {
  if (index === from) return 0;
  if (from < over && index > from && index <= over) return slots[index - 1].left - slots[index].left;
  if (from > over && index >= over && index < from) return slots[index + 1].left - slots[index].left;
  return 0;
}
