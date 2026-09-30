require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");
const jwt = require("jsonwebtoken");

// Exercises this phase's automatic-sign-in-after-email-verification feature:
//   - src/lib/autoLoginToken.js               (issue/consume: single-use,
//     short-lived, hashed-at-rest)
//   - src/app/api/auth/verify-email/route.js  (issues an autoLoginToken on
//     success, best-effort — never fails an already-successful verification)
//   - src/lib/auth.js                         (authorize()'s new
//     autoLoginToken branch, and that the pre-existing email/password
//     branch is untouched)
//
// Same style as the rest of __manual_test__: real, unmodified route/lib
// files loaded via @babel/register, with only Mongoose models and a
// couple of leaf modules swapped for in-memory fakes. See
// fakeRateLimitModel.cjs for what the rate-limit fake does and doesn't
// prove.

function fakeReq(body, headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    json: async () => body,
    headers: { get: (name) => lowered[name.toLowerCase()] ?? null },
  };
}

// Mirrors the plain-object `headers` shape NextAuth passes into
// `authorize(credentials, req)` — see 11-auth-hardening.test.cjs.
function fakeNextAuthReq(headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return { headers: lowered };
}

// In-memory stand-in for the AutoLoginToken collection. create()
// enforces the unique index on tokenHash the same way Mongo would;
// findOneAndDelete() is intentionally atomic-in-spirit (single
// synchronous Map operation) so it can't itself introduce the kind of
// race the real query is written to close.
function makeFakeAutoLoginTokenModel() {
  const store = new Map(); // tokenHash -> doc
  let counter = 0;
  return {
    store,
    async create(doc) {
      if (store.has(doc.tokenHash)) {
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      }
      const created = { _id: `auto_${++counter}`, ...doc };
      store.set(doc.tokenHash, created);
      return created;
    },
    async findOneAndDelete(filter) {
      const doc = store.get(filter.tokenHash);
      if (!doc) return null;
      const minExpiry = filter.expiresAt?.$gt;
      if (minExpiry && !(doc.expiresAt > minExpiry)) return null;
      store.delete(filter.tokenHash);
      return doc;
    },
  };
}

