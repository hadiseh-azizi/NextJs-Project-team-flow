require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// This file used to cover the transaction that kept exactly one column
// flagged `isDoneColumn` per project. That concept is gone: every column is
// equal and completion is the task's own flag. The filename is kept so older
// docs that cite it stay valid; the checks below now guard the removal —
// the column PATCH route renames/reorders one column and nothing else, and
// a client that still sends `isDoneColumn` changes nothing.

function makeStore(rows) {
  const committed = new Map(rows.map((c) => [c._id, { ...c }]));
  const calls = { findOneAndUpdate: [], updateMany: 0 };
  const ColumnModel = {
    findOne: ({ _id, project }) => ({
      lean: async () => {
        const d = committed.get(_id);
        return d && d.project === project ? { ...d } : null;
      },
    }),
    findOneAndUpdate: async ({ _id, project }, { $set }, opts = {}) => {
      calls.findOneAndUpdate.push({ _id, $set: { ...$set }, session: opts.session });
      const d = committed.get(_id);
      if (!d || d.project !== project) return null;
      committed.set(_id, { ...d, ...$set });
      return { ...committed.get(_id) };
    },
    updateMany: async () => {
      calls.updateMany += 1;
    },
  };
  return { committed, calls, ColumnModel };
}

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const req = (body) => ({ json: async () => body });

function setup({ columns, canEdit = true }) {
  resetModuleCache();
  const store = makeStore(columns);
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", { canEditProject: () => canEdit, getAccessibleProject: async () => ({ _id: "p1" }) });
  mockModule("@/models/Task", { countDocuments: async () => 0 });
  mockModule("@/models/Column", store.ColumnModel);
  return store;
}
const patch = (body, columnId = A) =>
  require("../src/app/api/projects/[id]/columns/[columnId]/route.js").PATCH(req(body), { params: { id: "p1", columnId } });

(async () => {
  console.log("Column PATCH — all columns are equal (no done column)");

  await test("the Column schema has no isDoneColumn field", () => {
    resetModuleCache();
    const Column = require("../src/models/Column.js").default;
    assert.strictEqual(Column.schema.path("isDoneColumn"), undefined);
  });

  await test("toColumnDTO never exposes isDoneColumn, even for an old document that still stores it", () => {
    const { toColumnDTO } = require("../src/lib/serialize.js");
    const dto = toColumnDTO({ _id: A, name: "Done", order: 2, isDoneColumn: true, createdAt: new Date() });
    assert.ok(!("isDoneColumn" in dto));
    assert.deepStrictEqual(Object.keys(dto).sort(), ["createdAt", "id", "name", "order"]);
  });

  await test("rename changes only that column's name", async () => {
    const s = setup({ columns: [{ _id: A, project: "p1", name: "To Do", order: 0 }, { _id: B, project: "p1", name: "Doing", order: 1 }] });
    const res = await patch({ name: "Backlog" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(s.committed.get(A).name, "Backlog");
    assert.strictEqual(s.committed.get(B).name, "Doing");
    assert.strictEqual(s.calls.updateMany, 0);
  });

  await test("reorder (order field) still works", async () => {
    const s = setup({ columns: [{ _id: A, project: "p1", name: "A", order: 0 }] });
    assert.strictEqual((await patch({ order: 4 })).status, 200);
    assert.strictEqual(s.committed.get(A).order, 4);
  });

  await test("a client still sending isDoneColumn:true changes nothing — not stored, no other column touched", async () => {
    const s = setup({ columns: [{ _id: A, project: "p1", name: "A", order: 0 }, { _id: B, project: "p1", name: "B", order: 1 }] });
    const res = await patch({ isDoneColumn: true });
    assert.strictEqual(res.status, 200);
    assert.ok(!("isDoneColumn" in s.committed.get(A)));
    assert.ok(!("isDoneColumn" in s.committed.get(B)));
    assert.strictEqual(s.calls.updateMany, 0);
    assert.ok(s.calls.findOneAndUpdate.every((c) => !("isDoneColumn" in c.$set)));
  });

  await test("a rename that also carries isDoneColumn applies only the rename", async () => {
    const s = setup({ columns: [{ _id: A, project: "p1", name: "A", order: 0 }] });
    assert.strictEqual((await patch({ name: "Review", isDoneColumn: true })).status, 200);
    assert.deepStrictEqual(s.calls.findOneAndUpdate[0].$set, { name: "Review" });
  });

  await test("the update is a plain single-document write (no transaction needed any more)", async () => {
    const s = setup({ columns: [{ _id: A, project: "p1", name: "A", order: 0 }] });
    await patch({ name: "X" });
    assert.strictEqual(s.calls.findOneAndUpdate.length, 1);
    assert.strictEqual(s.calls.findOneAndUpdate[0].session, undefined);
  });

  await test("a user without edit permission is still refused and nothing changes", async () => {
    const s = setup({ columns: [{ _id: A, project: "p1", name: "A", order: 0 }], canEdit: false });
    assert.strictEqual((await patch({ name: "Hacked" })).status, 403);
    assert.strictEqual(s.committed.get(A).name, "A");
  });

  await test("unknown column / invalid name are still rejected", async () => {
    setup({ columns: [{ _id: A, project: "p1", name: "A", order: 0 }] });
    assert.strictEqual((await patch({ name: "x" }, B)).status, 404);
    assert.strictEqual((await patch({ name: "   " })).status, 400);
  });

  summary();
})();
