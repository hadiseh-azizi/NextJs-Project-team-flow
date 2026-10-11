// Remembers the *shape* of a board or a team the last time it loaded, so
// the next visit can draw placeholders with exactly that many columns,
// tasks and members while the real data is fetched. Same idea (and same
// two layers) as lib/projectCountCache.js:
//
//   - a module-level Map: instant, survives client-side navigation, empty
//     on the server and on first render, so it can never cause a
//     hydration mismatch;
//   - sessionStorage: survives a full reload of the tab.
//
// Everything is keyed by user id as well as by project/team id, so one
// account's shape is never shown to another on a shared browser.
//
// Nothing here is invented. Only counts and layout flags that a real
// response contained are stored: no titles, descriptions, names, emails or
// images ever go into the cache. With nothing remembered the readers
// return null and the page falls back to the Team Flow loader.

const memory = new Map();
const STORE_PREFIX = "tf:shape:";

// Defensive caps on what is written and what is read back.
const MAX_COLUMNS = 30;
const MAX_TASKS_PER_COLUMN = 100;
const MAX_MEMBERS = 200;
const MAX_INVITES = 200;

// A task title is not clamped in the real card, so a long one can take
// many lines; the description is clamped to two (see TaskCard.jsx).
const MAX_TITLE_LINES = 8;
const MAX_DESCRIPTION_LINES = 2;
const MAX_DESCRIPTION_HEADER_LINES = 5;
const MAX_HEADER_PEOPLE = 6;

// Average glyph widths (px) of the card's two text sizes, measured in the
// browser: body2 (title) and caption (description).
const TITLE_CHAR_PX = 6;
const DESCRIPTION_CHAR_PX = 6.4;
// Page-header description (body1, max 620px wide), same idea.
const HEADER_DESCRIPTION_CHAR_PX = 6.8;
// Page-header title (h4 serif): wider glyphs, smaller on phones. The four
// manager buttons take ~497px beside it (473 + gaps) before it wraps.
const HEADER_TITLE_CHAR_PX = { desktop: 11.5, phone: 9 };
const MANAGER_ACTIONS_PX = 497;
const MAX_TITLE_HEADER_LINES = 3;
const DESKTOP_VIEWPORT = 1280;
const SM_BREAKPOINT = 600;

const storageKey = (kind, userId, id) => `${STORE_PREFIX}${kind}:${userId}:${id}`;
const memoryKey = (kind, userId, id) => `${kind}|${userId}|${id}`;

const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

// ---------------------------------------------------------------------------
// Board shape
//
// { edit: boolean, header: { manager, title, description, people },
//   columns: [{ id, tasks: [[titleLines, descLines, hasDue, hasFiles,
//   assigneeCount], ...] }] }
//
// `header` is just enough to draw a page header of the same height:
// whether the viewer manages the project (it has four action buttons),
// how many lines the title and the description take (0 = none) and how many people the
// avatar row shows. Counts only, never text.
// ---------------------------------------------------------------------------

// How many lines `text` takes when wrapped greedily at `perLine`
// characters: whole words move to the next line, and a word longer than a
// line is broken, like overflow-wrap: anywhere in the real card.
function wrappedLines(text, perLine, max) {
  const clean = typeof text === "string" ? text.trim() : "";
  if (clean.length === 0) return 0;
  const width = Math.max(8, Math.floor(perLine));
  let lines = 1;
  let used = 0;
  for (const word of clean.split(/\s+/)) {
    let w = word.length;
    if (used > 0 && used + 1 + w <= width) {
      used += 1 + w;
      continue;
    }
    if (used > 0) lines += 1;
    while (w > width) {
      lines += 1;
      w -= width;
    }
    used = w;
  }
  return Math.min(max, lines);
}

// Width of the text areas inside a card at a given viewport width: the
// column is 288px from `sm` up and 84% of the board (viewport minus the
// page's 16px gutters) below it; the panel pads 8px a side and the card
// 12px a side. The title also gives up room to the complete toggle and,
// when the viewer can edit, the delete button.
function textWidths(viewportWidth, canEdit) {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : DESKTOP_VIEWPORT;
  const column = vw < SM_BREAKPOINT ? 0.84 * Math.max(0, vw - 32) : 288;
  const inner = column - 16 - 24;
  return { description: inner, title: inner - 24 - (canEdit ? 21 : 0) };
}

