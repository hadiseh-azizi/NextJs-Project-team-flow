require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers the "Boards, Completed columns & task completion" changelog
// entry: a project no longer auto-creates a board (see also
// 12-transaction-fallback-routes.test.cjs, which covers the same route's
// transaction-fallback story), and a task's/project's completion state is
// its own persisted field — set via PATCH /api/tasks/[id] — independent
// of which column a task sits in. (Project-level completion was later
// removed entirely; the PATCH /api/projects/[id] tests at the bottom now
// pin that removal.)
// See lib/taskCompletion.js for the shared progress calculation this
// enables, and KanbanBoard.jsx for the two-step confirmation flow built on
// top of these routes (not covered here — that's UI, not I/O).

const PROJECT_ID = "111111111111111111111111";
const TEAM_ID = "222222222222222222222222";
const TASK_ID = "333333333333333333333333";
const USER_ID = "444444444444444444444444";
const COL_ID = "555555555555555555555555";
const OTHER_COL_ID = "666666666666666666666666";

function fakeReq(body) {
  return { json: async () => body };
}

(async () => {
  // ------------------------------------------------------------------
  console.log("lib/taskCompletion.js — progress is derived from task.completed, never from column");

  const { isTaskCompleted, projectProgress } = require("../src/lib/taskCompletion.js");

  await test("a completed flag is read as a strict boolean regardless of how it's stored", () => {
    assert.strictEqual(isTaskCompleted({ completed: true }), true);
    assert.strictEqual(isTaskCompleted({ completed: false }), false);
    // A task written before this field existed has no `completed` key at
    // all once read via .lean() (Mongoose doesn't backfill schema
    // defaults for missing fields on a lean read) — this must read as
    // "not completed", not throw or read as truthy.
    assert.strictEqual(isTaskCompleted({}), false);
    assert.strictEqual(isTaskCompleted(undefined), false);
  });

  await test("progress counts completed tasks regardless of which column they're in", () => {
    const tasks = [
      { id: "a", columnId: COL_ID, completed: true },
      { id: "b", columnId: OTHER_COL_ID, completed: true }, // completed, but not in the "done" column
      { id: "c", columnId: COL_ID, completed: false },
      { id: "d", columnId: OTHER_COL_ID, completed: false },
    ];
    const { total, done, pct } = projectProgress(tasks);
    assert.strictEqual(total, 4);
    assert.strictEqual(done, 2);
    assert.strictEqual(pct, 50);
  });

  await test("an empty task list is 0% (not NaN or a division error)", () => {
    assert.deepStrictEqual(projectProgress([]), { total: 0, done: 0, pct: 0 });
    assert.deepStrictEqual(projectProgress(undefined), { total: 0, done: 0, pct: 0 });
  });

  await test("percentage rounds to the nearest whole number", () => {
    const tasks = [
      { completed: true },
      { completed: false },
      { completed: false },
    ];
    assert.strictEqual(projectProgress(tasks).pct, 33);
  });

  // ------------------------------------------------------------------
  console.log("\nPOST /api/projects — a new project has no board at all");

  await test("the response has an empty columns array, and no Column write happens", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      canEditProject: () => true, isTeamManager: () => true, accessibleTeamIds: async () => [] });
    mockModule("@/models/Team", { findById: () => ({ lean: async () => ({ _id: TEAM_ID, manager: USER_ID }) }) });
    let created = null;
    mockModule("@/models/Project", {
      create: async (doc) => {
        created = { _id: PROJECT_ID, ...doc };
        return created;
      },
      findById: () => ({
        populate: function () { return this; },
        lean: async () => ({ ...created, createdAt: new Date(), manager: { _id: USER_ID }, team: { _id: TEAM_ID, members: [] } }),
      }),
    });
    let columnWriteHappened = false;
    mockModule("@/models/Column", {
      insertMany: async () => { columnWriteHappened = true; return []; },
      create: async () => { columnWriteHappened = true; return {}; },
      find: () => ({ lean: async () => [] }),
    });

    const { POST } = require("../src/app/api/projects/route.js");
    const res = await POST(fakeReq({ name: "Fresh project", teamId: TEAM_ID }));
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(columnWriteHappened, false, "no column should ever be written on project creation");
    assert.deepStrictEqual(json.columns, []);
    assert.strictEqual("completed" in json, false, "a project no longer carries a completion state");
  });

  // ------------------------------------------------------------------
  console.log("\nPATCH /api/tasks/[id] — completion is independent of column");

  function taskFixture(overrides = {}) {
    return {
      _id: TASK_ID,
      column: COL_ID,
      title: "Write the report",
      completed: false,
      save: async function () {},
      ...overrides,
    };
  }

  function setupTaskPatchMocks(task, { columnLookup } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      canEditProject: () => true,
      getTaskAccess: async () => ({ task, project: { _id: PROJECT_ID, team: { members: [] } } }),
      validateAssignees: () => ({ assignees: [] }),
    });
    mockModule("@/models/Column", {
      findOne: () => ({ lean: async () => columnLookup ?? null }),
    });
    mockModule("@/models/Task", {
      findById: () => ({
        select: function () { return this; },
        populate: function () { return this; },
        lean: async () => ({ ...task, assignees: [] }),
      }),
    });
  }

  await test("marking a task completed does not touch its column", async () => {
    const task = taskFixture();
    let savedCompleted;
    task.save = async function () { savedCompleted = this.completed; };
    setupTaskPatchMocks(task);

    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ completed: true }), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(savedCompleted, true);
    assert.strictEqual(task.column, COL_ID, "column must be untouched by a completion-only request");
  });

  await test("a task can be completed even though the project has no Completed column — the request never looks one up", async () => {
    const task = taskFixture();
    // No Column mock configured to return anything but null — if the
    // route tried to look up a "done" column for a plain completion
    // request, this would surface as a 404 further down; it must not.
    setupTaskPatchMocks(task, { columnLookup: null });

    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ completed: true }), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  });

  await test("moving a completed task to a new column via columnId leaves `completed` alone", async () => {
    const task = taskFixture({ completed: true });
    let savedCompleted;
    let savedColumn;
    task.save = async function () { savedCompleted = this.completed; savedColumn = this.column; };
    setupTaskPatchMocks(task, { columnLookup: { _id: OTHER_COL_ID, project: PROJECT_ID } });
    // The route delegates the actual column/order assignment to
    // planTaskMove (see lib/taskOrdering.js, already covered end-to-end
    // by 15-kanban-ordering-audit.test.cjs) inside withOptionalTransaction
    // — stubbed here so this test is only about `completed` surviving the
    // move, not re-proving ordering/transaction behavior that's already
    // covered elsewhere.
    mockModule("@/lib/taskOrdering", {
      planTaskMove: async ({ task: t, destColumnId }) => { t.column = destColumnId; },
      withOptionalTransaction: async (fn) => fn(null),
    });

    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ columnId: OTHER_COL_ID }), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(savedCompleted, true, "a plain column move must never flip completed back to false");
    assert.strictEqual(savedColumn, OTHER_COL_ID);
  });

  await test("reopening a task (completed: false) is accepted the same way", async () => {
    const task = taskFixture({ completed: true });
    let savedCompleted;
    task.save = async function () { savedCompleted = this.completed; };
    setupTaskPatchMocks(task);

    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ completed: false }), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(savedCompleted, false);
  });

  await test("a non-boolean `completed` is rejected with 400 and never reaches save()", async () => {
    const task = taskFixture();
    let saveCalled = false;
    task.save = async function () { saveCalled = true; };
    setupTaskPatchMocks(task);

    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ completed: "yes" }), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
    assert.strictEqual(saveCalled, false);
  });

  // ------------------------------------------------------------------
  console.log("\nPATCH /api/projects/[id] — projects can no longer be marked completed");

  function setupProjectPatchMocks({ manager = USER_ID } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    let updateFields = null;
    // The route calls Project.findById(id).lean() once up front (to check
    // the manager) and, after a successful update, again with
    // .populate(...).populate(...).lean() to build the response DTO — the
    // same mock has to answer both shapes.
    mockModule("@/models/Project", {
      findById: () => {
        const chain = {
          lean: async () => ({
            _id: PROJECT_ID,
            manager,
            name: "Q3 launch",
            createdAt: new Date(),
            team: { _id: TEAM_ID, name: "Launch team", manager: { _id: manager }, members: [] },
          }),
          populate: () => chain,
        };
        return chain;
      },
      updateOne: async (filter, update) => { updateFields = update.$set; },
    });
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/models/Task", { find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }) });
    return {
      get updateFields() { return updateFields; },
    };
  }

  await test("a request that only tries to set completed is rejected and writes nothing", async () => {
    const mocks = setupProjectPatchMocks();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ completed: true }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
    assert.strictEqual(mocks.updateFields, null, "no update may be issued for a completed-only request");
  });

  await test("completed sent alongside a rename is ignored — only the name is written", async () => {
    const mocks = setupProjectPatchMocks();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "Renamed", completed: true }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.deepStrictEqual(mocks.updateFields, { name: "Renamed" });
  });

  await test("renaming a project still works on its own", async () => {
    const mocks = setupProjectPatchMocks();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "Renamed" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.deepStrictEqual(mocks.updateFields, { name: "Renamed" });
  });

  await test("a request with no recognised field is rejected rather than silently no-op'ing", async () => {
    setupProjectPatchMocks();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({}), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
  });

  await test("a non-manager still gets the same 403 when renaming", async () => {
    setupProjectPatchMocks({ manager: "999999999999999999999999" });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "Renamed" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
  });

  summary();
})();
