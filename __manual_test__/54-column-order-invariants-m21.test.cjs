// M21 - column ordering invariants. PATCH /api/projects/[id]/columns/[columnId]
// used to accept a raw `order`, bypassing the dedicated reorder endpoint:
// it could collide with a sibling under the unique (project, order) index
// or leave gaps. Position is now written only by creation (max + 1) and
// by PATCH .../columns/order (whole sequence, 0..n-1).
//
// The in-memory Column store ENFORCES the unique (project, order) index on
// create/update/bulkWrite, but rows seeded as "legacy" bypass it (that is
// how duplicates could exist in a database where the index never built).

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

const ID = (n) => String(n).padStart(24, "0");
const MANAGER = "u_manager";
const STAMP = (d) => new Date(2026, 0, d);

function makeStore(initial, { indexBuilt = true } = {}) {
  let rows = initial.map((c) => ({ createdAt: STAMP(1), ...c }));
  // indexBuilt=false models a legacy database where the unique index could
  // not be created because duplicate orders already existed.
  const dup = (list) => {
    if (!indexBuilt) return false;
    const seen = new Set();
    for (const r of list) {
      const k = `${r.project}:${r.order}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };
  const e11000 = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
  let nextId = 100;
  const chain = (out) => {
    const c = {
      sort: (s) => { out = [...out].sort((a, b) => (s.order === -1 ? b.order - a.order : a.order - b.order) || a.createdAt - b.createdAt || a._id.localeCompare(b._id)); return c; },
      session: () => c,
      lean: async () => out.map((r) => ({ ...r })),
      _sorted: () => out,
    };
    return c;
  };
  return {
    get rows() { return rows; },
    model: {
      find: (f) => chain(rows.filter((r) => r.project === f.project)),
      findOne: (f) => {
        let hit = rows.filter((r) => r.project === f.project && (f._id === undefined || r._id === String(f._id)));
        const c = {
          sort: (sp) => { hit = chain(hit).sort(sp)._sorted(); return c; },
          session: () => c,
          lean: async () => (hit[0] ? { ...hit[0] } : null),
        };
        return c;
      },
      findOneAndUpdate: async (f, update) => {
        const idx = rows.findIndex((r) => r._id === String(f._id) && r.project === f.project);
        if (idx < 0) return null;
        const next = rows.map((r, i) => (i === idx ? { ...r, ...update.$set } : r));
        if (dup(next)) throw e11000();
        rows = next;
        return { ...rows[idx] };
      },
      create: async (doc) => {
        const row = { _id: ID(nextId++), createdAt: STAMP(2), ...doc };
        if (dup([...rows, row])) throw e11000();
        rows = [...rows, row];
        return { ...row };
      },
      bulkWrite: async (ops) => {
        for (const op of ops) {
          const { filter, update } = op.updateOne;
          const next = rows.map((r) => (r._id === String(filter._id) && r.project === filter.project ? { ...r, ...update.$set } : r));
          if (dup(next)) throw e11000();
          rows = next;
        }
      },
      deleteOne: async () => {},
    },
    snapshot: () => rows.map((r) => ({ ...r })),
    restore: (s) => { rows = s; },
  };
}

function setup(columns, opts) {
  resetModuleCache();
  const store = makeStore(columns, opts);
  const realMongoose = require("mongoose");
  mockModule("mongoose", {
    ...realMongoose,
    startSession: async () => {
      const session = {};
      session.withTransaction = async (fn) => {
        const snap = store.snapshot();
        try { await fn(); } catch (e) { store.restore(snap); throw e; }
      };
      session.endSession = async () => {};
      return session;
    },
  });
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  const proj = { _id: "p1", manager: MANAGER, editingMode: "everyone", editors: [] };
  const realAuthz = require("../src/lib/authz.js");
  mockModule("@/lib/authz", {
    canEditProject: realAuthz.canEditProject,
    getAccessibleProject: async (pid) => (pid === "p1" ? proj : null),
  });
  mockModule("@/models/Column", store.model);
  mockModule("@/models/Task", { countDocuments: () => ({ session: async () => 0 }) });
  return store;
}

const req = (body) => ({ json: async () => body, headers: new Headers() });
const patchColumn = (columnId, body) =>
  require("../src/app/api/projects/[id]/columns/[columnId]/route.js").PATCH(req(body), { params: Promise.resolve({ id: "p1", columnId }) });
const reorder = (columnOrder) =>
  require("../src/app/api/projects/[id]/columns/order/route.js").PATCH(req({ columnOrder }), { params: Promise.resolve({ id: "p1" }) });
const create = (name) =>
  require("../src/app/api/projects/[id]/columns/route.js").POST(req({ name }), { params: Promise.resolve({ id: "p1" }) });
const four = () => [
  { _id: ID(1), project: "p1", name: "To Do", order: 0 },
  { _id: ID(2), project: "p1", name: "In Progress", order: 1 },
  { _id: ID(3), project: "p1", name: "Review", order: 2 },
  { _id: ID(4), project: "p1", name: "Shipped", order: 3 },
];
const orders = (store) => store.rows.map((r) => `${r.name}=${r.order}`).join(",");
const inSeq = (store) => [...store.rows].sort((a, b) => a.order - b.order).map((r) => r._id);

(async () => {
  await test("PATCH with `order` is rejected (400) and changes nothing - including a value that would collide with a sibling", async () => {
    const store = setup(four());
    const before = orders(store);
    for (const order of [0, 1, 2, 99, -1, "3", null, 1.5]) {
      const res = await patchColumn(ID(2), { order });
      assert.strictEqual(res.status, 400, `order=${JSON.stringify(order)}`);
      assert.match((await res.json()).error, /columns\/order/);
    }
    assert.strictEqual(orders(store), before);
  });

  await test("PATCH with name + order together is rejected as a whole (the name is not applied either)", async () => {
    const store = setup(four());
    const res = await patchColumn(ID(2), { name: "Renamed", order: 0 });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(store.rows.find((r) => r._id === ID(2)).name, "In Progress");
  });

  await test("renaming still works, returns the column, and leaves every order value alone", async () => {
    const store = setup(four());
    const before = store.rows.map((r) => r.order);
    const res = await patchColumn(ID(2), { name: "  Doing  " });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.name, "Doing");
    assert.strictEqual(body.order, 1);
    assert.deepStrictEqual(store.rows.map((r) => r.order), before);
  });

  await test("rename validation is unchanged (empty, too long, wrong type, missing/foreign column, unknown id)", async () => {
    const store = setup(four());
    assert.strictEqual((await patchColumn(ID(1), { name: "   " })).status, 400);
    assert.strictEqual((await patchColumn(ID(1), { name: "x".repeat(61) })).status, 400);
    assert.strictEqual((await patchColumn(ID(1), { name: 5 })).status, 400);
    assert.strictEqual((await patchColumn(ID(77), { name: "Nope" })).status, 404);
    assert.strictEqual((await patchColumn("not-an-id", { name: "Nope" })).status, 404);
    assert.strictEqual(store.rows[0].name, "To Do");
  });

  await test("creating columns still appends at max+1 and survives a concurrent-insert collision (retry)", async () => {
    const store = setup(four());
    const res = await create("Backlog");
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await res.json()).order, 4);
    // Simulate a racing insert: the first max-read is stale, create hits the unique index, retry succeeds.
    const realFindOne = store.model.findOne;
    let first = true;
    store.model.findOne = (f) => {
      if (first) { first = false; return { sort: () => ({ lean: async () => ({ order: 3 }) }) }; } // stale max
      return realFindOne(f);
    };
    const res2 = await create("Another");
    assert.strictEqual(res2.status, 201);
    assert.strictEqual((await res2.json()).order, 5);
  });

  await test("reordering still works and writes a clean 0..n-1 sequence", async () => {
    const store = setup(four());
    const res = await reorder([ID(4), ID(1), ID(3), ID(2)]);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(inSeq(store), [ID(4), ID(1), ID(3), ID(2)]);
    assert.deepStrictEqual(store.rows.map((r) => r.order).sort((a, b) => a - b), [0, 1, 2, 3]);
    assert.deepStrictEqual((await res.json()).columns.map((c) => c.id), [ID(4), ID(1), ID(3), ID(2)]);
  });

  await test("after a create, a delete-style gap and a reorder, orders are unique and contiguous again", async () => {
    const store = setup([
      { _id: ID(1), project: "p1", name: "A", order: 0 },
      { _id: ID(2), project: "p1", name: "B", order: 5 }, // gap left by earlier deletes
      { _id: ID(3), project: "p1", name: "C", order: 9 },
    ]);
    assert.strictEqual((await reorder([ID(3), ID(1), ID(2)])).status, 200);
    assert.deepStrictEqual(store.rows.map((r) => r.order).sort((a, b) => a - b), [0, 1, 2]);
  });

  await test("legacy duplicates: reads break ties deterministically (createdAt, then _id), same result every time", () => {
    const { compareColumns } = require("../src/lib/columnOrderCompare.js");
    const legacy = [
      { _id: ID(3), order: 1, createdAt: STAMP(5) },
      { _id: ID(2), order: 1, createdAt: STAMP(3) },
      { _id: ID(1), order: 1, createdAt: STAMP(3) },
      { _id: ID(4), order: 0, createdAt: STAMP(9) },
    ];
    const expected = [ID(4), ID(1), ID(2), ID(3)];
    for (let i = 0; i < 20; i++) {
      const shuffled = [...legacy].sort(() => Math.random() - 0.5);
      assert.deepStrictEqual(shuffled.sort(compareColumns).map((c) => c._id), expected);
    }
  });

  await test("legacy duplicates: the reorder endpoint repairs them into a unique 0..n-1 sequence in the requested order", async () => {
    const store = setup([
      { _id: ID(1), project: "p1", name: "A", order: 2, createdAt: STAMP(1) },
      { _id: ID(2), project: "p1", name: "B", order: 2, createdAt: STAMP(2) }, // duplicate order (legacy)
      { _id: ID(3), project: "p1", name: "C", order: 2, createdAt: STAMP(3) }, // triple
      { _id: ID(4), project: "p1", name: "D", order: 0, createdAt: STAMP(4) },
    ], { indexBuilt: false });
    // Same sequence the board is showing: no-op reorders must still repair it.
    const res = await reorder([ID(4), ID(1), ID(2), ID(3)]);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(inSeq(store), [ID(4), ID(1), ID(2), ID(3)]);
    assert.deepStrictEqual(store.rows.map((r) => r.order).sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  await test("legacy duplicates: renaming a column in such a board still works and creates no new conflicts", async () => {
    const store = setup([
      { _id: ID(1), project: "p1", name: "A", order: 1 },
      { _id: ID(2), project: "p1", name: "B", order: 1 },
    ], { indexBuilt: false });
    const res = await patchColumn(ID(2), { name: "B2" });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(store.rows.map((r) => r.order), [1, 1]); // untouched; reorder is the repair path
  });

  await test("reorder rollback: a failure mid-way leaves the original order intact (transaction)", async () => {
    const store = setup(four());
    const orig = store.model.bulkWrite;
    let n = 0;
    store.model.bulkWrite = async (ops, o) => { if (++n === 2) throw new Error("boom"); return orig(ops, o); };
    const log = console.error;
    console.error = () => {}; // the route logs the unexpected error; keep test output clean
    let res;
    try { res = await reorder([ID(4), ID(3), ID(2), ID(1)]); } finally { console.error = log; }
    assert.strictEqual(res.status, 500, "an unexpected failure must not look like success");
    assert.deepStrictEqual(store.rows.map((r) => r.order), [0, 1, 2, 3]);
  });

  await test("the unique (project, order) index is still declared on the Column schema, and the client never sends `order` to the PATCH route", () => {
    const fs = require("fs");
    const path = require("path");
    const model = fs.readFileSync(path.join(__dirname, "../src/models/Column.js"), "utf8");
    assert.match(model, /index\(\{ project: 1, order: 1 \}, \{ unique: true \}\)/);
    const board = fs.readFileSync(path.join(__dirname, "../src/components/KanbanBoard.jsx"), "utf8");
    assert.ok(!/body: JSON\.stringify\(\{[^}]*order/.test(board), "KanbanBoard must not send order to the column PATCH route");
  });

  summary();
})();
