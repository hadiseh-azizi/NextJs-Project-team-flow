// Project board + team members loading: shape cache (exact counts, no
// invented data) and source checks that the pages use it.
require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const c = require("../src/lib/loadShapeCache.js");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

function fakeWindow(store = {}) {
  global.window = { sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  return store;
}

const project = {
  columns: [{ id: "c2", order: 1 }, { id: "c1", order: 0 }, { id: "c3", order: 2 }],
  tasks: [
    { id: "t1", columnId: "c1", order: 0, title: "Short", description: "", dueDate: null, attachments: [], assignees: [] },
    { id: "t2", columnId: "c1", order: 1, title: "x".repeat(60), description: "d".repeat(80), dueDate: "2026-01-01", attachments: [{}], assignees: [{ id: "a" }, { id: "b" }] },
    { id: "t3", columnId: "c2", order: 0, title: "T", description: "secret text", attachments: [], assignees: [] },
  ],
};

async function run() {
  await test("board shape: columns in order with exactly the real task counts", () => {
    const s = c.boardShapeFromProject(project, true);
    assert.deepStrictEqual(s.columns.map((x) => [x.id, x.tasks.length]), [["c1", 2], ["c2", 1], ["c3", 0]]);
    assert.strictEqual(s.edit, true);
  });

  await test("board shape: stores counts only, never titles/descriptions", () => {
    const json = JSON.stringify(c.boardShapeFromProject(project, true));
    assert.ok(!json.includes("secret") && !json.includes("Short") && !json.includes("xxxx"));
  });

  await test("board shape: long title -> more lines, footer flags and assignee count kept", () => {
    const t = c.boardShapeFromProject(project, true).columns[0].tasks;
    assert.strictEqual(t[0][0], 1);
    // 60 unbroken characters in a 288px column (about 33 per line, measured in the browser) -> 2 lines
    assert.strictEqual(t[1][0], 2);
    assert.deepStrictEqual(t[1].slice(1), [2, 1, 1, 2]);
  });

  await test("board shape: malformed input is rejected, not guessed", () => {
    assert.strictEqual(c.parseBoardShape(null), null);
    assert.strictEqual(c.parseBoardShape({ columns: [{ id: "a", tasks: [[1, 2]] }] }), null);
    assert.strictEqual(c.parseBoardShape({ columns: [{ id: 5, tasks: [] }] }), null);
    assert.strictEqual(c.boardShapeFromProject({}, true), null);
  });

  await test("team shape: member/invite counts; invites only counted for a manager", () => {
    const team = { manager: { id: "m" }, members: [{ id: "a" }, { id: "m" }], pendingInvitations: [{}, {}, {}] };
    assert.deepStrictEqual(c.teamShapeFromTeam(team, true), { manager: true, members: 2, invites: 3, managerRow: 1 });
    assert.deepStrictEqual(c.teamShapeFromTeam(team, false), { manager: false, members: 2, invites: 0, managerRow: 1 });
  });

  await test("cache: nothing remembered -> null; per user and per id", () => {
    delete global.window;
    assert.strictEqual(c.readRememberedShape("board", "u", "p"), null);
    assert.strictEqual(c.readStoredShape("board", "u", "p"), null);
    fakeWindow();
    c.rememberShape("team", "u1", "t1", { manager: false, members: 4, invites: 0, managerRow: -1 });
    assert.strictEqual(c.readRememberedShape("team", "u1", "t1").members, 4);
    assert.strictEqual(c.readRememberedShape("team", "u2", "t1"), null);
    assert.strictEqual(c.readRememberedShape("team", "u1", "t2"), null);
  });

  await test("cache: survives a reload through sessionStorage, ignores corrupt values", () => {
    const store = fakeWindow();
    c.rememberShape("board", "u9", "p9", c.boardShapeFromProject(project, false));
    const raw = store["tf:shape:board:u9:p9"];
    assert.ok(raw);
    store["tf:shape:team:u9:bad"] = "{nope";
    assert.strictEqual(c.readStoredShape("team", "u9", "bad"), null);
    store["tf:shape:team:u9:bad2"] = JSON.stringify({ members: -3, invites: 0 });
    assert.strictEqual(c.readStoredShape("team", "u9", "bad2"), null);
  });

  await test("pages: use the cache, loader fallback, no fixed-count placeholders", () => {
    const p = read("src/app/dashboard/projects/[id]/page.jsx");
    const t = read("src/app/dashboard/teams/[id]/page.jsx");
    for (const src of [p, t]) {
      assert.ok(src.includes("TeamFlowLoader") && src.includes("loadShapeCache"));
    }
    assert.ok(!p.includes("[0, 1, 2].map") && !t.includes("[0, 1, 2].map"));
    assert.ok(p.includes("KanbanBoardSkeleton") && t.includes("TeamMembersSkeleton"));
  });

  await test("team page and skeleton share one set of row/panel styles", () => {
    const t = read("src/app/dashboard/teams/[id]/page.jsx");
    assert.ok(!t.includes("const rowSx") && t.includes("@/components/TeamMembersSkeleton"));
  });

  await test("board shape: long titles wrap by words and by viewport (matches the browser: 4 lines at 1280, 3 at 430)", () => {
    const p = { columns: [{ id: "c", order: 0 }], tasks: [{ id: "t", columnId: "c", order: 0, title: "Migrate the legacy billing reconciliation job to the new queue-based worker and verify idempotency across retries" }] };
    assert.strictEqual(c.boardShapeFromProject(p, true, false, 1280).columns[0].tasks[0][0], 4);
    assert.strictEqual(c.boardShapeFromProject(p, true, false, 430).columns[0].tasks[0][0], 3);
    // not clamped like the real title: a very long one keeps growing past the old 3-line cap, up to 8
    const huge = { ...p, tasks: [{ ...p.tasks[0], title: "word ".repeat(80) }] };
    assert.strictEqual(c.boardShapeFromProject(huge, true).columns[0].tasks[0][0], 8);
  });

  await test("board shape: header record (manager, title/description lines, people) holds counts only", () => {
    const p = {
      name: "Billing platform rollout", description: "Cutover of the legacy reconciliation job.",
      manager: { id: "m" }, team: { members: [{ id: "m" }, { id: "a" }, { id: "b" }] }, members: null,
      columns: [{ id: "c", order: 0 }], tasks: [],
    };
    const s = c.boardShapeFromProject(p, true, true, 1440);
    assert.deepStrictEqual(s.header, { manager: 1, title: 1, description: 1, people: 3 });
    assert.ok(!JSON.stringify(s).includes("Billing") && !JSON.stringify(s).includes("Cutover"));
    assert.strictEqual(c.boardShapeFromProject({ ...p, description: null }, false, false, 1440).header.description, 0);
    assert.strictEqual(c.boardShapeFromProject({ ...p, members: [{ id: "a" }] }, true, true, 1440).header.people, 2);
    const roundTrip = c.parseBoardShape(JSON.parse(JSON.stringify(s)));
    assert.deepStrictEqual(roundTrip.header, s.header);
  });

  await test("board shape: a shape stored before `header` existed still parses, with the plainest header", () => {
    const old = c.parseBoardShape({ edit: true, columns: [{ id: "a", tasks: [[1, 0, 0, 0, 0]] }] });
    assert.deepStrictEqual(old.header, { manager: 0, title: 1, description: 0, people: 1 });
    assert.strictEqual(c.parseBoardShape({ edit: true, header: { manager: 9 }, columns: [] }).header.manager, 0);
  });

  await test("pages: wait for the session before the loader, no placeholder board for a project without columns, header placeholders", () => {
    const p = read("src/app/dashboard/projects/[id]/page.jsx");
    const t = read("src/app/dashboard/teams/[id]/page.jsx");
    for (const src of [p, t]) assert.ok(src.includes('sessionStatus !== "loading"'));
    assert.ok(p.includes("storedShape.columns.length > 0") && p.includes("ProjectHeaderSkeleton"));
    assert.ok(t.includes("TeamHeaderSkeleton"));
    const k = read("src/components/KanbanBoardSkeleton.jsx");
    assert.ok(k.includes("New column") && k.includes("PageHeader"));
  });

  summary();
}
run();
