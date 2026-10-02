// Remembers how many projects a user had the last time the list loaded, so
// the next visit can draw exactly that many placeholder cards while the
// list is fetched. Nothing is invented: with no remembered count (first
// visit in this tab) the caller gets null and shows the Team Flow loader
// instead of guessing.
//
// Two layers: a module-level Map (instant, survives client-side navigation,
// and is empty on the server and on first render so it can never cause a
// hydration mismatch) and sessionStorage (survives a full reload of the
// tab). Both are keyed by user id so one account's count is never shown to
// another on a shared browser.

const memory = new Map();
const MAX_REMEMBERED = 500;
const storageKey = (userId) => `tf:project-count:${userId}`;

function valid(n) {
  return Number.isInteger(n) && n >= 0 && n <= MAX_REMEMBERED;
}

// Safe during render: never touches window.
export function readRememberedProjectCount(userId) {
  if (!userId) return null;
  return memory.has(userId) ? memory.get(userId) : null;
}

// Client-only (call from an effect). Falls back to sessionStorage and warms
// the in-memory copy.
export function readStoredProjectCount(userId) {
  const fromMemory = readRememberedProjectCount(userId);
  if (fromMemory !== null) return fromMemory;
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    if (raw === null) return null;
    const n = Number(raw);
    if (!valid(n)) return null;
    memory.set(userId, n);
    return n;
  } catch {
    return null; // storage blocked (private mode, policy) — just no memory
  }
}

export function rememberProjectCount(userId, count) {
  if (!userId || !valid(count)) return;
  memory.set(userId, count);
  try {
    window.sessionStorage.setItem(storageKey(userId), String(count));
  } catch {
    // Not persisted across reloads; the in-memory copy still works.
  }
}
