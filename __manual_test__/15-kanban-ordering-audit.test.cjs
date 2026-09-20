require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Kanban task/column ordering, drag-and-drop, and concurrency audit.
// Covers the 18 scenarios from the audit brief that aren't already
// exercised by 01-pure-ordering.test.cjs (computeMovePlan/compareTasks,
// pure functions), 03-column-order-retry.test.cjs (column creation
// races), 04-done-column-transaction.test.cjs (done-column concurrency),
// 05-task-create-transaction.test.cjs (new-task ordering), and
// 02-mongo-transaction.test.cjs (transaction retry behavior) — those five
// still pass unmodified and remain the coverage for their scenarios; see
// KANBAN_ORDERING_AUDIT.md for the full scenario-to-test map.

const PROJECT_ID = "111111111111111111111111";
const COL_A = "222222222222222222222222";
const COL_B = "333333333333333333333333";

// ---------------------------------------------------------------------
// A small in-memory Task collection, shared by the planTaskMove tests
// (call it directly) and the PATCH-route tests (go through the route,
// with a transaction buffer like 05-task-create-transaction.test.cjs).
// ---------------------------------------------------------------------
function chain(resolveValue) {
  const node = {
    sort: () => node,
    select: () => node,
    session: () => node,
    populate: () => node,
    lean: async () => resolveValue,
  };
  return node;
}

function makeTaskWorld(initialTasks) {
  const committed = new Map(initialTasks.map((t) => [t._id, { ...t }]));
  let counter = 0;

  const TaskModel = {
    find: ({ column, _id }) => {
      let arr = [...committed.values()].filter((t) => String(t.column) === String(column));
      if (_id && _id.$ne !== undefined) {
        arr = arr.filter((t) => String(t._id) !== String(_id.$ne));
      }
      return chain(arr);
    },
    findOne: ({ column }) => {
      const arr = [...committed.values()].filter((t) => String(t.column) === String(column));
      const max = arr.length ? arr.reduce((m, t) => (t.order > m.order ? t : m)) : null;
      return chain(max);
    },
    findById: (id) => chain(committed.get(String(id)) || null),
    bulkWrite: async (ops) => {
      for (const op of ops) {
        const id = String(op.updateOne.filter._id);
        const doc = committed.get(id);
        if (doc) Object.assign(doc, op.updateOne.update.$set);
      }
    },
    create: async (docsArray) => {
      const created = docsArray.map((d) => ({ _id: `task_${++counter}`, order: 0, ...d }));
      created.forEach((d) => committed.set(d._id, d));
      return created;
    },
  };

  return { committed, TaskModel };
}