// Reduces a project DTO (what GET /api/projects/[id] returns) to its shape.
// `isManager` and the header's description length decide how tall the
// page header above the board is, so the placeholder can reserve it.
// `viewportWidth` (the browser's, when called from the page) only tunes how
// many lines a title is expected to wrap to.
export function boardShapeFromProject(project, canEdit, isManager = false, viewportWidth = DESKTOP_VIEWPORT) {
  if (!project || !Array.isArray(project.columns) || !Array.isArray(project.tasks)) return null;
  const widths = textWidths(viewportWidth, !!canEdit);
  const columns = [...project.columns]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, MAX_COLUMNS)
    .map((column) => {
      const tasks = project.tasks
        .filter((t) => t.columnId === column.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .slice(0, MAX_TASKS_PER_COLUMN)
        .map((t) => [
          Math.max(1, wrappedLines(t.title, widths.title / TITLE_CHAR_PX, MAX_TITLE_LINES)),
          wrappedLines(t.description, widths.description / DESCRIPTION_CHAR_PX, MAX_DESCRIPTION_LINES),
          t.dueDate ? 1 : 0,
          Array.isArray(t.attachments) && t.attachments.length > 0 ? 1 : 0,
          Array.isArray(t.assignees) ? Math.min(4, t.assignees.length) : 0,
        ]);
      return { id: String(column.id), tasks };
    });
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : DESKTOP_VIEWPORT;
  const headerWidth = Math.min(620, vw < SM_BREAKPOINT ? vw - 32 : vw);
  const roster = Array.isArray(project.members) ? project.members : project.team?.members;
  // Width of the header's title box: the page content, less the manager
  // buttons beside it (they wrap below instead when under 320px is left).
  const content = vw < SM_BREAKPOINT ? vw - 32 : Math.min(vw - 48, 1152);
  const beside = isManager ? content - MANAGER_ACTIONS_PX - 16 : content;
  const titleBox = beside >= 320 ? beside : content;
  const titleCharPx = vw < SM_BREAKPOINT ? HEADER_TITLE_CHAR_PX.phone : HEADER_TITLE_CHAR_PX.desktop;
  return {
    edit: !!canEdit,
    header: {
      manager: isManager ? 1 : 0,
      title: Math.max(1, wrappedLines(project.name, (titleBox - 21) / titleCharPx, MAX_TITLE_HEADER_LINES)),
      description: wrappedLines(project.description, headerWidth / HEADER_DESCRIPTION_CHAR_PX, MAX_DESCRIPTION_HEADER_LINES),
      people: Math.min(MAX_HEADER_PEOPLE, 1 + (Array.isArray(roster) ? roster.filter((m) => m.id !== project.manager?.id).length : 0)),
    },
    columns,
  };
}

// Accepts only a well-formed shape; anything else becomes null.
export function parseBoardShape(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.columns)) return null;
  if (value.columns.length > MAX_COLUMNS) return null;
  const columns = [];
  for (const c of value.columns) {
    if (!c || typeof c.id !== "string" || !Array.isArray(c.tasks) || c.tasks.length > MAX_TASKS_PER_COLUMN) return null;
    const tasks = [];
    for (const t of c.tasks) {
      if (!Array.isArray(t) || t.length !== 5) return null;
      const [title, desc, due, files, people] = t;
      if (!isCount(title, MAX_TITLE_LINES) || !isCount(desc, MAX_DESCRIPTION_LINES) || !isCount(due, 1) || !isCount(files, 1) || !isCount(people, 4)) return null;
      tasks.push([title, desc, due, files, people]);
    }
    columns.push({ id: c.id, tasks });
  }
  // `header` is absent in a shape stored before it existed: fall back to
  // the plainest header (no manager buttons, no description).
  const h = value.header;
  const header =
    h && typeof h === "object" && isCount(h.manager, 1) && isCount(h.title, MAX_TITLE_HEADER_LINES) && isCount(h.description, MAX_DESCRIPTION_HEADER_LINES) && isCount(h.people, MAX_HEADER_PEOPLE)
      ? { manager: h.manager, title: Math.max(1, h.title), description: h.description, people: h.people }
      : { manager: 0, title: 1, description: 0, people: 1 };
  return { edit: !!value.edit, header, columns };
}

// ---------------------------------------------------------------------------
// Team shape: { manager: boolean, members: n, invites: n, managerRow: n }
//
// `manager` is whether the viewer manages the team, which decides whether
// the invite form, the Remove buttons and the invitations panel exist.
// `managerRow` is the position of the manager in the member list (-1 if
// they are not in it): that row has no Remove button.
// ---------------------------------------------------------------------------

export function teamShapeFromTeam(team, isManager) {
  if (!team || !Array.isArray(team.members)) return null;
  const members = Math.min(team.members.length, MAX_MEMBERS);
  const invites = isManager && Array.isArray(team.pendingInvitations) ? Math.min(team.pendingInvitations.length, MAX_INVITES) : 0;
  const managerRow = team.manager ? team.members.findIndex((m) => m.id === team.manager.id) : -1;
  return { manager: !!isManager, members, invites, managerRow: managerRow < MAX_MEMBERS ? managerRow : -1 };
}

export function parseTeamShape(value) {
  if (!value || typeof value !== "object") return null;
  if (!isCount(value.members, MAX_MEMBERS) || !isCount(value.invites, MAX_INVITES)) return null;
  const managerRow = Number.isInteger(value.managerRow) && value.managerRow >= -1 && value.managerRow < value.members ? value.managerRow : -1;
  return { manager: !!value.manager, members: value.members, invites: value.invites, managerRow };
}

// ---------------------------------------------------------------------------
// Storage plumbing
// ---------------------------------------------------------------------------

const PARSERS = { board: parseBoardShape, team: parseTeamShape };

// Safe during render: never touches window.
export function readRememberedShape(kind, userId, id) {
  if (!PARSERS[kind] || !userId || !id) return null;
  return memory.get(memoryKey(kind, userId, id)) ?? null;
}

// Client-only (call from an effect). Falls back to sessionStorage and
// warms the in-memory copy.
export function readStoredShape(kind, userId, id) {
  const fromMemory = readRememberedShape(kind, userId, id);
  if (fromMemory) return fromMemory;
  if (!PARSERS[kind] || !userId || !id || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(kind, userId, id));
    if (raw === null) return null;
    const shape = PARSERS[kind](JSON.parse(raw));
    if (shape) memory.set(memoryKey(kind, userId, id), shape);
    return shape;
  } catch {
    return null; // storage blocked or the value was corrupt: just no memory
  }
}

export function rememberShape(kind, userId, id, shape) {
  const parsed = PARSERS[kind] && userId && id ? PARSERS[kind](shape) : null;
  if (!parsed) return;
  memory.set(memoryKey(kind, userId, id), parsed);
  try {
    window.sessionStorage.setItem(storageKey(kind, userId, id), JSON.stringify(parsed));
  } catch {
    // Not persisted across reloads; the in-memory copy still works.
  }
}
