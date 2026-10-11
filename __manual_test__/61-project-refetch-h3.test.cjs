require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const fs = require("fs");
const path = require("path");

// H3: after a mutation, return (and refetch) only what changed.
//
// What this file can and cannot show. It runs the real route handlers and
// the real serializer / state-reducer code against in-memory fakes, and it
// reads the components' source to check how they are wired. There is no
// MongoDB and no browser here, so (a) response sizes below are measured on
// the real serializers over synthetic data, not on a live deployment, and
// (b) the React components themselves are not rendered: what is verified
// for them is that every successful-mutation path hands the server's
// entity to the page's reducer (checked in source) and that the reducer
// behaves correctly (executed). A click-through in a browser is still
// needed and is listed in the changelog as unverified.

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const MEMBER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER_ID = "cccccccccccccccccccccccc";
const PROJECT_ID = "111111111111111111111111";
const TEAM_ID = "222222222222222222222222";
const TASK_ID = "333333333333333333333333";
const COL_A = "444444444444444444444444";
const COL_B = "555555555555555555555555";

const user = (id, name) => ({ _id: id, name, email: `${name.toLowerCase()}@example.com` });

function fakeReq(body, url = "http://localhost/api") {
  return { json: async () => body, url, headers: new Map() };
}

function bigBoard(taskCount) {
  const teamMembers = Array.from({ length: 20 }, (_, i) => user(`m${String(i).padStart(23, "0")}`, `Member${i}`));
  const project = {
    _id: PROJECT_ID,
    name: "Big board",
    description: "A project with a lot on it",
    createdAt: new Date("2026-01-01"),
    manager: user(MANAGER_ID, "Manager"),
    team: { _id: TEAM_ID, name: "Team", manager: user(MANAGER_ID, "Manager"), members: teamMembers },
    members: teamMembers.slice(0, 10),
    editingMode: "manager_approval",
    editors: teamMembers.slice(0, 3),
  };
  const columns = Array.from({ length: 6 }, (_, i) => ({ _id: `c${String(i).padStart(23, "0")}`, name: `Column ${i}`, order: i, createdAt: new Date("2026-01-01") }));
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    _id: `t${String(i).padStart(23, "0")}`,
    title: `Task number ${i} with a realistic title`,
    description: "A description of a sensible length that real users tend to write for their tasks.",
    column: columns[i % 6]._id,
    order: (i + 1) * 1000,
    createdAt: new Date("2026-01-02"),
    completed: i % 4 === 0,
    dueDate: new Date("2026-12-01"),
    color: "blue",
    assignees: [teamMembers[i % 20], teamMembers[(i + 1) % 20]],
    attachments: [{ _id: `a${String(i).padStart(23, "0")}`, filename: "spec.pdf", mimeType: "application/pdf", size: 120000, uploadedAt: new Date("2026-01-03") }],
    project: PROJECT_ID,
  }));
  return { project, columns, tasks };
}

