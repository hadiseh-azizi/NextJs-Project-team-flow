require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers the audit fix for issue #13/#16 (orphaned tasks / race between
// authorization checks and writes): a column can be deleted (while
// "empty") at any time, and task creation previously checked the column
// existed once, well before the eventual insert, with no re-check at
// write time. Both routes now do their existence/empty check inside the
// same transaction as the write that depends on it (see the comments in
// tasks/route.js POST and columns/[columnId]/route.js DELETE for why this
// narrows, rather than eliminates, the race — true concurrent-transaction
// behavior needs a real replica set and is out of reach for this mocked
// suite; see the manual test matrix in CHANGELOG.md for that).
//
// These tests exercise the resulting code paths in isolation (column
// missing, column non-empty, column present) rather than simulating true
// concurrency, which — like 04/05/09 — would need a fuller in-memory
// transaction buffer than is worth building for this specific case.

const PROJECT_ID = "111111111111111111111111";
const COLUMN_ID = "222222222222222222222222";
const OTHER_COLUMN_ID = "333333333333333333333333";

function chain(resolveValue) {
  const node = {
    session: () => node,
    sort: () => node,
    select: () => node,
    populate: () => node,
    lean: async () => resolveValue,
    // Some callers await the query directly without a trailing .lean()
    // (e.g. columns/[columnId]/route.js DELETE does
    // `await Column.findOne(...).session(...)` with no .lean()) — making
    // the node itself thenable lets both styles resolve to the same
    // mocked value.
    then: (resolve, reject) => Promise.resolve(resolveValue).then(resolve, reject),
  };
  return node;
}

function fakeMongooseTransactional() {
  const realMongoose = require("mongoose");
  return {
    ...realMongoose,
    startSession: async () => ({
      withTransaction: async (fn) => fn(),
      endSession: async () => {},
    }),
  };
}

function fakeReq(body) {
  return { json: async () => body };
}

(async () => {
  console.log("Column-delete / task-create existence race (Issue #13/#16)");

  // ---------------- Task creation re-checks the column -----------------
  await test("task creation 404s if the column was deleted just before the write", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseTransactional());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
      validateAssignees: () => ({ assignees: [] }),
    });
    mockModule("@/models/Column", { findOne: () => chain(null) }); // gone by the time we check
    let taskCreated = false;
    mockModule("@/models/Task", {
      findOne: () => chain(null),
      create: async () => {
        taskCreated = true;
        return [{}];
      },
    });

    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Too late" }));
    const json = await res.json();
    assert.strictEqual(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.error, "Column not found");
    assert.strictEqual(taskCreated, false, "no task should be inserted once the column check fails");
  });

  await test("task creation still succeeds normally when the column exists", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseTransactional());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
      validateAssignees: () => ({ assignees: [] }),
    });
    mockModule("@/models/Column", { findOne: () => chain({ _id: COLUMN_ID, project: PROJECT_ID }) });
    let created = null;
    mockModule("@/models/Task", {
      findOne: () => chain(null), // no existing tasks, so order starts at the base step
      create: async (docsArray) => {
        created = { _id: "task1", ...docsArray[0] };
        return [created];
      },
      findById: () => ({
        select: function () { return this; },
        populate: function () { return this; },
        lean: async () => created,
      }),
    });

    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "On time" }));
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(created, "task should be created when the column exists");
  });

  // ---------------- Column deletion re-checks emptiness -----------------
  function setupColumnDeleteMocks({ columnExists = true, taskCount = 0 } = {}) {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseTransactional());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", { getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }) });

    let deleted = false;
    mockModule("@/models/Column", {
      findOne: () => chain(columnExists ? { _id: COLUMN_ID, project: PROJECT_ID } : null),
      deleteOne: async () => {
        deleted = true;
      },
    });
    mockModule("@/models/Task", {
      countDocuments: () => chain(taskCount),
    });
    return { wasDeleted: () => deleted };
  }

  await test("deleting a column that no longer exists 404s instead of a generic error", async () => {
    const world = setupColumnDeleteMocks({ columnExists: false });
    const { DELETE } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await DELETE(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID, columnId: COLUMN_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(world.wasDeleted(), false);
  });

  await test("deleting a column that gained a task 409s instead of deleting it", async () => {
    const world = setupColumnDeleteMocks({ columnExists: true, taskCount: 1 });
    const { DELETE } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await DELETE(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID, columnId: COLUMN_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.error, "Move or delete this column's tasks first");
    assert.strictEqual(world.wasDeleted(), false, "a column that gained a task must not be deleted");
  });

  await test("deleting a genuinely empty column still succeeds", async () => {
    const world = setupColumnDeleteMocks({ columnExists: true, taskCount: 0 });
    const { DELETE } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await DELETE(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID, columnId: COLUMN_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(json.ok);
    assert.strictEqual(world.wasDeleted(), true);
  });

  summary();
})();
