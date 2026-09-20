require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { compareColumns } = require("../src/lib/columnOrderCompare.js");
const { compareTasks } = require("../src/lib/taskOrderCompare.js");
const { computeMovePlan, ORDER_STEP } = require("../src/lib/taskOrdering.js");

(async () => {
  console.log("compareColumns");
  await test("distinct order sorts ascending", () => {
    assert.strictEqual(compareColumns({ order: 5 }, { order: 1 }) > 0, true);
  });
  await test("tied order falls back to createdAt", () => {
    const a = { order: 1, createdAt: "2024-01-02T00:00:00.000Z", _id: "b" };
    const b = { order: 1, createdAt: "2024-01-01T00:00:00.000Z", _id: "a" };
    assert.strictEqual(compareColumns(a, b) > 0, true); // a is newer -> sorts after b
  });
  await test("tied order and createdAt falls back to _id", () => {
    const a = { order: 1, createdAt: "2024-01-01T00:00:00.000Z", _id: "b" };
    const b = { order: 1, createdAt: "2024-01-01T00:00:00.000Z", _id: "a" };
    assert.strictEqual(compareColumns(a, b) > 0, true);
    // Fully tied columns produce a total order regardless of input order.
    const arr = [a, b].sort(compareColumns);
    assert.deepStrictEqual(arr.map((c) => c._id), ["a", "b"]);
  });
  await test("duplicate orders never crash the sort and always produce a total order", () => {
    const cols = [
      { order: 5, createdAt: "2024-01-01T00:00:00.000Z", _id: "x" },
      { order: 5, createdAt: "2024-01-01T00:00:00.000Z", _id: "y" },
      { order: 0, createdAt: "2024-01-01T00:00:00.000Z", _id: "z" },
    ];
    const sortedOnce = [...cols].sort(compareColumns).map((c) => c._id);
    const sortedTwice = [...cols].reverse().sort(compareColumns).map((c) => c._id);
    // Same result regardless of the array's original order — this is
    // exactly the property the raw `a.order - b.order` sort lacked for
    // ties (see Issue 2).
    assert.deepStrictEqual(sortedOnce, sortedTwice);
    assert.deepStrictEqual(sortedOnce, ["z", "x", "y"]);
  });

  console.log("\ncompareTasks (regression — untouched by this phase)");
  await test("tied order falls back to createdAt then id, deterministically", () => {
    const a = { order: 5, createdAt: "2024-01-01T00:00:00.000Z", _id: "b" };
    const b = { order: 5, createdAt: "2024-01-01T00:00:00.000Z", _id: "a" };
    const sorted = [a, b].sort(compareTasks).map((t) => t._id);
    assert.deepStrictEqual(sorted, ["a", "b"]);
  });

  console.log("\ncomputeMovePlan (regression — untouched by this phase)");
  await test("append to empty column", () => {
    const { newOrder, rebalanceOps } = computeMovePlan({ movingId: "t1", siblingsAsc: [], targetIndex: undefined });
    assert.strictEqual(newOrder, ORDER_STEP);
    assert.deepStrictEqual(rebalanceOps, []);
  });
  await test("insert between two neighbors with room", () => {
    const siblings = [
      { _id: "a", order: 1000 },
      { _id: "b", order: 2000 },
    ];
    const { newOrder, rebalanceOps } = computeMovePlan({ movingId: "t1", siblingsAsc: siblings, targetIndex: 1 });
    assert.strictEqual(newOrder, 1500);
    assert.deepStrictEqual(rebalanceOps, []);
  });
  await test("no room between neighbors triggers a full rebalance", () => {
    const siblings = [
      { _id: "a", order: 1000 },
      { _id: "b", order: 1001 },
    ];
    const { newOrder, rebalanceOps } = computeMovePlan({ movingId: "t1", siblingsAsc: siblings, targetIndex: 1 });
    assert.strictEqual(newOrder, 2 * ORDER_STEP);
    assert.deepStrictEqual(rebalanceOps, [
      { id: "a", order: ORDER_STEP },
      { id: "b", order: 3 * ORDER_STEP },
    ]);
  });
  await test("duplicate-order neighbors (a pre-existing tie) also trigger rebalance, not a crash", () => {
    const siblings = [
      { _id: "a", order: 5000 },
      { _id: "b", order: 5000 },
    ];
    const { rebalanceOps } = computeMovePlan({ movingId: "t1", siblingsAsc: siblings, targetIndex: 1 });
    // gap of 0 is < 2, so this self-heals via rebalance exactly like an
    // adjacent-order gap would — confirms the "cosmetic tie" claim in
    // lib/taskOrdering.js actually holds for the rebalance path too.
    assert.strictEqual(rebalanceOps.length, 2);
  });

  summary();
})();
