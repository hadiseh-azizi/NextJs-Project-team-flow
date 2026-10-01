// Client-side persistence for the Kanban board's collapsed columns.
//
// Collapsing is a per-browser viewing preference, not project data, so it
// lives in localStorage (one small JSON array of column ids per project)
// rather than in the database or an API — same approach as the theme mode
// choice. Everything here is pure or defensive so that
// disabled storage (private browsing), corrupt values, and columns that
// have since been deleted can never break the board: the worst outcome is
// that a column shows expanded.

// px — a collapsed column is a narrower panel (expanded is 288), wide enough for a
// horizontal one-line title. Spacing is on the same 8px grid as the rest of the board.
export const COLLAPSED_COLUMN_WIDTH = 192;
export const COLLAPSE_MS = 220; // same duration as the app's other entrance/settle motion
export const COLLAPSE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

const KEY_PREFIX = "teamflow-collapsed-columns:";
const MAX_STORED_IDS = 200; // defensive cap on what we will read back

export function collapsedColumnsKey(projectId) {
  return `${KEY_PREFIX}${projectId}`;
}

// Parses a stored value into an array of unique id strings. Anything that
// is not a JSON array of strings yields [].
export function parseCollapsedIds(raw) {
  if (typeof raw !== "string" || raw === "") return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item === "" || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_STORED_IDS) break;
  }
  return out;
}

// The ids to store: the collapsed ones that still exist as columns.
// (`existingIds` empty/absent means "don't know" — keep everything rather
// than wiping the saved state while the board is between loads.)
export function idsToPersist(collapsedIds, existingIds) {
  const list = [...collapsedIds];
  if (!existingIds || existingIds.length === 0) return list;
  const existing = new Set(existingIds);
  return list.filter((id) => existing.has(id));
}

export function readCollapsedColumns(projectId, storage) {
  if (!projectId) return [];
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return [];
    return parseCollapsedIds(store.getItem(collapsedColumnsKey(projectId)));
  } catch {
    return [];
  }
}

export function writeCollapsedColumns(projectId, ids, storage) {
  if (!projectId) return false;
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return false;
    const key = collapsedColumnsKey(projectId);
    if (ids.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(ids));
    return true;
  } catch {
    // Storage disabled or full — the state still applies for this session.
    return false;
  }
}
