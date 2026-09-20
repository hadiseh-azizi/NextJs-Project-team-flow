require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

const PROJECT_ID = "111111111111111111111111";
const COLUMN_ID = "222222222222222222222222";

function makeFakeTaskWorld(initialTasks) {
  const committed = new Map(initialTasks.map((t) => [t._id, { ...t }]));
  let counter = 0;

  const mongooseMock = {
    startSession: async () => {
      const session = { buffer: [] }; // list of docs to commit
      session.withTransaction = async (fn) => {
        await fn();
        for (const doc of session.buffer) committed.set(doc._id, doc);
      };
      session.endSession = async () => {};
      return session;
    },
  };

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

  const TaskModel = {
    findOne: ({ column }) => {
      const matches = [...committed.values()].filter((t) => t.column === column);
      const max = matches.length ? matches.reduce((m, t) => (t.order > m.order ? t : m)) : null;
      return chain(max);
    },
    findById: (id) => chain(committed.get(id) || null),
    create: async (docsArray, opts = {}) => {
      const session = opts.session;
      const created = docsArray.map((d) => ({ _id: `task_${++counter}`, ...d }));
      if (session) session.buffer.push(...created);
      else created.forEach((d) => committed.set(d._id, d));
      return created;
    },
  };

  return { mongooseMock, TaskModel, committed };
}

function fakeReq(body) {
  return { json: async () => body };
}

function setupMocks({ tasks, createShouldFail = false }) {
  resetModuleCache();
  const world = makeFakeTaskWorld(tasks);
  if (createShouldFail) {
    world.TaskModel.create = async () => {
      throw new Error("simulated validation failure");
    };
  }
  const realMongoose = require("mongoose");
  mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
    getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
    validateAssignees: () => ({ assignees: [] }),
  });
  mockModule("@/models/Column", {
    findOne: () => ({ session: () => ({ lean: async () => ({ _id: COLUMN_ID }) }) }),
  });
  mockModule("@/models/Task", world.TaskModel);
  return world;
}

(async () => {
  console.log("Task creation transaction (Issue 3)");

  await test("creates a task at max + ORDER_STEP inside a transaction", async () => {
    const world = setupMocks({ tasks: [{ _id: "t1", column: COLUMN_ID, order: 1000, createdAt: new Date().toISOString() }] });
    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "New task" }));
    assert.strictEqual(res.status, 201);
    const tasksInColumn = [...world.committed.values()].filter((t) => t.column === COLUMN_ID);
    assert.strictEqual(tasksInColumn.length, 2);
    assert.strictEqual(tasksInColumn.find((t) => t.title === "New task").order, 2000);
  });

  await test("empty column starts at ORDER_STEP", async () => {
    const world = setupMocks({ tasks: [] });
    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "First task" }));
    assert.strictEqual(res.status, 201);
    const [task] = [...world.committed.values()];
    assert.strictEqual(task.order, 1000);
  });

  await test("a failure inside the transaction leaves no partial task committed", async () => {
    const world = setupMocks({ tasks: [{ _id: "t1", column: COLUMN_ID, order: 1000 }], createShouldFail: true });
    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Will fail" }));
    assert.strictEqual(res.status, 500);
    assert.strictEqual(world.committed.size, 1); // only the pre-existing task, nothing added
  });

  summary();
})();