(async () => {
  // ---------------------------------------------------------------
  // lib/autoLoginToken.js — issue/consume semantics
  // ---------------------------------------------------------------
  console.log("autoLoginToken — single-use, short-lived, hashed-at-rest");

  function setupTokenLibMocks() {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const model = makeFakeAutoLoginTokenModel();
    mockModule("@/models/AutoLoginToken", model);
    return { model };
  }

  await test("a freshly issued token consumes exactly once, resolving the correct userId", async () => {
    const { model } = setupTokenLibMocks();
    const { createAutoLoginToken, consumeAutoLoginToken } = require("../src/lib/autoLoginToken.js");
    const rawToken = await createAutoLoginToken("user123");
    assert.strictEqual(typeof rawToken, "string");
    assert.ok(rawToken.length >= 32);
    // The raw token is never the value actually persisted.
    for (const doc of model.store.values()) {
      assert.notStrictEqual(doc.tokenHash, rawToken);
    }
    const userId = await consumeAutoLoginToken(rawToken);
    assert.strictEqual(userId, "user123");
  });

  await test("the same raw token cannot be consumed a second time", async () => {
    setupTokenLibMocks();
    const { createAutoLoginToken, consumeAutoLoginToken } = require("../src/lib/autoLoginToken.js");
    const rawToken = await createAutoLoginToken("user123");
    const first = await consumeAutoLoginToken(rawToken);
    assert.strictEqual(first, "user123");
    const second = await consumeAutoLoginToken(rawToken);
    assert.strictEqual(second, null);
  });

  await test("a tampered or guessed token never resolves to a userId", async () => {
    setupTokenLibMocks();
    const { createAutoLoginToken, consumeAutoLoginToken } = require("../src/lib/autoLoginToken.js");
    await createAutoLoginToken("user123");
    const userId = await consumeAutoLoginToken("not-the-real-token");
    assert.strictEqual(userId, null);
  });

  await test("an expired token is rejected even before the TTL sweep would delete it", async () => {
    const { model } = setupTokenLibMocks();
    const { createAutoLoginToken, consumeAutoLoginToken } = require("../src/lib/autoLoginToken.js");
    const rawToken = await createAutoLoginToken("user123");
    // Same pattern as RateLimitAttempt/rateLimit.js: correctness never
    // depends on Mongo's TTL monitor having physically removed the
    // document yet, only on the expiresAt check in the query itself —
    // backdate it directly rather than waiting out the real TTL.
    for (const doc of model.store.values()) doc.expiresAt = new Date(Date.now() - 1000);
    const userId = await consumeAutoLoginToken(rawToken);
    assert.strictEqual(userId, null);
  });

  await test("malformed input (empty, undefined, null) never reaches the database", async () => {
    const { model } = setupTokenLibMocks();
    const { consumeAutoLoginToken } = require("../src/lib/autoLoginToken.js");
    assert.strictEqual(await consumeAutoLoginToken(""), null);
    assert.strictEqual(await consumeAutoLoginToken(undefined), null);
    assert.strictEqual(await consumeAutoLoginToken(null), null);
    assert.strictEqual(model.store.size, 0);
  });

  // ---------------------------------------------------------------
  // Verify email (src/app/api/auth/verify-email/route.js)
  // ---------------------------------------------------------------
  console.log("\nVerify-email — issues a one-time autoLoginToken on success, best-effort");

  function makeFakeUserStore(initialUsers) {
    const store = new Map(initialUsers.map((u) => [u._id, { ...u }]));
    return {
      store,
      model: {
        findOneAndUpdate: async (filter, update) => {
          const doc = store.get(filter._id);
          if (!doc) return null;
          if (doc.email !== filter.email) return null;
          if (doc.tokenVersion !== filter.tokenVersion) return null;
          if (update.$set) Object.assign(doc, update.$set);
          if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
          store.set(filter._id, doc);
          return { ...doc };
        },
      },
    };
  }

  function setupVerifyMocks({ users = [], autoLoginTokenImpl } = {}) {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const { model } = makeFakeUserStore(users);
    mockModule("@/models/User", model);
    const calls = [];
    mockModule("@/lib/autoLoginToken", {
      createAutoLoginToken: async (userId) => {
        calls.push(userId);
        if (autoLoginTokenImpl) return autoLoginTokenImpl(userId);
        return "fake-auto-login-token";
      },
    });
    return { calls };
  }

  const SECRET = process.env.NEXTAUTH_SECRET;
  const PENDING_USER = { _id: "507f1f77bcf86cd799439011", email: "verify-me@example.com", emailVerified: false, tokenVersion: 0 };

  function signToken(payload) {
    return jwt.sign({ purpose: "email-verification", ...payload }, SECRET, { expiresIn: "24h" });
  }

  await test("a valid token verifies the account and returns a one-time autoLoginToken", async () => {
    const { calls } = setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 });
    const res = await POST(fakeReq({ token }));
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.autoLoginToken, "fake-auto-login-token");
    assert.deepStrictEqual(calls, [PENDING_USER._id]);
  });

  await test("createAutoLoginToken failing doesn't fail the already-successful verification", async () => {
    const { calls } = setupVerifyMocks({
      users: [PENDING_USER],
      autoLoginTokenImpl: async () => {
        throw new Error("simulated DB blip");
      },
    });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 });
    const res = await POST(fakeReq({ token }));
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.autoLoginToken, null);
    assert.strictEqual(calls.length, 1);
  });

  await test("an invalid, expired, or already-used verification token never triggers autoLoginToken issuance", async () => {
    const { calls } = setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const badToken = signToken({ userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 5 }); // stale version
    const res = await POST(fakeReq({ token: badToken }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(calls.length, 0);
  });

  // ---------------------------------------------------------------
  // lib/auth.js — authorize()'s autoLoginToken branch
  // ---------------------------------------------------------------
  console.log("\nauthorize() — automatic sign-in via a consumed autoLoginToken");

  function setupAuthorizeMocks({ consumeResult, users = [] } = {}) {
    resetModuleCache();
    const rateLimitModel = makeFakeRateLimitModel();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rateLimitModel);
    mockModule("bcryptjs", { compare: async () => false, hash: async () => "" });
    mockModule("@/models/User", {
      findById: (id) => ({ lean: async () => users.find((u) => String(u._id) === String(id)) || null }),
      findOne: () => ({ lean: async () => null }),
    });
    const consumeCalls = [];
    mockModule("@/lib/autoLoginToken", {
      consumeAutoLoginToken: async (rawToken) => {
        consumeCalls.push(rawToken);
        return typeof consumeResult === "function" ? consumeResult(rawToken) : consumeResult;
      },
    });
    return { rateLimitModel, consumeCalls };
  }

  const VERIFIED_USER = { _id: "u1", email: "ada@example.com", name: "Ada", emailVerified: true };
  const UNVERIFIED_USER_2 = { _id: "u2", email: "pending@example.com", name: "Pending", emailVerified: false };

  await test("a token that resolves to a verified user signs them in, ignoring any email/password fields", async () => {
    setupAuthorizeMocks({ consumeResult: "u1", users: [VERIFIED_USER] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    // A client-supplied email/password alongside the token must have no
    // effect — the server-resolved identity from the token is the only
    // one that matters (see the "never trust a client-provided user
    // id/email" requirement in auth.js's comment on this branch).
    const user = await authorize(
      { autoLoginToken: "raw-token", email: "attacker@example.com", password: "irrelevant" },
      fakeNextAuthReq()
    );
    assert.ok(user);
    assert.strictEqual(user.id, "u1");
    assert.strictEqual(user.email, "ada@example.com");
  });

  await test("an invalid, expired, or already-used token returns null (falls back to manual sign-in)", async () => {
    setupAuthorizeMocks({ consumeResult: null, users: [VERIFIED_USER] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ autoLoginToken: "bad-token" }, fakeNextAuthReq());
    assert.strictEqual(user, null);
  });

  await test("a token resolving to a not-actually-verified user is rejected (belt-and-braces)", async () => {
    setupAuthorizeMocks({ consumeResult: "u2", users: [UNVERIFIED_USER_2] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ autoLoginToken: "raw-token" }, fakeNextAuthReq());
    assert.strictEqual(user, null);
  });

  await test("a token resolving to a userId with no matching user returns null", async () => {
    setupAuthorizeMocks({ consumeResult: "does-not-exist", users: [] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ autoLoginToken: "raw-token" }, fakeNextAuthReq());
    assert.strictEqual(user, null);
  });

  await test("repeated auto-login attempts from one IP are rate-limited, independent of the login limiter", async () => {
    const { consumeCalls } = setupAuthorizeMocks({ consumeResult: null, users: [] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const req = fakeNextAuthReq({ "x-forwarded-for": "203.0.113.20" });
    // AUTO_LOGIN_IP_LIMIT.max is 20 (src/lib/auth.js).
    for (let i = 0; i < 20; i++) {
      const user = await authorize({ autoLoginToken: `junk-${i}` }, req);
      assert.strictEqual(user, null);
    }
    await assert.rejects(() => authorize({ autoLoginToken: "junk-final" }, req), /TooManyAttempts/);
    // The 21st (rate-limited) attempt must never reach consumeAutoLoginToken.
    assert.strictEqual(consumeCalls.length, 20);
  });

  await test("the normal email/password flow is unaffected when autoLoginToken is absent", async () => {
    resetModuleCache();
    const rateLimitModel = makeFakeRateLimitModel();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rateLimitModel);
    mockModule("bcryptjs", {
      compare: async (plain, hash) => hash === "REAL_HASH" && plain === "correct-horse",
      hash: async () => "",
    });
    mockModule("@/models/User", {
      findOne: ({ email }) => ({
        lean: async () =>
          email === "ada@example.com" ? { _id: "u1", email, passwordHash: "REAL_HASH", emailVerified: true } : null,
      }),
      findById: () => ({ lean: async () => null }),
    });
    // If the password path ever accidentally fell through to the
    // auto-login branch (or vice versa), this would throw and fail the
    // test loudly instead of silently passing.
    mockModule("@/lib/autoLoginToken", {
      consumeAutoLoginToken: async () => {
        throw new Error("consumeAutoLoginToken must not be called for a plain password sign-in");
      },
    });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ email: "ada@example.com", password: "correct-horse" }, fakeNextAuthReq());
    assert.ok(user);
    assert.strictEqual(user.email, "ada@example.com");
  });

  summary();
})();
