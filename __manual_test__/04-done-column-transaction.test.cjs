require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// A small in-memory "database" that mimics just enough MongoDB
// transaction semantics to prove the route's code is correctly scoped:
// writes made with a session are buffered and only applied to the
// committed store if the transaction's callback resolves; if it throws,
// the buffer is discarded (rollback), exactly like a real replica set
// aborting the transaction. This is a simulation for unit-testing the
// *code path*, not a substitute for live replica-set verification (see
// CHANGELOG.md).
function makeFakeWorld(initialColumns) {
  const committed = new Map(initialColumns.map((c) => [c._id, { ...c }]));

  function bufferPatch(session, id, patch) {
    const existing = session.buffer.get(id) || {};
    session.buffer.set(id, { ...existing, ...patch });
  }

  const mongooseMock = {
    startSession: async () => {
      const session = { buffer: new Map() };
      session.withTransaction = async (fn) => {
        await fn(); // throwing here means NO commit below
        for (const [id, patch] of session.buffer) {
          committed.set(id, { ...(committed.get(id) || {}), ...patch });
        }
      };
      session.endSession = async () => {};
      return session;
    },
  };

  const ColumnModel = {
    findOne: ({ _id, project }) => ({
      lean: async () => {
        const doc = [...committed.values()].find((d) => d._id === _id && d.project === project);
        return doc ? { ...doc } : null;
      },
    }),
    findOneAndUpdate: async ({ _id, project }, { $set }, opts = {}) => {
      const session = opts.session;
      const base = [...committed.values()].find((d) => d._id === _id && d.project === project);
      if (!base) return null;
      if (session) bufferPatch(session, _id, $set);
      else committed.set(_id, { ...committed.get(_id), ...$set });
      // findOneAndUpdate({ new: true }) reflects this write immediately
      // for the caller, even before the transaction commits — read your
      // own writes within the same session, same as real MongoDB.
      const effective = session ? { ...base, ...(session.buffer.get(_id) || {}) } : committed.get(_id);
      return opts.new ? { ...effective } : { ...base };
    },
    updateMany: async (filter, update, opts = {}) => {
      const session = opts.session;
      const matches = [...committed.values()].filter(
        (d) => d.project === filter.project && d._id !== filter._id.$ne
      );
      for (const m of matches) {
        if (session) bufferPatch(session, m._id, update.$set);
        else committed.set(m._id, { ...committed.get(m._id), ...update.$set });
      }
    },
  };

  return { mongooseMock, ColumnModel, committed };
}

function fakeReq(body) {
  return { json: async () => body };
}

function setupMocks({ columns, updateManyShouldFail = false }) {
  resetModuleCache();
  const world = makeFakeWorld(columns);
  if (updateManyShouldFail) {
    world.ColumnModel.updateMany = async () => {
      // Fails after the save would already have happened in the old,
      // non-transactional flow — simulates "the second write fails"
      // from the Issue 1 bug report.
      throw new Error("simulated network drop mid-transaction");
    };
  }
  const realMongoose = require("mongoose");
  // Only override startSession — Schema/model/models are still needed
  // (unmocked) by unrelated models loaded transitively via lib/auth.js
  // (e.g. models/User.js), so replacing the whole module would break
  // those instead of just isolating the transaction behavior under test.
  mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", { getAccessibleProject: async () => ({ _id: "p1" }) });
  mockModule("@/models/Task", { countDocuments: async () => 0 });
  mockModule("@/models/Column", world.ColumnModel);
  return world;
}

