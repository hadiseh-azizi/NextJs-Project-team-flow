require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Audit issue H1 — connectDB() must not cache a rejected connection promise.
// Uses a fake `mongoose.connect`; no live MongoDB needed. Whether Atlas
// actually recovers after a transient outage is NOT covered here.

function load(connectImpl) {
  resetModuleCache();
  delete global._mongoose;
  const calls = [];
  const fake = {
    connect: (...args) => {
      calls.push(args);
      return connectImpl(calls.length, ...args);
    },
  };
  fake.default = fake;
  fake.__esModule = true;
  mockModule("mongoose", fake);
  const { connectDB } = require("../src/lib/mongodb.js");
  return { connectDB, calls };
}

(async () => {
  await test("successful connection is cached and reused", async () => {
    const conn = { ok: true };
    const { connectDB, calls } = load(async () => conn);
    assert.strictEqual(await connectDB(), conn);
    assert.strictEqual(await connectDB(), conn);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(global._mongoose.conn, conn);
  });

  await test("concurrent callers share one in-flight attempt", async () => {
    const { connectDB, calls } = load(() => new Promise((r) => setTimeout(() => r({ ok: 1 }), 20)));
    const [a, b] = await Promise.all([connectDB(), connectDB()]);
    assert.strictEqual(a, b);
    assert.strictEqual(calls.length, 1);
  });

  await test("failed first attempt clears cached.promise and rethrows", async () => {
    const { connectDB } = load(async () => {
      throw new Error("ECONNREFUSED");
    });
    await assert.rejects(connectDB(), /ECONNREFUSED/);
    assert.strictEqual(global._mongoose.promise, null);
    assert.strictEqual(global._mongoose.conn, null);
  });

  await test("next call after a failure makes a fresh attempt and can succeed", async () => {
    const conn = { ok: true };
    const { connectDB, calls } = load(async (n) => {
      if (n === 1) throw new Error("transient");
      return conn;
    });
    await assert.rejects(connectDB(), /transient/);
    assert.strictEqual(await connectDB(), conn);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(global._mongoose.conn, conn);
    assert.strictEqual(await connectDB(), conn);
    assert.strictEqual(calls.length, 2);
  });

  await test("repeated failures each trigger a new attempt (no stale rejection)", async () => {
    const { connectDB, calls } = load(async () => {
      throw new Error("down");
    });
    await assert.rejects(connectDB(), /down/);
    await assert.rejects(connectDB(), /down/);
    assert.strictEqual(calls.length, 2);
  });

  await test("a late failure from an old attempt does not clear a newer pending one", async () => {
    let rejectFirst;
    const { connectDB, calls } = load((n) =>
      n === 1 ? new Promise((_, rej) => (rejectFirst = rej)) : new Promise(() => {})
    );
    const first = connectDB();
    const marker = global._mongoose.promise;
    global._mongoose.promise = null; // simulate a fresh attempt having replaced it
    const newer = Promise.resolve("newer");
    global._mongoose.promise = newer;
    rejectFirst(new Error("late"));
    await assert.rejects(first, /late/);
    assert.strictEqual(global._mongoose.promise, newer);
    assert.ok(marker && calls.length === 1);
  });

  await test("passes serverless options to mongoose.connect", async () => {
    const { connectDB, calls } = load(async () => ({}));
    await connectDB();
    const opts = calls[0][1];
    assert.strictEqual(opts.serverSelectionTimeoutMS, 5000);
    assert.strictEqual(opts.maxPoolSize, 10);
  });

  summary();
})();