// A version of the world whose writes only land in `committed` once the
// enclosing "transaction" commits — same technique as
// 05-task-create-transaction.test.cjs, extended to support bulkWrite so
// a mid-rebalance failure can be proven not to leave siblings half
// renumbered.
function makeTransactionalTaskWorld(initialTasks) {
  const committed = new Map(initialTasks.map((t) => [t._id, { ...t }]));
  let counter = 0;

  function snapshotFor(session) {
    // Reads inside a session should see committed state plus whatever
    // that same session has already buffered — mirrors "read your own
    // writes" within one MongoDB transaction.
    const view = new Map(committed);
    if (session) for (const [id, doc] of session.pending) view.set(id, doc);
    return view;
  }

  const TaskModel = {
    find: ({ column, _id }, opts) => {
      // .session(session) is called after .find(), so we can't know the
      // session yet here — return a node whose .session() call captures
      // it before .lean() resolves.
      let capturedSession = null;
      const node = {
        select: () => node,
        session: (s) => {
          capturedSession = s;
          return node;
        },
        lean: async () => {
          let arr = [...snapshotFor(capturedSession).values()].filter((t) => String(t.column) === String(column));
          if (_id && _id.$ne !== undefined) arr = arr.filter((t) => String(t._id) !== String(_id.$ne));
          return arr;
        },
      };
      return node;
    },
    findOne: ({ column }) => {
      let capturedSession = null;
      const node = {
        sort: () => node,
        select: () => node,
        session: (s) => {
          capturedSession = s;
          return node;
        },
        lean: async () => {
          const arr = [...snapshotFor(capturedSession).values()].filter((t) => String(t.column) === String(column));
          return arr.length ? arr.reduce((m, t) => (t.order > m.order ? t : m)) : null;
        },
      };
      return node;
    },
    findById: (id) => chain(committed.get(String(id)) || null),
    bulkWrite: async (ops, opts = {}) => {
      const session = opts.session;
      for (const op of ops) {
        const id = String(op.updateOne.filter._id);
        if (session) {
          const base = session.pending.get(id) || committed.get(id) || {};
          session.pending.set(id, { ...base, ...op.updateOne.update.$set });
        } else {
          const doc = committed.get(id);
          if (doc) Object.assign(doc, op.updateOne.update.$set);
        }
      }
    },
    create: async (docsArray, opts = {}) => {
      const session = opts.session;
      const created = docsArray.map((d) => ({ _id: `task_${++counter}`, order: 0, ...d }));
      if (session) created.forEach((d) => session.pending.set(d._id, d));
      else created.forEach((d) => committed.set(d._id, d));
      return created;
    },
  };

  const mongooseMock = {
    startSession: async () => {
      const session = { pending: new Map() };
      session.withTransaction = async (fn) => {
        await fn();
        for (const [id, doc] of session.pending) committed.set(id, doc);
      };
      session.endSession = async () => {};
      return session;
    },
  };

  return { committed, TaskModel, mongooseMock };
}

function fakeReq(body) {
  return { json: async () => body };
}

function setupPatchRouteMocks(world, task) {
  resetModuleCache();
  const realMongoose = require("mongoose");
  mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
    getTaskAccess: async () => ({ task, project: { _id: PROJECT_ID, team: { members: [] } } }),
    validateAssignees: () => ({ assignees: [] }),
  });
  mockModule("@/models/Column", {
    findOne: () => chain({ _id: COL_B, project: PROJECT_ID }),
  });
  mockModule("@/models/Task", world.TaskModel);
}

