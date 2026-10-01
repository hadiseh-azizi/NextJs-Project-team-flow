require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Column drag-and-drop reordering: the pure helpers (validation, plan,
// FLIP geometry) and PATCH /api/projects/[id]/columns/order against an
// in-memory Column store that ENFORCES the real unique (project, order)
// index on every write — so a naive "assign 0..n-1 in one pass" would
// fail here exactly as it would against MongoDB. Not a substitute for
// live Atlas verification (see CHANGELOG.md); no browser is involved.

const ID = (n) => String(n).padStart(24, "0"); // valid ObjectId-shaped ids
const MANAGER = "u_manager";
const EDITOR = "u_editor";
const VIEWER = "u_viewer";

function makeStore(initial) {
  let rows = initial.map((c) => ({ createdAt: new Date(2026, 0, 1), ...c }));
  const violates = (list) => {
    const seen = new Set();
    for (const r of list) {
      const k = `${r.project}:${r.order}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };
  return {
    get rows() { return rows; },
    model: {
      find: (filter) => {
        let out = rows.filter((r) => r.project === filter.project).map((r) => ({ ...r }));
        const chain = {
          sort: () => { out = out.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a._id.localeCompare(b._id)); return chain; },
          session: () => chain,
          lean: async () => out,
        };
        return chain;
      },
      bulkWrite: async (ops) => {
        for (const op of ops) {
          const { filter, update } = op.updateOne;
          const next = rows.map((r) => (r._id === String(filter._id) && r.project === filter.project ? { ...r, ...update.$set } : r));
          if (violates(next)) { const e = new Error("E11000 duplicate key"); e.code = 11000; throw e; }
          rows = next;
        }
      },
    },
    snapshot: () => rows.map((r) => ({ ...r })),
    restore: (s) => { rows = s; },
  };
}

function setup({ columns, user = MANAGER, project, failOnSecondBulk = false }) {
  resetModuleCache();
  const store = makeStore(columns);
  if (failOnSecondBulk) {
    const orig = store.model.bulkWrite;
    let calls = 0;
    store.model.bulkWrite = async (ops, o) => { if (++calls === 2) throw new Error("simulated failure mid-reorder"); return orig(ops, o); };
  }
  const realMongoose = require("mongoose");
  mockModule("mongoose", {
    ...realMongoose,
    startSession: async () => {
      const session = {};
      session.withTransaction = async (fn) => {
        const snap = store.snapshot();
        try { await fn(); } catch (e) { store.restore(snap); throw e; } // rollback
      };
      session.endSession = async () => {};
      return session;
    },
  });
  mockModule("next-auth", { getServerSession: async () => (user ? { user: { id: user } } : null) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  const proj = project || { _id: "p1", manager: MANAGER, editingMode: "everyone", editors: [] };
  const realAuthz = require("../src/lib/authz.js");
  mockModule("@/lib/authz", {
    canEditProject: realAuthz.canEditProject, // the real rule, not a stub
    getAccessibleProject: async (projectId, uid) => (projectId === "p1" && uid !== "u_outsider" ? proj : null),
  });
  mockModule("@/models/Column", store.model);
  return store;
}

const req = (body) => ({ json: async () => body });
const call = async (body) => require("../src/app/api/projects/[id]/columns/order/route.js").PATCH(req(body), { params: { id: "p1" } });
const four = () => [
  { _id: ID(1), project: "p1", name: "To Do", order: 0 },
  { _id: ID(2), project: "p1", name: "In Progress", order: 1 },
  { _id: ID(3), project: "p1", name: "Review", order: 2 },
  { _id: ID(4), project: "p1", name: "Done", order: 3 },
];
const idsInOrder = (store) => store.rows.filter((r) => r.project === "p1").sort((a, b) => a.order - b.order).map((r) => r._id);

(async () => {
  const H = require("../src/lib/columnReorder.js");
  const { isValidObjectId } = require("../src/lib/objectId.js");

  console.log("columnReorder helpers");
  await test("validateColumnOrderPayload accepts unique valid ids, rejects everything else", () => {
    assert.ok(H.validateColumnOrderPayload([ID(1), ID(2)], isValidObjectId).value);
    for (const bad of [undefined, null, "x", {}, [], [ID(1), ID(1)], [ID(1), "nope"], [ID(1), 5], [ID(1), null]]) {
      assert.ok(H.validateColumnOrderPayload(bad, isValidObjectId).error, JSON.stringify(bad));
    }
    assert.ok(H.validateColumnOrderPayload(Array.from({ length: 201 }, (_, i) => ID(i + 1)), isValidObjectId).error);
  });
  await test("planColumnReorder reports foreign and missing ids", () => {
    const cols = four();
    assert.deepStrictEqual(H.planColumnReorder(cols, [ID(1), ID(2), ID(3), ID(9)]).foreign, [ID(9)]);
    assert.deepStrictEqual(H.planColumnReorder(cols, [ID(1), ID(2), ID(3)]).missing, [ID(4)]);
    assert.strictEqual(H.planColumnReorder(cols, [ID(1), ID(2), ID(3), ID(4)]).alreadyNormalized, true);
    assert.strictEqual(H.planColumnReorder(cols, [ID(2), ID(1), ID(3), ID(4)]).alreadyNormalized, false);
  });
  await test("applyColumnOrder never hides a column and ignores unknown ids", () => {
    const cols = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepStrictEqual(H.applyColumnOrder(cols, ["c", "a", "zzz"]).map((c) => c.id), ["c", "a", "b"]);
    assert.deepStrictEqual(H.applyColumnOrder(cols, ["b", "b", "a", "c"]).map((c) => c.id), ["b", "a", "c"]);
  });
  await test("moveItem / nearestSlotIndex / shiftForColumn geometry", () => {
    assert.deepStrictEqual(H.moveItem(["a", "b", "c", "d"], 2, 0), ["c", "a", "b", "d"]);
    assert.deepStrictEqual(H.moveItem(["a", "b", "c", "d"], 0, 3), ["b", "c", "d", "a"]);
    const slots = [0, 1, 2, 3].map((i) => ({ left: i * 300, width: 288 }));
    assert.strictEqual(H.nearestSlotIndex(slots, 10), 0);
    assert.strictEqual(H.nearestSlotIndex(slots, 460), 1);
    assert.strictEqual(H.nearestSlotIndex(slots, 5000), 3);
    // dragging column 2 leftwards over slot 0: columns 0 and 1 slide right one slot, 3 stays
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => H.shiftForColumn(slots, i, 2, 0)), [300, 300, 0, 0]);
    // dragging column 0 rightwards over slot 2: columns 1 and 2 slide left one slot
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => H.shiftForColumn(slots, i, 0, 2)), [0, -300, -300, 0]);
    // hovering own slot: nothing shifts
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => H.shiftForColumn(slots, i, 1, 1)), [0, 0, 0, 0]);
  });

  console.log("PATCH /api/projects/[id]/columns/order");
  await test("Review dragged before To Do: positions become 0..3 in the new sequence (unique index respected)", async () => {
    const store = setup({ columns: four() });
    const res = await call({ columnOrder: [ID(3), ID(1), ID(2), ID(4)] });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(idsInOrder(store), [ID(3), ID(1), ID(2), ID(4)]);
    assert.deepStrictEqual(store.rows.map((r) => r.order).sort(), [0, 1, 2, 3]);
    const body = await res.json();
    assert.deepStrictEqual(body.columns.map((c) => c.id), [ID(3), ID(1), ID(2), ID(4)]);
    // nothing but `order` changed: names and count
    assert.strictEqual(store.rows.length, 4);
    assert.strictEqual(store.rows.find((r) => r._id === ID(3)).name, "Review");
  });
  await test("a column that happens to be named Done reorders like any other (the name carries no meaning)", async () => {
    const store = setup({ columns: four() });
    assert.strictEqual((await call({ columnOrder: [ID(4), ID(1), ID(2), ID(3)] })).status, 200);
    assert.strictEqual(idsInOrder(store)[0], ID(4));
    assert.ok(store.rows.every((r) => !("isDoneColumn" in r)));
  });
  await test("normalizes gaps left by deleted columns (orders 0,5,9 -> 0,1,2)", async () => {
    const store = setup({ columns: [
      { _id: ID(1), project: "p1", name: "A", order: 0 },
      { _id: ID(2), project: "p1", name: "B", order: 5 },
      { _id: ID(3), project: "p1", name: "C", order: 9 },
    ] });
    assert.strictEqual((await call({ columnOrder: [ID(3), ID(2), ID(1)] })).status, 200);
    assert.deepStrictEqual(store.rows.sort((a, b) => a.order - b.order).map((r) => [r._id, r.order]), [[ID(3), 0], [ID(2), 1], [ID(1), 2]]);
  });
  await test("an unchanged, already-normalized order writes nothing", async () => {
    const store = setup({ columns: four() });
    let writes = 0;
    const orig = store.model.bulkWrite;
    store.model.bulkWrite = async (...a) => { writes++; return orig(...a); };
    assert.strictEqual((await call({ columnOrder: [ID(1), ID(2), ID(3), ID(4)] })).status, 200);
    assert.strictEqual(writes, 0);
  });
  await test("a single-column project is fine", async () => {
    setup({ columns: [{ _id: ID(1), project: "p1", name: "Only", order: 0 }] });
    assert.strictEqual((await call({ columnOrder: [ID(1)] })).status, 200);
  });

  console.log("permissions");
  await test("unauthenticated -> 401, no write", async () => {
    const store = setup({ columns: four(), user: null });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3), ID(4)] })).status, 401);
    assert.deepStrictEqual(idsInOrder(store), [ID(1), ID(2), ID(3), ID(4)]);
  });
  await test("user without project access -> 403", async () => {
    const store = setup({ columns: four(), user: "u_outsider" });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3), ID(4)] })).status, 403);
    assert.deepStrictEqual(idsInOrder(store), [ID(1), ID(2), ID(3), ID(4)]);
  });
  const restricted = { _id: "p1", manager: MANAGER, editingMode: "manager_approval", editors: [EDITOR] };
  await test("manager_approval mode: manager and granted editor can reorder", async () => {
    setup({ columns: four(), user: MANAGER, project: restricted });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3), ID(4)] })).status, 200);
    setup({ columns: four(), user: EDITOR, project: restricted });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3), ID(4)] })).status, 200);
  });
  await test("manager_approval mode: a plain member gets 403 and nothing changes", async () => {
    const store = setup({ columns: four(), user: VIEWER, project: restricted });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3), ID(4)] })).status, 403);
    assert.deepStrictEqual(idsInOrder(store), [ID(1), ID(2), ID(3), ID(4)]);
  });
  await test("everyone mode: any member with access can reorder", async () => {
    setup({ columns: four(), user: VIEWER });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3), ID(4)] })).status, 200);
  });

  console.log("validation & data integrity");
  await test("another project's column id -> 400, nothing changes", async () => {
    const store = setup({ columns: [...four(), { _id: ID(50), project: "other", name: "X", order: 0 }] });
    const res = await call({ columnOrder: [ID(50), ID(2), ID(3), ID(4)] });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(idsInOrder(store), [ID(1), ID(2), ID(3), ID(4)]);
    assert.strictEqual(store.rows.find((r) => r._id === ID(50)).order, 0);
  });
  await test("a nonexistent (e.g. just-deleted) column id -> 400", async () => {
    setup({ columns: four() });
    assert.strictEqual((await call({ columnOrder: [ID(1), ID(2), ID(3), ID(99)] })).status, 400);
  });
  await test("omitting a column -> 409 (board changed), nothing changes", async () => {
    const store = setup({ columns: four() });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1), ID(3)] })).status, 409);
    assert.deepStrictEqual(idsInOrder(store), [ID(1), ID(2), ID(3), ID(4)]);
  });
  await test("duplicate ids, malformed ids, wrong types, missing body -> 400", async () => {
    setup({ columns: four() });
    for (const bad of [{ columnOrder: [ID(1), ID(1), ID(3), ID(4)] }, { columnOrder: ["x", ID(2), ID(3), ID(4)] }, { columnOrder: "nope" }, { columnOrder: [] }, {}]) {
      assert.strictEqual((await call(bad)).status, 400, JSON.stringify(bad));
    }
    assert.strictEqual((await require("../src/app/api/projects/[id]/columns/order/route.js").PATCH({ json: async () => { throw new Error("bad json"); } }, { params: { id: "p1" } })).status, 400);
  });
  await test("a failure between the two write passes rolls the whole reorder back", async () => {
    const store = setup({ columns: four(), failOnSecondBulk: true });
    const res = await call({ columnOrder: [ID(3), ID(1), ID(2), ID(4)] });
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(store.rows.map((r) => [r._id, r.order]), [[ID(1), 0], [ID(2), 1], [ID(3), 2], [ID(4), 3]]);
  });
  await test("legacy columns with tied orders still reorder into unique positions", async () => {
    // Can't exist under the unique index, but a pre-index dataset might;
    // the fake store only rejects a tie created *by a write*, so seed the tie directly.
    const store = setup({ columns: [
      { _id: ID(1), project: "p1", name: "A", order: 0, createdAt: new Date(2026, 0, 1) },
      { _id: ID(2), project: "p1", name: "B", order: 0, createdAt: new Date(2026, 0, 2) },
    ] });
    assert.strictEqual((await call({ columnOrder: [ID(2), ID(1)] })).status, 200);
    assert.deepStrictEqual(idsInOrder(store), [ID(2), ID(1)]);
    assert.deepStrictEqual(store.rows.map((r) => r.order).sort(), [0, 1]);
  });

  summary();
})();
