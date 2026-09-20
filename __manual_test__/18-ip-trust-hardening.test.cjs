require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// Final Release Cleanup phase — IP-based rate-limit trust and deployment
// safety (see FINAL_RELEASE_CLEANUP.md). Covers:
//   - src/lib/clientIp.js         (RATE_LIMIT_TRUST_PROXY gating, IP shape
//                                   validation, spoofed/malformed headers)
//   - src/app/api/auth/register/route.js (the no-ip-fallback bucket that
//                                   keeps registration rate-limited even
//                                   when the IP can't be trusted)
//
// Same style as the rest of __manual_test__: real, unmodified source
// loaded via @babel/register, with only Mongoose models swapped for
// in-memory fakes. See fakeRateLimitModel.cjs for what the rate-limit
// fake does and doesn't prove.

function fakeReq(body, headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    json: async () => body,
    headers: { get: (name) => lowered[name.toLowerCase()] ?? null },
  };
}

// Awaits `fn()` before restoring the environment variable — important
// because several callers below pass an async fn whose POST calls must
// all run while RATE_LIMIT_TRUST_PROXY is still set. Returning the bare
// (unawaited) promise from a `finally`-wrapped function would restore the
// env var before the async work inside `fn` actually executes.
async function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

(async () => {
  console.log("clientIp.js — trust boundary and header validation");

  await test("trusts a well-formed x-forwarded-for by default (RATE_LIMIT_TRUST_PROXY unset ~ 'vercel')", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", undefined, () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const ip = getClientIp(fakeReq({}, { "x-forwarded-for": "203.0.113.5" }).headers);
      assert.strictEqual(ip, "203.0.113.5");
    });
  });

  await test("takes the leftmost address in a multi-hop x-forwarded-for chain", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const ip = getClientIp(fakeReq({}, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }).headers);
      assert.strictEqual(ip, "203.0.113.9");
    });
  });

  await test("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const ip = getClientIp(fakeReq({}, { "x-real-ip": "198.51.100.7" }).headers);
      assert.strictEqual(ip, "198.51.100.7");
    });
  });

  await test("returns 'unknown' when neither header is present", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      assert.strictEqual(getClientIp(fakeReq({}, {}).headers), "unknown");
    });
  });

  await test("rejects a malformed x-forwarded-for value instead of using it as a rate-limit key", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const malformed = ["'; DROP TABLE users; --", "<script>alert(1)</script>", "not-an-ip", "999.999.999.999"];
      for (const value of malformed) {
        assert.strictEqual(getClientIp(fakeReq({}, { "x-forwarded-for": value }).headers), "unknown", `should reject: ${value}`);
      }
    });
  });

  await test("accepts a plausible IPv6 address", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const ip = getClientIp(fakeReq({}, { "x-forwarded-for": "2001:db8::1" }).headers);
      assert.strictEqual(ip, "2001:db8::1");
    });
  });

  await test("RATE_LIMIT_TRUST_PROXY=none ignores forwarding headers entirely, even a well-formed one", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const ip = getClientIp(fakeReq({}, { "x-forwarded-for": "203.0.113.5" }).headers);
      assert.strictEqual(ip, "unknown");
    });
  });

  await test("two different spoofed x-forwarded-for values from the same real caller cannot be told apart under trust=none — this is the documented limitation, not a false negative", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", () => {
      resetModuleCache();
      const { getClientIp } = require("../src/lib/clientIp.js");
      const a = getClientIp(fakeReq({}, { "x-forwarded-for": "1.2.3.4" }).headers);
      const b = getClientIp(fakeReq({}, { "x-forwarded-for": "5.6.7.8" }).headers);
      assert.strictEqual(a, "unknown");
      assert.strictEqual(a, b);
    });
  });

  console.log("\nregister/route.js — rate limiting stays enforced when the IP can't be trusted");

  function setupRegisterMocks() {
    resetModuleCache();
    const rateLimitModel = makeFakeRateLimitModel();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rateLimitModel);
    const users = new Map();
    let counter = 0;
    mockModule("mongoose", {
      ...require("mongoose"),
      startSession: async () => ({
        withTransaction: async (fn) => {
          await fn();
        },
        endSession: async () => {},
      }),
    });
    mockModule("@/models/User", {
      findOne: ({ email }) => ({ lean: async () => (users.has(email) ? { ...users.get(email) } : null) }),
      create: async ([doc]) => {
        const created = { _id: `user_${++counter}`, tokenVersion: 0, ...doc };
        users.set(created.email, created);
        return [created];
      },
    });
    mockModule("@/models/Team", { updateMany: async () => {} });
    mockModule("@/models/Invitation", {
      find: () => ({ session: () => ({ lean: async () => [] }) }),
      deleteMany: async () => {},
    });
    mockModule("@/lib/verificationToken", { createVerificationToken: () => "fake.jwt.token" });
    mockModule("@/lib/email", { sendVerificationEmail: async () => ({ sent: true }) });
    return { rateLimitModel };
  }

  function registerBody(email) {
    return { name: "Test User", email, password: "correct-horse" };
  }

  await test("with a trusted, present IP, two different IPs each get their own bucket (baseline, unchanged)", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", async () => {
      setupRegisterMocks();
      const { POST } = require("../src/app/api/auth/register/route.js");
      const a = await POST(fakeReq(registerBody("a@example.com"), { "x-forwarded-for": "203.0.113.11" }));
      const b = await POST(fakeReq(registerBody("b@example.com"), { "x-forwarded-for": "203.0.113.12" }));
      assert.strictEqual(a.status, 201);
      assert.strictEqual(b.status, 201);
    });
  });

  await test("RATE_LIMIT_TRUST_PROXY=none: registration is still rate-limited via the shared no-ip-fallback bucket, not left uncapped", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", async () => {
      setupRegisterMocks();
      const { POST } = require("../src/app/api/auth/register/route.js");
      // REGISTER_FALLBACK_LIMIT.max is 100 (src/app/api/auth/register/route.js).
      for (let i = 0; i < 100; i++) {
        const res = await POST(fakeReq(registerBody(`bulk-${i}@example.com`), { "x-forwarded-for": `10.0.0.${i % 255}` }));
        assert.strictEqual(res.status, 201, `attempt ${i + 1} should succeed, not yet rate-limited`);
      }
      const res = await POST(fakeReq(registerBody("bulk-final@example.com"), { "x-forwarded-for": "10.0.0.250" }));
      assert.strictEqual(res.status, 429, "the 101st registration attempt must be rate-limited even though every request claims a different (untrusted) IP");
      assert.ok(res.headers.get("Retry-After"));
    });
  });

  await test("RATE_LIMIT_TRUST_PROXY=none: a real client with no x-forwarded-for at all shares the same fallback bucket as spoofed ones", async () => {
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", async () => {
      setupRegisterMocks();
      const { POST } = require("../src/app/api/auth/register/route.js");
      for (let i = 0; i < 100; i++) {
        await POST(fakeReq(registerBody(`noheader-${i}@example.com`), {}));
      }
      const res = await POST(fakeReq(registerBody("noheader-final@example.com"), {}));
      assert.strictEqual(res.status, 429);
    });
  });

  summary();
})();