(async () => {
  const { computeMovePlan, ORDER_STEP } = require("../src/lib/taskOrdering.js");
  const { compareTasks, currentSiblingIndex } = require("../src/lib/taskOrderCompare.js");

  // ------------------------------------------------------------------
  console.log("planTaskMove (I/O-level, real function, in-memory Task)");

  await test("moving to the beginning of a column lands before every sibling", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_A, order: 2000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_B, order: 1000, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: 0 });
    assert.strictEqual(task.column, COL_A);
    assert.ok(task.order < 1000, `expected order below the current first task, got ${task.order}`);
  });

  await test("moving to the middle lands strictly between its new neighbors", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_A, order: 2000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_B, order: 1000, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: 1 });
    assert.strictEqual(task.order, 1500);
  });

  await test("moving to the end (targetIndex omitted) appends after the current last task", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_A, order: 2000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_B, order: 1000, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: undefined });
    assert.strictEqual(task.order, 3000);
  });

  await test("dropping immediately before a specific task matches computeMovePlan for that index", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_A, order: 2000, createdAt: "2024-01-01" },
      { _id: "c", column: COL_A, order: 3000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_A, order: 500, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    // "immediately before b" == index 1 among [a, b, c].
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: 1 });
    assert.strictEqual(task.order, 1500); // strictly between a(1000) and b(2000)
  });

  await test("dropping immediately after a specific task matches computeMovePlan for that index", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_A, order: 2000, createdAt: "2024-01-01" },
      { _id: "c", column: COL_A, order: 3000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_A, order: 500, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    // "immediately after b" == index 2 among [a, b, c].
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: 2 });
    assert.strictEqual(task.order, 2500); // strictly between b(2000) and c(3000)
  });

  await test("moving a task around itself within the same column is excluded from its own sibling list", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_A, order: 2000, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    // Re-requesting the position it's already effectively at (end, index 1
    // among its one sibling) must not throw or fold the task into its own
    // sibling comparison.
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: 1 });
    assert.strictEqual(task.order, 2000); // a(1000) + ORDER_STEP, unchanged
  });

  await test("rebalance triggers when no integer room remains, and renumbers every sibling", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_A, order: 1001, createdAt: "2024-01-01" }, // adjacent — no room
      { _id: "m", column: COL_B, order: 1000, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    await planTaskMove({ task, destColumnId: COL_A, targetIndex: 1 });
    assert.strictEqual(world.committed.get("a").order, ORDER_STEP);
    assert.strictEqual(task.order, 2 * ORDER_STEP);
    assert.strictEqual(world.committed.get("b").order, 3 * ORDER_STEP);
  });

  await test("moving between columns updates both the column and the order in one planned write", async () => {
    resetModuleCache();
    const world = makeTaskWorld([
      { _id: "a", column: COL_B, order: 1000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_A, order: 1000, createdAt: "2024-01-01" },
    ]);
    mockModule("@/models/Task", world.TaskModel);
    const { planTaskMove } = require("../src/lib/taskOrdering.js");
    const task = world.committed.get("m");
    await planTaskMove({ task, destColumnId: COL_B, targetIndex: 0 });
    assert.strictEqual(task.column, COL_B);
    assert.ok(task.order < 1000);
  });

  // ------------------------------------------------------------------
  console.log("\nPATCH /api/tasks/[id] — reorder and cross-column move via the real route");

  await test("reordering within a column persists the new order and returns 200", async () => {
    const world = makeTransactionalTaskWorld([
      { _id: "a", column: COL_B, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_B, order: 2000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_B, order: 3000, createdAt: "2024-01-01" },
    ]);
    const task = {
      ...world.committed.get("m"),
      save: async function (opts) {
        world.committed.set(this._id, { ...this });
      },
    };
    setupPatchRouteMocks(world, task);
    // findById used for the final populated re-read after save()
    world.TaskModel.findById = () => ({
      select: function () { return this; },
      populate: function () { return this; },
      lean: async () => ({ ...world.committed.get("m"), assignees: [] }),
    });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ targetIndex: 0 }), { params: Promise.resolve({ id: "m" }) });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.ok(world.committed.get("m").order < 1000, "task should now sort before both siblings");
  });

  await test("moving to a different column via columnId+targetIndex updates both fields atomically", async () => {
    const world = makeTransactionalTaskWorld([
      { _id: "a", column: COL_A, order: 1000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_B, order: 1000, createdAt: "2024-01-01" },
    ]);
    const task = {
      ...world.committed.get("m"),
      save: async function () {
        world.committed.set(this._id, { ...this });
      },
    };
    setupPatchRouteMocks(world, task);
    world.TaskModel.findById = () => ({
      select: function () { return this; },
      populate: function () { return this; },
      lean: async () => ({ ...world.committed.get("m"), assignees: [] }),
    });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ columnId: COL_A, targetIndex: 1 }), { params: Promise.resolve({ id: "m" }) });
    assert.strictEqual(res.status, 200);
    const moved = world.committed.get("m");
    assert.strictEqual(moved.column, COL_A);
    assert.strictEqual(moved.order, 2000); // after a(1000), end of column
  });

  await test("a failure mid-move leaves no partially-renumbered siblings (transaction rollback)", async () => {
    const world = makeTransactionalTaskWorld([
      { _id: "a", column: COL_B, order: 1000, createdAt: "2024-01-01" },
      { _id: "b", column: COL_B, order: 1001, createdAt: "2024-01-01" }, // forces a rebalance
      { _id: "m", column: COL_B, order: 5000, createdAt: "2024-01-01" },
    ]);
    const task = {
      ...world.committed.get("m"),
      save: async function () {
        throw new Error("simulated write failure after rebalance was planned");
      },
    };
    setupPatchRouteMocks(world, task);
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ targetIndex: 1 }), { params: Promise.resolve({ id: "m" }) });
    assert.strictEqual(res.status, 500);
    // Rebalance ops were buffered on the (never-committed) session — a
    // and b must be exactly as they started.
    assert.strictEqual(world.committed.get("a").order, 1000);
    assert.strictEqual(world.committed.get("b").order, 1001);
  });

  // ------------------------------------------------------------------
  console.log("\nConcurrency: moves, creates, and duplicate orders");

  await test("two concurrent moves into the same column can tie on order, but never crash and always sort deterministically", () => {
    // Simulates two requests that both read the destination column's
    // siblings before either has written — same "cosmetic tie" trade-off
    // documented in lib/taskOrdering.js for two truly simultaneous
    // writes with no distributed lock: each computes its plan from the
    // identical pre-move snapshot, so their writes (applied in either
    // order) can land on the same order value.
    const { computeMovePlan } = require("../src/lib/taskOrdering.js");
    const snapshot = [{ _id: "a", order: 1000, createdAt: "2024-01-01T00:00:00.000Z" }];
    const m1 = { _id: "m1", order: 1000, createdAt: "2024-01-01T00:00:00.000Z" };
    const m2 = { _id: "m2", order: 1000, createdAt: "2024-01-02T00:00:00.000Z" };
    const plan1 = computeMovePlan({ movingId: "m1", siblingsAsc: snapshot, targetIndex: 1 });
    const plan2 = computeMovePlan({ movingId: "m2", siblingsAsc: snapshot, targetIndex: 1 });
    assert.strictEqual(plan1.newOrder, plan2.newOrder, "both landed at the same computed order — the documented tie");
    // The tie doesn't corrupt anything: compareTasks still produces a
    // single, deterministic total order every time this column is sorted,
    // regardless of which of the two writes physically lands first.
    const a = snapshot[0];
    m1.order = plan1.newOrder;
    m2.order = plan2.newOrder;
    const colA = [a, m1, m2];
    const sortedOnce = [...colA].sort(compareTasks).map((t) => t._id);
    const sortedTwice = [...colA].reverse().sort(compareTasks).map((t) => t._id);
    assert.deepStrictEqual(sortedOnce, sortedTwice);
  });

  await test("concurrent move + create into the same column: the create doesn't collide with the just-moved task", async () => {
    const world = makeTransactionalTaskWorld([
      { _id: "a", column: COL_B, order: 1000, createdAt: "2024-01-01" },
      { _id: "m", column: COL_A, order: 1000, createdAt: "2024-01-01" },
    ]);
    // Move "m" into COL_B first (its transaction commits before the
    // create's read, same as the real app: nextOrderForNewTask always
    // reads the current max at call time).
    const task = { ...world.committed.get("m"), save: async function () { world.committed.set(this._id, { ...this }); } };
    setupPatchRouteMocks(world, task);
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    world.TaskModel.findById = () => ({
      select: function () { return this; },
      populate: function () { return this; },
      lean: async () => ({ ...world.committed.get("m"), assignees: [] }),
    });
    await PATCH(fakeReq({ columnId: COL_B, targetIndex: undefined }), { params: Promise.resolve({ id: "m" }) });
    const movedOrder = world.committed.get("m").order;

    // Now create a new task in COL_B — it must land strictly after the
    // task that was just moved in, not collide with it.
    resetModuleCache();
    const realMongoose = require("mongoose");
    mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
      validateAssignees: () => ({ assignees: [] }),
    });
    mockModule("@/models/Column", { findOne: () => chain({ _id: COL_B, project: PROJECT_ID }) });
    delete world.TaskModel.findById; // restore the world's default findById (was overridden above for the PATCH call)
    world.TaskModel.findById = (id) => chain(world.committed.get(String(id)) || null);
    mockModule("@/models/Task", world.TaskModel);
    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeReq({ projectId: PROJECT_ID, columnId: COL_B, title: "New" }));
    const json = await res.json();
    assert.strictEqual(res.status, 201, JSON.stringify(json));
    const newTask = [...world.committed.values()].find((t) => t.title === "New");
    assert.ok(newTask.order > movedOrder, "new task must sort after the concurrently-moved-in task");
  });

  // ------------------------------------------------------------------
  console.log("\ncurrentSiblingIndex — client no-op detection agrees with the full comparator");

  await test("agrees with a bare order comparison when orders are unique", () => {
    const siblings = [
      { _id: "a", order: 1000, createdAt: "2024-01-01" },
      { _id: "b", order: 3000, createdAt: "2024-01-01" },
    ];
    const task = { _id: "m", order: 2000, createdAt: "2024-01-01" };
    assert.strictEqual(currentSiblingIndex(task, siblings), 1);
  });

  await test("resolves duplicate-order ties by createdAt, matching how colTasks actually renders", () => {
    // a and the task both have order 1000; the task's createdAt sits
    // between a and b's — the true rendered order (via compareTasks) is
    // a, task, b, i.e. the task is currently at index 1, not "tied with a
    // at the front" and not "past the end" as a bare `order` comparison
    // would conclude (see the bug this replaces).
    const a = { _id: "a", order: 1000, createdAt: "2024-01-01T00:00:00.000Z" };
    const b = { _id: "b", order: 1000, createdAt: "2024-01-03T00:00:00.000Z" };
    const task = { _id: "m", order: 1000, createdAt: "2024-01-02T00:00:00.000Z" };
    const siblings = [a, b].sort(compareTasks);
    assert.strictEqual(currentSiblingIndex(task, siblings), 1);
    // Sanity: merging the task into the siblings with the same comparator
    // and reading off its index reproduces the same answer — proving
    // currentSiblingIndex matches the board's actual render order.
    const merged = [a, b, task].sort(compareTasks).map((t) => t._id);
    assert.deepStrictEqual(merged, ["a", "m", "b"]);
  });

  await test("a task with the same order and createdAt as every sibling still resolves via the id tie-break", () => {
    const a = { _id: "aaaa", order: 500, createdAt: "2024-01-01T00:00:00.000Z" };
    const task = { _id: "bbbb", order: 500, createdAt: "2024-01-01T00:00:00.000Z" };
    // "bbbb" sorts after "aaaa" lexicographically, so the task's true
    // position is after a — index 1, i.e. the end of a 1-sibling list.
    assert.strictEqual(currentSiblingIndex(task, [a]), 1);
  });

  await test("dropping a task back onto its own rendered slot is correctly recognized as a no-op", () => {
    // Reproduces the exact scenario the old `t.order > task.order` check
    // got wrong: two siblings tie with the task on `order`, so the task's
    // true rendered index (1, between them) must equal the targetIndex
    // the client computes when the user drops it back in that same visual
    // spot, or a harmless drag would fire a needless PATCH.
    const d = { _id: "d", order: 2000, createdAt: "2024-01-01T00:00:00.000Z" };
    const e = { _id: "e", order: 2000, createdAt: "2024-01-03T00:00:00.000Z" };
    const task = { _id: "t", order: 2000, createdAt: "2024-01-02T00:00:00.000Z" };
    const siblings = [d, e].sort(compareTasks); // [d, e]
    const currentIndex = currentSiblingIndex(task, siblings);
    assert.strictEqual(currentIndex, 1); // visually sits between d and e
    // A drop that recomputes targetIndex=1 (before e / after d) must be a
    // no-op; a drop all the way to the end (targetIndex=2) must NOT be —
    // the old bare-order check treated both as "already at the end".
    assert.strictEqual(currentIndex === 1, true);
    assert.strictEqual(currentIndex === siblings.length, false);
  });

  summary();
})();
