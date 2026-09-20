require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { resetModuleCache } = require("./mockRequire.cjs");

// In-memory stand-in for the Column collection, faithful enough to
// exercise the real retry logic: `create` enforces the same
// (project, order) uniqueness the real MongoDB index does, and throws
// the same shape of error (`code: 11000`) mongoErrors.js and the retry
// loop both key off of.
function makeFakeColumnStore(initialDocs) {
  const docs = [...initialDocs];
  return {
    docs,
    findOne: (filter) => ({
      sort: () => ({
        lean: async () => {
          const matches = docs.filter((d) => d.project === filter.project);
          if (!matches.length) return null;
          return matches.reduce((max, d) => (d.order > max.order ? d : max));
        },
      }),
    }),
    create: async ({ name, project, order }) => {
      const collides = docs.some((d) => d.project === project && d.order === order);
      if (collides) {
        const err = new Error("E11000 duplicate key error collection: teamflow.columns index: project_1_order_1");
        err.code = 11000;
        throw err;
      }
      const doc = { _id: `col_${docs.length + 1}`, name, project, order };
      docs.push(doc);
      return doc;
    },
  };
}

(async () => {
  console.log("createColumnWithNextOrder (Issue 2)");

  await test("no contention: creates at max + 1 on the first attempt", async () => {
    resetModuleCache();
    const store = makeFakeColumnStore([
      { _id: "c1", project: "p1", order: 0 },
      { _id: "c2", project: "p1", order: 1 },
    ]);
    const Column = require("../src/models/Column.js").default;
    const realFindOne = Column.findOne;
    const realCreate = Column.create;
    Column.findOne = store.findOne;
    Column.create = store.create;
    try {
      const { createColumnWithNextOrder } = require("../src/app/api/projects/[id]/columns/route.js");
      const created = await createColumnWithNextOrder({ name: "New", projectId: "p1" });
      assert.strictEqual(created.order, 2);
    } finally {
      Column.findOne = realFindOne;
      Column.create = realCreate;
    }
  });

  await test("concurrent creation: a losing racer retries and lands on a distinct order, never a duplicate", async () => {
    resetModuleCache();
    const store = makeFakeColumnStore([{ _id: "c1", project: "p1", order: 0 }]);
    const Column = require("../src/models/Column.js").default;
    Column.findOne = store.findOne;
    // Simulates request B's insert landing between request A's read of
    // the max and A's own insert — exactly the race Issue 2 describes.
    // The real unique index turns A's insert into a duplicate-key error
    // instead of silently creating a second column at order 1.
    let createCalls = 0;
    Column.create = async (args) => {
      createCalls++;
      if (createCalls === 1) {
        // Racer B "commits" first, taking order 1.
        store.docs.push({ _id: "racer_b", project: "p1", order: 1 });
      }
      return store.create(args);
    };
    try {
      const { createColumnWithNextOrder } = require("../src/app/api/projects/[id]/columns/route.js");
      const created = await createColumnWithNextOrder({ name: "A's column", projectId: "p1" });
      assert.strictEqual(created.order, 2); // retried past the racer's order 1
      const ordersInProject = store.docs.filter((d) => d.project === "p1").map((d) => d.order).sort();
      assert.deepStrictEqual(ordersInProject, [0, 1, 2]); // no duplicate anywhere
    } finally {
      delete Column.findOne;
      delete Column.create;
    }
  });

  await test("persistent collision exhausts retries and rethrows rather than looping forever", async () => {
    resetModuleCache();
    const Column = require("../src/models/Column.js").default;
    let attempts = 0;
    Column.findOne = () => ({ sort: () => ({ lean: async () => ({ order: 0 }) }) });
    Column.create = async () => {
      attempts++;
      const err = new Error("E11000 duplicate key error");
      err.code = 11000;
      throw err;
    };
    try {
      const { createColumnWithNextOrder } = require("../src/app/api/projects/[id]/columns/route.js");
      await assert.rejects(
        createColumnWithNextOrder({ name: "X", projectId: "p1" }),
        (err) => err.code === 11000
      );
      assert.strictEqual(attempts, 5); // MAX_CREATE_ATTEMPTS, not unbounded
    } finally {
      delete Column.findOne;
      delete Column.create;
    }
  });

  await test("a non-collision error is not retried", async () => {
    resetModuleCache();
    const Column = require("../src/models/Column.js").default;
    let attempts = 0;
    Column.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    Column.create = async () => {
      attempts++;
      throw new Error("connection reset");
    };
    try {
      const { createColumnWithNextOrder } = require("../src/app/api/projects/[id]/columns/route.js");
      await assert.rejects(createColumnWithNextOrder({ name: "X", projectId: "p1" }), /connection reset/);
      assert.strictEqual(attempts, 1);
    } finally {
      delete Column.findOne;
      delete Column.create;
    }
  });

  summary();
})();
