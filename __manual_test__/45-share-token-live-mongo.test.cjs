require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Real-MongoDB verification for audit issue C1 — the unique sparse index
// on Project.shareToken. The in-memory fakes used elsewhere cannot
// reproduce index behavior, so this file talks to an actual mongod.
//
// Needs ONE of:
//   MONGODB_TEST_URI=mongodb://127.0.0.1:27017   (any mongod / Atlas; a
//     throwaway database named teamflow_c1_<random> is created and dropped)
//   or a mongod binary that mongodb-memory-server can download/run.
// With neither, it prints SKIPPED and exits 0 WITHOUT having verified
// anything — a skipped run is not a pass.

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const fakeReq = () => ({ headers: { get: () => null } });

async function acquireMongo() {
  if (process.env.MONGODB_TEST_URI) return { uri: process.env.MONGODB_TEST_URI, stop: async () => {} };
  try {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    // Bounded: without network access the binary download retries for a long
    // time, which would stall the whole suite instead of skipping.
    const server = await Promise.race([
      MongoMemoryServer.create(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out fetching/starting mongod (20s)")), 20000)),
    ]);
    return { uri: server.getUri(), stop: () => server.stop() };
  } catch (err) {
    return { error: err };
  }
}

(async () => {
  const mongo = await acquireMongo();
  if (mongo.error) {
    console.log("SKIPPED: no live MongoDB available (set MONGODB_TEST_URI, or allow mongodb-memory-server to fetch mongod).");
    console.log(`  reason: ${String(mongo.error.message).split("\n")[0]}`);
    console.log("  NOTE: nothing was verified against a real index.");
    process.exit(0); // the aborted download can leave retry timers alive
  }

  resetModuleCache();
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  const mongoose = require("mongoose");
  const dbName = `teamflow_c1_${Math.random().toString(36).slice(2, 10)}`;
  await mongoose.connect(mongo.uri, { dbName });

  try {
    const mod = require("../src/models/Project.js");
    const Project = mod.default || mod;
    const route = require("../src/app/api/projects/[id]/share/route.js");
    const { migrate } = require("../scripts/migrations/001-unset-null-share-token.cjs");
    const raw = mongoose.connection.collection("projects");
    const mk = (name, extra = {}) => Project.create({ name, manager: MANAGER_ID, team: MANAGER_ID, members: [], ...extra });
    const ctxFor = (p) => ({ params: Promise.resolve({ id: String(p._id) }) });
    const stored = (p) => raw.findOne({ _id: p._id });

    await Project.init();
    await Project.syncIndexes(); // drops any stale/conflicting index, builds the declared one

    console.log("index definition on the real collection");
    await test("exactly one shareToken index, unique + sparse, no partial filter", async () => {
      const idx = (await raw.indexes()).filter((i) => i.key.shareToken === 1);
      assert.strictEqual(idx.length, 1);
      assert.strictEqual(idx[0].unique, true);
      assert.strictEqual(idx[0].sparse, true);
      assert.ok(!idx[0].partialFilterExpression);
    });

    console.log("\ncreation without sharing");
    const made = [];
    await test("Projects A, B, C can all be created without a share token", async () => {
      for (const n of ["A", "B", "C"]) made.push(await mk(n));
      assert.strictEqual(made.length, 3);
    });
    await test("the stored documents have no shareToken field (not null)", async () => {
      for (const p of made) assert.ok(!("shareToken" in (await stored(p))));
    });

    console.log("\nuniqueness of real tokens");
    await test("distinct tokens are allowed; a duplicate real token is rejected with E11000", async () => {
      await Project.updateOne({ _id: made[0]._id }, { $set: { shareEnabled: true, shareToken: "abc" } });
      await Project.updateOne({ _id: made[1]._id }, { $set: { shareEnabled: true, shareToken: "xyz" } });
      await assert.rejects(
        Project.updateOne({ _id: made[2]._id }, { $set: { shareEnabled: true, shareToken: "abc" } }),
        (e) => e.code === 11000
      );
    });

    console.log("\nshare route against the real model + index");
    await test("disabling two shared projects both succeed and both end with the field removed", async () => {
      await route.DELETE(fakeReq(), ctxFor(made[0]));
      const res = await route.DELETE(fakeReq(), ctxFor(made[1]));
      assert.strictEqual(res.status, 200);
      for (const p of [made[0], made[1]]) {
        const d = await stored(p);
        assert.ok(!("shareToken" in d), "field should be removed");
        assert.strictEqual(d.shareEnabled, false);
      }
    });
    await test("re-enabling issues valid unique tokens for several projects", async () => {
      const tokens = [];
      for (const p of made) {
        const res = await route.POST(fakeReq(), ctxFor(p));
        assert.strictEqual(res.status, 200);
        tokens.push((await stored(p)).shareToken);
      }
      assert.ok(tokens.every((t) => typeof t === "string" && t.length >= 32));
      assert.strictEqual(new Set(tokens).size, tokens.length);
    });

    console.log("\nlegacy null data: reproduce, migrate, verify");
    await test("two explicit nulls DO collide on the real index (reproduces the audit finding)", async () => {
      await raw.deleteMany({});
      await raw.insertOne({ name: "legacy1", manager: MANAGER_ID, team: MANAGER_ID, shareEnabled: false, shareToken: null });
      await assert.rejects(
        raw.insertOne({ name: "legacy2", manager: MANAGER_ID, team: MANAGER_ID, shareEnabled: false, shareToken: null }),
        (e) => e.code === 11000
      );
    });
    await test("migration converts null to absent, leaves valid tokens alone, is idempotent", async () => {
      await raw.insertOne({ name: "shared", shareEnabled: true, shareToken: "keep-me" });
      await raw.insertOne({ name: "never shared" });
      const dry = await migrate(raw, { apply: false });
      assert.strictEqual(dry.nullBefore, 1);
      assert.strictEqual(await raw.countDocuments({ shareToken: { $type: "null" } }), 1);
      const r = await migrate(raw, { apply: true });
      assert.ok(r.ok && r.index.ok);
      assert.strictEqual(r.modified, 1);
      assert.strictEqual((await raw.findOne({ name: "shared" })).shareToken, "keep-me");
      assert.ok(!("shareToken" in (await raw.findOne({ name: "legacy1" }))));
      assert.strictEqual((await migrate(raw, { apply: true })).modified, 0);
    });
    await test("after migration, new unshared Projects can be created freely", async () => {
      await mk("post-migration 1");
      await mk("post-migration 2");
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await mongo.stop();
  }
  summary();
})();