(async () => {
  console.log("Done-column PATCH transaction (Issue 1)");

  await test("marking a column done clears the flag on every other column, atomically", async () => {
    const world = setupMocks({
      columns: [
        { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", project: "p1", name: "To Do", order: 0, isDoneColumn: false },
        { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", project: "p1", name: "Done", order: 1, isDoneColumn: true },
      ],
    });
    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await PATCH(fakeReq({ isDoneColumn: true }), { params: { id: "p1", columnId: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(world.committed.get("aaaaaaaaaaaaaaaaaaaaaaaa").isDoneColumn, true);
    assert.strictEqual(world.committed.get("bbbbbbbbbbbbbbbbbbbbbbbb").isDoneColumn, false);
    const doneCount = [...world.committed.values()].filter((c) => c.isDoneColumn).length;
    assert.strictEqual(doneCount, 1);
  });

  await test("unmarking a done column touches only that column (existing semantics preserved)", async () => {
    const world = setupMocks({
      columns: [
        { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", project: "p1", name: "To Do", order: 0, isDoneColumn: false },
        { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", project: "p1", name: "Done", order: 1, isDoneColumn: true },
      ],
    });
    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await PATCH(fakeReq({ isDoneColumn: false }), { params: { id: "p1", columnId: "bbbbbbbbbbbbbbbbbbbbbbbb" } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(world.committed.get("bbbbbbbbbbbbbbbbbbbbbbbb").isDoneColumn, false);
    assert.strictEqual(world.committed.get("aaaaaaaaaaaaaaaaaaaaaaaa").isDoneColumn, false);
    const doneCount = [...world.committed.values()].filter((c) => c.isDoneColumn).length;
    assert.strictEqual(doneCount, 0); // zero done columns is a valid state
  });

  await test("if clearing the other columns fails, the save is rolled back too — never left with two done columns or a half-applied write", async () => {
    const world = setupMocks({
      columns: [
        { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", project: "p1", name: "To Do", order: 0, isDoneColumn: false },
        { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", project: "p1", name: "Done", order: 1, isDoneColumn: true },
      ],
      updateManyShouldFail: true,
    });
    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await PATCH(fakeReq({ isDoneColumn: true }), { params: { id: "p1", columnId: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
    // The route maps the failure to a generic 500 via withMongoErrorHandling.
    assert.strictEqual(res.status, 500);
    // Critically: aaaaaaaaaaaaaaaaaaaaaaaa's isDoneColumn:true was NEVER committed, because it
    // shared a transaction with the failed updateMany. Before this fix,
    // these were two separate writes and aaaaaaaaaaaaaaaaaaaaaaaa.save() would have already
    // committed by the time updateMany failed — leaving aaaaaaaaaaaaaaaaaaaaaaaa AND bbbbbbbbbbbbbbbbbbbbbbbb both
    // marked done.
    assert.strictEqual(world.committed.get("aaaaaaaaaaaaaaaaaaaaaaaa").isDoneColumn, false);
    assert.strictEqual(world.committed.get("bbbbbbbbbbbbbbbbbbbbbbbb").isDoneColumn, true);
    const doneCount = [...world.committed.values()].filter((c) => c.isDoneColumn).length;
    assert.strictEqual(doneCount, 1); // still exactly one — the pre-existing one
  });

  await test("repeated toggling never accumulates more than one done column", async () => {
    const world = setupMocks({
      columns: [
        { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", project: "p1", name: "A", order: 0, isDoneColumn: false },
        { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", project: "p1", name: "B", order: 1, isDoneColumn: false },
        { _id: "cccccccccccccccccccccccc", project: "p1", name: "C", order: 2, isDoneColumn: false },
      ],
    });
    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const sequence = [
      ["aaaaaaaaaaaaaaaaaaaaaaaa", true],
      ["bbbbbbbbbbbbbbbbbbbbbbbb", true],
      ["cccccccccccccccccccccccc", true],
      ["bbbbbbbbbbbbbbbbbbbbbbbb", true],
      ["aaaaaaaaaaaaaaaaaaaaaaaa", false],
    ];
    for (const [columnId, isDoneColumn] of sequence) {
      const res = await PATCH(fakeReq({ isDoneColumn }), { params: { id: "p1", columnId } });
      assert.strictEqual(res.status, 200);
      const doneCount = [...world.committed.values()].filter((c) => c.isDoneColumn).length;
      assert.ok(doneCount <= 1, `expected at most one done column after toggling ${columnId}, got ${doneCount}`);
    }
    assert.strictEqual(world.committed.get("bbbbbbbbbbbbbbbbbbbbbbbb").isDoneColumn, true);
  });

  await test("update survives a driver-level retry of the transaction callback (findOneAndUpdate, not a stale document.save())", async () => {
    const world = setupMocks({
      columns: [
        { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", project: "p1", name: "A", order: 0, isDoneColumn: false },
        { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", project: "p1", name: "B", order: 1, isDoneColumn: true },
      ],
    });
    // Simulates the real MongoDB driver's behavior: session.withTransaction()
    // catches a transient write-conflict error from inside the callback and
    // re-invokes the *entire* callback from scratch before finally
    // committing — which is exactly what happens in the two-different-
    // columns race this fix targets. The first invocation's write is
    // discarded entirely (as if it never happened); only the second
    // invocation's writes should end up committed.
    let callbackInvocations = 0;
    const realFindOneAndUpdate = world.ColumnModel.findOneAndUpdate;
    world.ColumnModel.findOneAndUpdate = async (...args) => {
      callbackInvocations++;
      if (callbackInvocations === 1) {
        throw Object.assign(new Error("WriteConflict"), { errorLabels: ["TransientTransactionError"] });
      }
      return realFindOneAndUpdate(...args);
    };
    const realStartSession = world.mongooseMock.startSession;
    world.mongooseMock.startSession = async () => {
      const session = await realStartSession();
      const realWithTransaction = session.withTransaction;
      session.withTransaction = async (fn) => {
        try {
          await realWithTransaction(fn);
        } catch (err) {
          if (!err.errorLabels?.includes("TransientTransactionError")) throw err;
          await realWithTransaction(fn); // driver's own automatic retry
        }
      };
      return session;
    };
    const realMongoose = require("mongoose");
    mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await PATCH(fakeReq({ isDoneColumn: true }), { params: { id: "p1", columnId: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(callbackInvocations, 2);
    assert.strictEqual(world.committed.get("aaaaaaaaaaaaaaaaaaaaaaaa").isDoneColumn, true);
    assert.strictEqual(world.committed.get("bbbbbbbbbbbbbbbbbbbbbbbb").isDoneColumn, false);
  });

  summary();
})();
