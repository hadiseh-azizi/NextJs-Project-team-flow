require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// Exercises src/lib/rateLimit.js in isolation: fixed-window counting,
// window reset once `expiresAt` has passed, the duplicate-key-on-upsert
// retry path, and fail-open behavior when the "database" errors.
//
// What this does and doesn't prove: see the header comment in
// fakeRateLimitModel.cjs. In short, this proves the pipeline's own logic
// is correct for every state it can see, and that checkRateLimit()'s
// surrounding control flow (upsert options, one retry on a duplicate-key
// error, failing open on any other error) is wired correctly. It does
// NOT prove MongoDB actually executes concurrent findOneAndUpdate calls
// against the same document with the atomicity this design depends on —
// that's a property of MongoDB itself, not something a sandboxed unit
// test can independently verify without a live server. See
// CHANGELOG.md for this phase's manual test note.

function setupMocks() {
  resetModuleCache();
  const fakeModel = makeFakeRateLimitModel();
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/models/RateLimitAttempt", fakeModel);
  return fakeModel;
}

(async () => {
  console.log("rateLimit.js — atomic fixed-window limiter");

  await test("first attempt for a new key is never limited", async () => {
    setupMocks();
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    const result = await checkRateLimit("test:a", { max: 3, windowMs: 60000 });
    assert.strictEqual(result.limited, false);
    assert.strictEqual(result.remaining, 2);
  });

  await test("stays unlimited exactly through the max-th attempt", async () => {
    setupMocks();
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    let last;
    for (let i = 0; i < 3; i++) last = await checkRateLimit("test:b", { max: 3, windowMs: 60000 });
    assert.strictEqual(last.limited, false);
    assert.strictEqual(last.remaining, 0);
  });

  await test("the attempt after max is limited, with a positive retryAfterMs", async () => {
    setupMocks();
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    for (let i = 0; i < 3; i++) await checkRateLimit("test:c", { max: 3, windowMs: 60000 });
    const result = await checkRateLimit("test:c", { max: 3, windowMs: 60000 });
    assert.strictEqual(result.limited, true);
    assert.ok(result.retryAfterMs > 0 && result.retryAfterMs <= 60000);
  });

  await test("two independent keys have independent counters", async () => {
    const fakeModel = setupMocks();
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    await checkRateLimit("test:d1", { max: 1, windowMs: 60000 });
    const limited1 = await checkRateLimit("test:d1", { max: 1, windowMs: 60000 });
    const limited2 = await checkRateLimit("test:d2", { max: 1, windowMs: 60000 });
    assert.strictEqual(limited1.limited, true);
    assert.strictEqual(limited2.limited, false);
    assert.strictEqual(fakeModel.__store.size, 2);
  });

  await test("a window that has already passed resets the counter instead of staying limited", async () => {
    const fakeModel = setupMocks();
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    await checkRateLimit("test:e", { max: 1, windowMs: 60000 });
    const limited = await checkRateLimit("test:e", { max: 1, windowMs: 60000 });
    assert.strictEqual(limited.limited, true);
    // Simulate the window having elapsed by backdating the stored expiry,
    // the same effect real time passing would have.
    fakeModel.__store.get("test:e").expiresAt = new Date(Date.now() - 1000);
    const afterReset = await checkRateLimit("test:e", { max: 1, windowMs: 60000 });
    assert.strictEqual(afterReset.limited, false);
    assert.strictEqual(afterReset.remaining, 0);
  });

  await test("a duplicate-key error on first insert is retried once and succeeds", async () => {
    const fakeModel = setupMocks();
    fakeModel.__forceDuplicateOnce("test:f");
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    const result = await checkRateLimit("test:f", { max: 3, windowMs: 60000 });
    assert.strictEqual(result.limited, false);
    assert.strictEqual(result.remaining, 2);
  });

  await test("fails open (does not block) when the underlying check errors repeatedly", async () => {
    const fakeModel = setupMocks();
    fakeModel.__forceError(new Error("simulated connection reset"));
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    const result = await checkRateLimit("test:g", { max: 1, windowMs: 60000 });
    assert.strictEqual(result.limited, false);
  });

  await test("fails open when connectDB itself throws", async () => {
    resetModuleCache();
    mockModule("@/lib/mongodb", {
      connectDB: async () => {
        throw new Error("simulated Atlas outage");
      },
    });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    const result = await checkRateLimit("test:h", { max: 1, windowMs: 60000 });
    assert.strictEqual(result.limited, false);
  });

  await test("rejects invalid max/windowMs arguments rather than silently no-op'ing", async () => {
    setupMocks();
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    await assert.rejects(() => checkRateLimit("test:i", { max: 0, windowMs: 60000 }));
    await assert.rejects(() => checkRateLimit("test:i", { max: 1, windowMs: 0 }));
    await assert.rejects(() => checkRateLimit("", { max: 1, windowMs: 60000 }));
  });

  summary();
})();