(async () => {
  // -------------------------------------------------------------------------
  console.log("toProjectAccessDTO — the slim response");

  const { toProjectDTO, toProjectAccessDTO } = require("../src/lib/serialize.js");

  await test("carries exactly id, name, members, editingMode, editors", async () => {
    const { project } = bigBoard(3);
    const dto = toProjectAccessDTO(project);
    assert.deepStrictEqual(Object.keys(dto).sort(), ["editingMode", "editors", "id", "members", "name"]);
    for (const key of ["columns", "tasks", "team", "manager", "description", "createdAt"]) {
      assert.ok(!(key in dto), `${key} must not be in the access summary`);
    }
  });

  await test("each field matches the same field of the full project DTO (same name, type, meaning)", async () => {
    const { project, columns, tasks } = bigBoard(5);
    const full = toProjectDTO(project, columns, tasks);
    const slim = toProjectAccessDTO(project);
    for (const key of ["id", "name", "members", "editingMode", "editors"]) {
      assert.deepStrictEqual(slim[key], full[key], `${key} must be identical`);
    }
  });

  await test("a legacy project keeps `members: null` (unrestricted), and editors default to []", async () => {
    const { project } = bigBoard(0);
    delete project.members;
    delete project.editors;
    delete project.editingMode;
    const dto = toProjectAccessDTO(project);
    assert.strictEqual(dto.members, null);
    assert.deepStrictEqual(dto.editors, []);
    assert.strictEqual(dto.editingMode, "everyone");
  });

  await test("a restricted project with no members keeps `members: []`, not null", async () => {
    const { project } = bigBoard(0);
    project.members = [];
    assert.deepStrictEqual(toProjectAccessDTO(project).members, []);
  });

  await test("response size: constant in board size, a small fraction of the full project", async () => {
    const sizes = {};
    for (const n of [10, 100, 400]) {
      const { project, columns, tasks } = bigBoard(n);
      sizes[n] = {
        full: JSON.stringify(toProjectDTO(project, columns, tasks)).length,
        slim: JSON.stringify(toProjectAccessDTO(project)).length,
      };
    }
    console.log("    (synthetic board: 6 columns, 20-person team, 1 attachment + 2 assignees per task)");
    for (const n of [10, 100, 400]) {
      const { full, slim } = sizes[n];
      console.log(`    ${String(n).padStart(3)} tasks: members/editors/rename response ${full} B -> ${slim} B (${((slim / full) * 100).toFixed(1)}%)`);
    }
    assert.strictEqual(sizes[10].slim, sizes[400].slim, "the access summary must not grow with the number of tasks");
    assert.ok(sizes[400].slim < sizes[400].full * 0.05, "400-task board: the summary must be under 5% of the full project");
  });

  // -------------------------------------------------------------------------
  console.log("\nmembers / editors / project PATCH routes — slim response, same authorization");

  function setupProjectRoutes({ callerId = MANAGER_ID, projectDoc, missingAfterWrite = false } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const state = { columnQueries: 0, taskQueries: 0, writes: [], reads: 0 };
    const team = { _id: TEAM_ID, manager: MANAGER_ID, members: [MANAGER_ID, MEMBER_ID, OTHER_ID] };
    const doc = projectDoc || { _id: PROJECT_ID, name: "P", manager: MANAGER_ID, team, createdAt: new Date(), members: [MEMBER_ID], editors: [] };
    let readsOfFull = 0;
    mockModule("@/models/Project", {
      findById: () => ({
        populate: function () { return this; },
        // The first read is the permission check; later ones are the
        // response read. `missingAfterWrite` simulates a delete in between.
        lean: async () => {
          state.reads += 1;
          if (missingAfterWrite && state.writes.length > 0) return null;
          readsOfFull += 1;
          return { ...doc, members: (doc.members || []).map((m) => (typeof m === "string" ? user(m, "Person") : m)), editors: (doc.editors || []).map((m) => (typeof m === "string" ? user(m, "Person") : m)) };
        },
      }),
      updateOne: async (filter, op) => { state.writes.push({ filter, op }); },
    });
    mockModule("@/models/Column", { find: () => { state.columnQueries += 1; throw new Error("Column must not be queried"); } });
    mockModule("@/models/Task", { find: () => { state.taskQueries += 1; throw new Error("Task must not be queried"); } });
    mockModule("@/lib/authz", {
      applyProjectMembership: async (p, uid, action) => { state.writes.push({ membership: action, uid }); },
      applyProjectEditPermission: async (p, uid, action) => { state.writes.push({ editor: action, uid }); },
      isEligibleEditor: () => true,
      projectAccessFor: () => ({ allowed: true }),
      EDITING_MODES: ["everyone", "manager_approval"],
    });
    return state;
  }
  const ctx = { params: Promise.resolve({ id: PROJECT_ID }) };
  const SLIM_KEYS = ["editingMode", "editors", "id", "members", "name"];

  await test("POST members: slim response, and neither Column nor Task is queried", async () => {
    const state = setupProjectRoutes();
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: OTHER_ID }), ctx);
    const json = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.deepStrictEqual(Object.keys(json).sort(), SLIM_KEYS);
    assert.strictEqual(state.columnQueries + state.taskQueries, 0);
    assert.deepStrictEqual(state.writes, [{ membership: "add", uid: OTHER_ID }]);
  });

  await test("DELETE members: slim response, project's editors list is the server's", async () => {
    const state = setupProjectRoutes();
    const { DELETE } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await DELETE(fakeReq(undefined, `http://localhost/api?userId=${MEMBER_ID}`), ctx);
    const json = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.deepStrictEqual(Object.keys(json).sort(), SLIM_KEYS);
    assert.ok(Array.isArray(json.editors), "editors must be present so the client can drop a removed member's edit permission");
    assert.strictEqual(state.columnQueries + state.taskQueries, 0);
  });

  await test("POST editors / DELETE editors: slim response, permission fields intact", async () => {
    const state = setupProjectRoutes({ projectDoc: { _id: PROJECT_ID, name: "P", manager: MANAGER_ID, team: { _id: TEAM_ID, manager: MANAGER_ID, members: [MANAGER_ID, MEMBER_ID] }, members: [MEMBER_ID], editors: [MEMBER_ID], editingMode: "manager_approval" } });
    const route = require("../src/app/api/projects/[id]/editors/route.js");
    for (const [fn, req] of [[route.POST, fakeReq({ userId: MEMBER_ID })], [route.DELETE, fakeReq(undefined, `http://localhost/api?userId=${MEMBER_ID}`)]]) {
      const res = await fn(req, ctx);
      const json = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(json));
      assert.deepStrictEqual(Object.keys(json).sort(), SLIM_KEYS);
      assert.strictEqual(json.editingMode, "manager_approval", "the editing mode must not be lost from the response");
      assert.deepStrictEqual(json.editors.map((e) => e.id), [MEMBER_ID]);
      assert.deepStrictEqual(json.members.map((e) => e.id), [MEMBER_ID]);
    }
    assert.strictEqual(state.columnQueries + state.taskQueries, 0);
  });

  await test("PATCH project (rename and editing mode): slim response with the new values", async () => {
    const state = setupProjectRoutes();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "Renamed", editingMode: "manager_approval" }), ctx);
    const json = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.deepStrictEqual(Object.keys(json).sort(), SLIM_KEYS);
    assert.deepStrictEqual(state.writes[0].op, { $set: { name: "Renamed", editingMode: "manager_approval" } });
    assert.strictEqual(state.columnQueries + state.taskQueries, 0);
  });

  await test("a non-manager is still refused (403) and nothing is written — members, editors, PATCH", async () => {
    for (const run of [
      (r) => r.POST(fakeReq({ userId: OTHER_ID }), ctx),
      (r) => r.DELETE(fakeReq(undefined, `http://localhost/api?userId=${MEMBER_ID}`), ctx),
    ]) {
      for (const file of ["members", "editors"]) {
        const state = setupProjectRoutes({ callerId: MEMBER_ID });
        const res = await run(require(`../src/app/api/projects/[id]/${file}/route.js`));
        assert.strictEqual(res.status, 403, `${file}: expected 403`);
        assert.strictEqual(state.writes.length, 0, `${file}: nothing may be written`);
      }
    }
    const state = setupProjectRoutes({ callerId: MEMBER_ID });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "Hijack" }), ctx);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(state.writes.length, 0);
  });

  await test("a project deleted between the write and the response read gives a 404, not a crash", async () => {
    setupProjectRoutes({ missingAfterWrite: true });
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: OTHER_ID }), ctx);
    assert.strictEqual(res.status, 404);
  });

  // -------------------------------------------------------------------------
  console.log("\nPATCH /api/tasks/[id] — move response");

  function setupTaskPatch(plan) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const task = { _id: TASK_ID, project: PROJECT_ID, column: COL_A, order: 1000, title: "T", save: async () => {} };
    mockModule("@/lib/authz", {
      canEditProject: () => true,
      getTaskAccess: async () => ({ task, project: { _id: PROJECT_ID, team: { members: [] } } }),
      validateAssignees: () => ({ assignees: [] }),
    });
    mockModule("@/models/Column", { findOne: () => ({ lean: async () => ({ _id: COL_B, project: PROJECT_ID }) }) });
    mockModule("@/models/Task", {
      findById: () => ({
        select: function () { return this; },
        populate: function () { return this; },
        lean: async () => ({ _id: TASK_ID, project: PROJECT_ID, column: COL_B, order: 2500, title: "T", assignees: [], attachments: [] }),
      }),
    });
    mockModule("@/lib/taskOrdering", {
      planTaskMove: async ({ task: t, destColumnId }) => { t.column = destColumnId; return plan; },
      withOptionalTransaction: async (fn) => fn(null),
    });
  }
  const taskCtx = { params: Promise.resolve({ id: TASK_ID }) };

  await test("an ordinary move returns the task exactly as before — no extra field", async () => {
    setupTaskPatch({ rebalanced: [] });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const json = await (await PATCH(fakeReq({ columnId: COL_B, targetIndex: 1 }), taskCtx)).json();
    assert.strictEqual(json.id, TASK_ID);
    assert.strictEqual(json.columnId, COL_B);
    assert.ok(!("reorderedSiblings" in json));
  });

  await test("a move that renumbered the column also returns the renumbered siblings", async () => {
    const rebalanced = [{ id: "x1", order: 1000 }, { id: "x2", order: 3000 }];
    setupTaskPatch({ rebalanced });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const json = await (await PATCH(fakeReq({ columnId: COL_B, targetIndex: 1 }), taskCtx)).json();
    assert.deepStrictEqual(json.reorderedSiblings, rebalanced);
    assert.strictEqual(json.id, TASK_ID);
  });

  await test("a non-move edit (title) carries no sibling list", async () => {
    setupTaskPatch({ rebalanced: [{ id: "never", order: 1 }] });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const json = await (await PATCH(fakeReq({ title: "New" }), taskCtx)).json();
    assert.ok(!("reorderedSiblings" in json));
  });

  await test("planTaskMove reports exactly the siblings it rewrote (real function, in-memory Task)", async () => {
    resetModuleCache();
    const written = [];
    mockModule("@/models/Task", {
      find: () => ({
        select: function () { return this; },
        session: function () { return this; },
        lean: async () => [
          { _id: "s1", order: 4000, createdAt: new Date(1) },
          { _id: "s2", order: 4001, createdAt: new Date(2) },
        ],
      }),
      bulkWrite: async (ops) => { written.push(...ops); },
    });
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = { _id: "mv" };
    const result = await planTaskMove({ task, destColumnId: COL_B, targetIndex: 1 });
    assert.deepStrictEqual(result.rebalanced, [{ id: "s1", order: 1000 }, { id: "s2", order: 3000 }]);
    assert.strictEqual(task.order, 2000);
    assert.strictEqual(written.length, 2);

    resetModuleCache();
    mockModule("@/models/Task", {
      find: () => ({ select: function () { return this; }, session: function () { return this; }, lean: async () => [{ _id: "s1", order: 1000, createdAt: new Date(1) }] }),
      bulkWrite: async () => { throw new Error("no rebalance expected"); },
    });
    const again = require("../src/lib/taskOrdering.js");
    const t2 = { _id: "mv" };
    assert.deepStrictEqual((await again.planTaskMove({ task: t2, destColumnId: COL_B, targetIndex: 1 })).rebalanced, []);
  });

  // -------------------------------------------------------------------------
  console.log("\nlib/projectState.js — applying one changed entity");

  const ps = require("../src/lib/projectState.js");
  const baseProject = () => ({
    id: PROJECT_ID,
    name: "P",
    members: [{ id: MEMBER_ID, name: "M" }, { id: OTHER_ID, name: "O" }],
    editingMode: "manager_approval",
    editors: [{ id: MEMBER_ID, name: "M" }],
    columns: [
      { id: "c1", name: "Todo", order: 0, createdAt: null },
      { id: "c2", name: "Doing", order: 1, createdAt: null },
    ],
    tasks: [
      { id: "t1", title: "One", columnId: "c1", order: 1000, completed: false, assignees: [{ id: MEMBER_ID, name: "M" }], attachments: [] },
      { id: "t2", title: "Two", columnId: "c1", order: 2000, completed: false, assignees: [{ id: OTHER_ID, name: "O" }, { id: MEMBER_ID, name: "M" }], attachments: [] },
      { id: "t3", title: "Three", columnId: "c2", order: 1000, completed: false, assignees: [], attachments: [] },
    ],
  });

  await test("addTask appends, is idempotent, and does not mutate its input", async () => {
    const p = baseProject();
    const frozen = JSON.stringify(p);
    const t = { id: "t9", title: "New", columnId: "c2", order: 2000, assignees: [], attachments: [] };
    const once = ps.addTask(p, t);
    assert.strictEqual(once.tasks.length, 4);
    assert.strictEqual(ps.addTask(once, t), once, "adding the same id again must be a no-op");
    assert.strictEqual(JSON.stringify(p), frozen, "input must not be mutated");
    assert.strictEqual(once.columns, p.columns, "unrelated parts are shared, not copied");
  });

  await test("removeTask removes one task; removing a missing one is a no-op", async () => {
    const p = baseProject();
    const next = ps.removeTask(p, "t2");
    assert.deepStrictEqual(next.tasks.map((t) => t.id), ["t1", "t3"]);
    assert.strictEqual(ps.removeTask(next, "t2"), next);
  });

  await test("patchTask replaces only the given fields", async () => {
    const next = ps.patchTask(baseProject(), "t1", { completed: true });
    assert.strictEqual(next.tasks[0].completed, true);
    assert.strictEqual(next.tasks[0].title, "One");
    assert.strictEqual(next.tasks[1].completed, false);
  });

  await test("applyTaskMove changes column and order only — a title edit that landed meanwhile survives", async () => {
    const p = ps.patchTask(baseProject(), "t1", { title: "Edited meanwhile" });
    const next = ps.applyTaskMove(p, { id: "t1", columnId: "c2", order: 1500, title: "One", completed: true });
    const t1 = next.tasks.find((t) => t.id === "t1");
    assert.strictEqual(t1.columnId, "c2");
    assert.strictEqual(t1.order, 1500);
    assert.strictEqual(t1.title, "Edited meanwhile", "a stale title in the response must not overwrite the newer local one");
    assert.strictEqual(t1.completed, false, "fields other than column/order are not taken from a move response");
  });

  await test("applyTaskMove applies renumbered siblings, and only those", async () => {
    const next = ps.applyTaskMove(baseProject(), { id: "t1", columnId: "c2", order: 2000, reorderedSiblings: [{ id: "t3", order: 1000 }, { id: "t2", order: 9999 }] });
    assert.strictEqual(next.tasks.find((t) => t.id === "t2").order, 9999);
    assert.strictEqual(next.tasks.find((t) => t.id === "t3").order, 1000);
  });

  await test("column add / rename / remove / reorder", async () => {
    let p = baseProject();
    p = ps.addColumn(p, { id: "c3", name: "Done", order: 2, createdAt: null });
    assert.deepStrictEqual(p.columns.map((c) => c.id), ["c1", "c2", "c3"]);
    assert.strictEqual(ps.addColumn(p, { id: "c3", name: "dup", order: 9 }), p);
    p = ps.patchColumn(p, "c2", { name: "In progress" });
    assert.strictEqual(p.columns[1].name, "In progress");
    p = ps.applyColumnOrder(p, [{ id: "c3", order: 0 }, { id: "c1", order: 1 }, { id: "c2", order: 2 }]);
    assert.deepStrictEqual(p.columns.map((c) => c.id), ["c3", "c1", "c2"]);
    p = ps.removeColumn(p, "c1");
    assert.deepStrictEqual(p.columns.map((c) => c.id), ["c3", "c2"]);
    assert.strictEqual(ps.removeColumn(p, "c1"), p);
  });

  await test("access results: each scope takes only the fields that action changed", async () => {
    const p = baseProject();
    const response = { id: PROJECT_ID, name: "Server name", members: [{ id: "new" }], editingMode: "everyone", editors: [{ id: "e" }] };
    assert.deepStrictEqual(Object.keys(ps.ACCESS_SCOPES).sort(), ["editingMode", "editors", "memberAdded", "memberRemoved", "rename"]);
    const renamed = ps.applyAccessResult(p, response, "rename");
    assert.strictEqual(renamed.name, "Server name");
    assert.strictEqual(renamed.editingMode, "manager_approval", "a rename response must not change the editing mode");
    assert.strictEqual(renamed.members, p.members);
    const mode = ps.applyAccessResult(p, response, "editingMode");
    assert.strictEqual(mode.editingMode, "everyone");
    assert.strictEqual(mode.editors, p.editors, "an editing-mode response must not replace the editor list");
    const editors = ps.applyAccessResult(p, response, "editors");
    assert.deepStrictEqual(editors.editors, [{ id: "e" }]);
    assert.strictEqual(editors.editingMode, "manager_approval");
    const added = ps.applyAccessResult(p, response, "memberAdded");
    assert.deepStrictEqual(added.members, [{ id: "new" }]);
    assert.strictEqual(added.editors, p.editors, "adding a member does not touch edit permissions");
  });

  await test("removing a member also drops them from edit permission and from every task's assignees", async () => {
    const p = baseProject();
    const response = { id: PROJECT_ID, name: "P", members: [{ id: OTHER_ID, name: "O" }], editingMode: "manager_approval", editors: [] };
    const next = ps.applyAccessResult(p, response, "memberRemoved", { removedUserId: MEMBER_ID });
    assert.deepStrictEqual(next.members.map((m) => m.id), [OTHER_ID]);
    assert.deepStrictEqual(next.editors, [], "their edit permission goes with their access");
    assert.deepStrictEqual(next.tasks.find((t) => t.id === "t1").assignees, []);
    assert.deepStrictEqual(next.tasks.find((t) => t.id === "t2").assignees.map((a) => a.id), [OTHER_ID]);
    assert.strictEqual(next.tasks.find((t) => t.id === "t3"), p.tasks[2], "untouched tasks are the same objects");
    assert.strictEqual(next.editingMode, "manager_approval", "the editing mode survives member changes");
  });

  await test("a legacy project's `members: null` is carried through, not coerced", async () => {
    const next = ps.applyAccessResult(baseProject(), { members: null }, "memberAdded");
    assert.strictEqual(next.members, null);
  });

  await test("unknown scope or missing project is a no-op", async () => {
    const p = baseProject();
    assert.strictEqual(ps.applyAccessResult(p, {}, "nope"), p);
    assert.strictEqual(ps.applyAccessResult(null, {}, "rename"), null);
    assert.strictEqual(ps.addTask(null, { id: "x" }), null);
  });

  // -------------------------------------------------------------------------
  console.log("\ncallers — every successful mutation hands its result to the page (source checks)");

  const board = read("src/components/KanbanBoard.jsx");
  const page = read("src/app/dashboard/projects/[id]/page.jsx");
  const dialog = read("src/components/TaskDetailDialog.jsx");
  const members = read("src/components/ProjectMembersDialog.jsx");
  const newTask = read("src/components/NewTaskModal.jsx");

  const callSites = (src) => src.split("\n").map((l, i) => ({ l: l.trim(), n: i + 1 })).filter(({ l }) => /\bonChanged\(\)/.test(l) && !l.startsWith("//"));

  await test("KanbanBoard: every remaining onChanged() is a fallback or the 409 recovery", async () => {
    const offenders = callSites(board).filter(({ l }) => !/else onChanged\(\)|status === 409\) onChanged\(\)/.test(l));
    assert.deepStrictEqual(offenders, [], `unexpected direct reloads: ${JSON.stringify(offenders)}`);
  });

  await test("TaskDetailDialog: every remaining onChanged() is a fallback", async () => {
    const offenders = callSites(dialog).filter(({ l }) => !/else onChanged\(\)/.test(l));
    assert.deepStrictEqual(offenders, [], JSON.stringify(offenders));
  });

  await test("the page passes every callback the board accepts, and uses the reducers", async () => {
    for (const prop of ["onTaskPatched", "onTaskCreated", "onTaskMoved", "onTaskRemoved", "onColumnAdded", "onColumnPatched", "onColumnRemoved", "onColumnsReordered"]) {
      assert.ok(new RegExp(`${prop}=\\{`).test(page), `page must pass ${prop}`);
      assert.ok(new RegExp(`\\b${prop}\\b`).test(board), `board must accept ${prop}`);
    }
    assert.ok(/onChanged=\{accessChanged\}/.test(page), "the access dialog reports through accessChanged");
    assert.ok(!/onChanged=\{setProject\}/.test(page), "the access dialog must no longer replace the whole project");
    assert.ok(!/setProject\(data\);\s*\n\s*setRenameOpen/.test(page), "rename must not replace the whole project");
  });

  await test("the page falls back to a reload when a reload is in flight or the column is unknown", async () => {
    assert.ok(/function applyLocal[\s\S]*loadsInFlight\.current > 0[\s\S]*load\(\)/.test(page));
    assert.ok(/function taskCreated[\s\S]*hasColumn[\s\S]*load\(\)/.test(page));
    assert.ok(/function taskMoved[\s\S]*hasColumn[\s\S]*load\(\)/.test(page));
  });

  await test("a failed request never reaches a reducer: callbacks come after the awaited call, inside try", async () => {
    // Every callback below must appear after an `await apiFetch(` in the
    // same function and before its `catch`; a throw therefore skips it.
    for (const [src, name, cb] of [
      [board, "handleDrop", "onTaskMoved"],
      [board, "handleAddColumn", "onColumnAdded"],
      [board, "handleRenameColumn", "onColumnPatched"],
      [board, "confirmColumnDelete", "onColumnRemoved"],
      [board, "confirmCompleteTask", "onTaskPatched"],
      [board, "confirmTaskDelete", "onTaskRemoved"],
      [dialog, "saveColumn", "onMoved"],
      [newTask, "handleSubmit", "onCreated"],
    ]) {
      const start = src.search(new RegExp(`(async )?function ${name}\\b`));
      assert.ok(start >= 0, `${name} not found`);
      const body = src.slice(start, start + 4000);
      const awaitAt = body.search(/await apiFetch\(/);
      const cbAt = body.indexOf(cb);
      const catchAt = body.search(/\}\s*catch\s*\(/);
      assert.ok(awaitAt >= 0 && cbAt > awaitAt, `${name}: ${cb} must come after the request`);
      assert.ok(catchAt > cbAt, `${name}: ${cb} must be inside the try block`);
    }
  });

  await test("ProjectMembersDialog reports a scope with each result; removal also reports whom", async () => {
    for (const scope of ['"memberRemoved"', '"memberAdded"', '"editingMode"', '"editors"']) {
      assert.ok(members.includes(scope), `dialog must report ${scope}`);
    }
    assert.ok(/removedUserId: member\.id/.test(members));
    assert.ok(!/onChanged\(data\);/.test(members), "no caller may pass the bare response any more");
  });

  await test("attachments: upload and delete apply the returned list; a superseded response reloads", async () => {
    assert.ok(/attachmentsRequest/.test(dialog));
    assert.strictEqual((dialog.match(/reportPatch\(\{ attachments: updated\.attachments \}\)/g) || []).length, 2);
  });

  await test("GET /api/projects/[id] is unchanged: still the full project DTO", async () => {
    const route = read("src/app/api/projects/[id]/route.js");
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
    assert.ok(/toProjectDTO\(project, columns, tasks\)/.test(get));
  });

  summary();
})();
