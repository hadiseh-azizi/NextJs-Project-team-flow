require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

function fakeMongooseWithSession(sessionImpl) {
  const endSession = () => Promise.resolve();
  return {
    startSession: async () => ({ withTransaction: sessionImpl, endSession }),
  };
}

(async () => {
  console.log("withOptionalTransaction");

  await test("happy path: runs fn once with a session, returns its result", async () => {
    resetModuleCache();
    let callCount = 0;
    let sawSession = null;
    mockModule("mongoose", fakeMongooseWithSession(async (cb) => {
      callCount++;
      await cb();
    }));
    const { withOptionalTransaction } = require("../src/lib/mongoTransaction.js");
    const result = await withOptionalTransaction(async (session) => {
      sawSession = session;
      return "ok";
    });
    assert.strictEqual(result, "ok");
    assert.strictEqual(callCount, 1);
    assert.notStrictEqual(sawSession, undefined);
  });

  await test("a callback that throws propagates the error (no silent partial success)", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseWithSession(async (cb) => {
      await cb(); // withTransaction lets the callback's throw abort the transaction
    }));
    const { withOptionalTransaction } = require("../src/lib/mongoTransaction.js");
    await assert.rejects(
      withOptionalTransaction(async () => {
        throw new Error("updateMany failed");
      }),
      /updateMany failed/
    );
  });

  await test("driver-level retry: when withTransaction re-invokes the callback, the returned result is from the successful call", async () => {
    resetModuleCache();
    let executions = 0;
    mockModule("mongoose", fakeMongooseWithSession(async (cb) => {
      // Simulates the real MongoDB driver's own retry-on-transient-error
      // loop inside session.withTransaction() — e.g. two transactions
      // both touching the same done-column race and one losing a write
      // conflict, then being retried automatically by the driver until
      // it succeeds.
      executions++;
      await cb();
    }));
    const { withOptionalTransaction } = require("../src/lib/mongoTransaction.js");
    const result = await withOptionalTransaction(async () => `attempt-${executions}`);
    assert.strictEqual(result, "attempt-1");
  });

  await test("falls back to fn(null) when the server doesn't support transactions", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseWithSession(async () => {
      throw new Error("Transaction numbers are only allowed on a replica set member or mongos");
    }));
    const { withOptionalTransaction } = require("../src/lib/mongoTransaction.js");
    const result = await withOptionalTransaction(async (session) => {
      assert.strictEqual(session, null);
      return "ran-without-session";
    });
    assert.strictEqual(result, "ran-without-session");
  });

  await test("an unrelated error is NOT swallowed by the fallback path", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseWithSession(async () => {
      throw new Error("some other unrelated failure");
    }));
    const { withOptionalTransaction } = require("../src/lib/mongoTransaction.js");
    await assert.rejects(withOptionalTransaction(async () => "unreachable"), /some other unrelated failure/);
  });

  summary();
})();
