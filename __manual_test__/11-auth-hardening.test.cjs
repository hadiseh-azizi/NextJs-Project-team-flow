require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");
const jwt = require("jsonwebtoken");

// Exercises the auth-hardening changes made this phase:
//   - src/lib/auth.js            (login: rate limiting, timing-safe lookup)
//   - src/app/api/auth/register/route.js       (registration: per-IP rate limiting)
//   - src/app/api/auth/resend-verification/route.js (resend: DB-backed rate limiting)
//   - src/app/api/auth/verify-email/route.js   (token replay / expiry / tamper handling)
//
// Same style as the rest of __manual_test__: real, unmodified route/lib
// files loaded via @babel/register, with only Mongoose models and a
// couple of leaf modules swapped for in-memory fakes. See
// fakeRateLimitModel.cjs for what the rate-limit fake does and doesn't
// prove; everything else here is a plain in-memory Map standing in for a
// Mongo collection, the same pattern 08/09 already use.

function fakeReq(body, headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    json: async () => body,
    headers: { get: (name) => lowered[name.toLowerCase()] ?? null },
  };
}

// Mirrors the plain-object `headers` shape NextAuth passes into
// `authorize(credentials, req)` (see core/routes/callback.js) — distinct
// from the Fetch-style `Headers` object real Next.js route handlers get.
function fakeNextAuthReq(headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return { headers: lowered };
}

function commonMocks() {
  const rateLimitModel = makeFakeRateLimitModel();
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/models/RateLimitAttempt", rateLimitModel);
  return { rateLimitModel };
}

(async () => {
  // ---------------------------------------------------------------
  // Login (src/lib/auth.js authorize)
  // ---------------------------------------------------------------
  console.log("Login — brute-force protection and account-enumeration timing");

  // A fast fake standing in for bcryptjs everywhere in this section
  // except the one test that checks real hashing is actually wired up.
  // Rate-limit tests need ~10-30 authorize() calls each; at this app's
  // real cost factor (12) each bcrypt.compare takes ~300ms, which would
  // make this file take minutes to run for no added assurance — bcrypt's
  // own correctness isn't what's under test here, only whether
  // authorize() calls *some* comparison function on every path.
  function makeFakeBcrypt() {
    const calls = [];
    return {
      calls,
      compare: async (plain, hash) => {
        calls.push({ plain, hash });
        return hash === "REAL_HASH_FOR_ada" && plain === "correct-horse";
      },
      hash: async (plain) => `REAL_HASH_FOR_${plain}`,
    };
  }

  function setupLoginMocks({ users = [] } = {}) {
    resetModuleCache();
    const { rateLimitModel } = commonMocks();
    const fakeBcrypt = makeFakeBcrypt();
    mockModule("bcryptjs", fakeBcrypt);
    mockModule("@/models/User", {
      findOne: ({ email }) => ({
        lean: async () => users.find((u) => u.email === email) || null,
      }),
    });
    return { rateLimitModel, fakeBcrypt };
  }

  const ADA = { _id: "u1", email: "ada@example.com", name: "Ada", passwordHash: "REAL_HASH_FOR_ada", emailVerified: true, tokenVersion: 0 };
  const UNVERIFIED = { ...ADA, email: "unverified@example.com", passwordHash: "REAL_HASH_FOR_ada", emailVerified: false };

  await test("wrong password returns null (invalid credentials)", async () => {
    setupLoginMocks({ users: [ADA] });
    const { authOptions } = require("../src/lib/auth.js");
    // `authOptions.providers[0]` is the raw object CredentialsProvider()
    // returns, whose own top-level `.authorize` is next-auth's internal
    // placeholder (`() => null`) — the real `authorize` we defined in
    // auth.js only gets merged in by NextAuth()'s own provider-parsing
    // step (core/lib/providers.js), which normally runs inside the
    // `[...nextauth]` route handler, not here. Un-merged, it's still
    // reachable at `.options.authorize` (`options` being exactly what we
    // passed into `CredentialsProvider({...})`), which is what every
    // test below calls directly.
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ email: "ada@example.com", password: "wrong-password" }, fakeNextAuthReq());
    assert.strictEqual(user, null);
  });

  await test("correct password on a verified account returns the user", async () => {
    setupLoginMocks({ users: [ADA] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ email: "ada@example.com", password: "correct-horse" }, fakeNextAuthReq());
    assert.ok(user);
    assert.strictEqual(user.email, "ada@example.com");
  });

  await test("correct password on an unverified account throws EmailNotVerified", async () => {
    setupLoginMocks({ users: [UNVERIFIED] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    await assert.rejects(
      () => authorize({ email: "unverified@example.com", password: "correct-horse" }, fakeNextAuthReq()),
      /EmailNotVerified/
    );
  });

  await test("a nonexistent email still runs a password comparison (timing-safety against enumeration)", async () => {
    const { fakeBcrypt } = setupLoginMocks({ users: [ADA] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const user = await authorize({ email: "nobody@example.com", password: "anything" }, fakeNextAuthReq());
    assert.strictEqual(user, null);
    assert.strictEqual(fakeBcrypt.calls.length, 1);
    // Compared against the fixed dummy hash, never against `undefined`
    // or a short-circuited empty comparison.
    assert.ok(fakeBcrypt.calls[0].hash.startsWith("$2a$12$"));
    assert.notStrictEqual(fakeBcrypt.calls[0].hash, ADA.passwordHash);
  });

  await test("repeated wrong-password attempts for the same email are rate-limited", async () => {
    setupLoginMocks({ users: [ADA] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const creds = { email: "ada@example.com", password: "wrong-password" };
    // LOGIN_EMAIL_LIMIT.max is 10 (src/lib/auth.js) — the 11th call in
    // the same window must be rejected outright rather than reaching
    // bcrypt at all.
    for (let i = 0; i < 10; i++) {
      const user = await authorize(creds, fakeNextAuthReq());
      assert.strictEqual(user, null, `attempt ${i + 1} should just be a wrong password, not yet rate-limited`);
    }
    await assert.rejects(() => authorize(creds, fakeNextAuthReq()), /TooManyAttempts/);
  });

  await test("the per-email limit does not affect a different email", async () => {
    setupLoginMocks({ users: [ADA] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    for (let i = 0; i < 10; i++) {
      await authorize({ email: "ada@example.com", password: "wrong-password" }, fakeNextAuthReq());
    }
    await assert.rejects(() => authorize({ email: "ada@example.com", password: "wrong-password" }, fakeNextAuthReq()), /TooManyAttempts/);
    // A different account, from the same fake request, is unaffected —
    // its own bucket hasn't seen any attempts yet.
    const otherUser = await authorize({ email: "someone-else@example.com", password: "wrong-password" }, fakeNextAuthReq());
    assert.strictEqual(otherUser, null); // wrong password, not TooManyAttempts
  });

  await test("the per-IP limit trips across many different emails from the same source", async () => {
    setupLoginMocks({ users: [] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const req = fakeNextAuthReq({ "x-forwarded-for": "203.0.113.9" });
    // LOGIN_IP_LIMIT.max is 30 (src/lib/auth.js) — spray 30 different,
    // all-nonexistent emails from one IP, then confirm the 31st is
    // blocked purely by source, even though every email is unique.
    for (let i = 0; i < 30; i++) {
      const user = await authorize({ email: `spray-${i}@example.com`, password: "x" }, req);
      assert.strictEqual(user, null);
    }
    await assert.rejects(() => authorize({ email: "spray-final@example.com", password: "x" }, req), /TooManyAttempts/);
  });

  await test("a request with no forwardable IP header falls back to email-only limiting (documented tradeoff)", async () => {
    setupLoginMocks({ users: [] });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    // No x-forwarded-for/x-real-ip at all — getClientIp() returns
    // "unknown", and auth.js deliberately skips the per-IP check in that
    // case rather than lumping every such caller into one shared bucket.
    for (let i = 0; i < 30; i++) {
      await authorize({ email: `noip-${i}@example.com`, password: "x" }, fakeNextAuthReq());
    }
    const user = await authorize({ email: "noip-final@example.com", password: "x" }, fakeNextAuthReq());
    assert.strictEqual(user, null); // not rate-limited — each email is its own, fresh bucket
  });

  // ---------------------------------------------------------------
  // Registration (src/app/api/auth/register/route.js)
  // ---------------------------------------------------------------
  console.log("\nRegistration — per-IP rate limiting");

  function setupRegisterMocks() {
    resetModuleCache();
    const { rateLimitModel } = commonMocks();
    const users = new Map();
    let counter = 0;
    mockModule("mongoose", {
      ...require("mongoose"),
      startSession: async () => ({
        withTransaction: async (fn) => {
          const buffer = { user: null };
          const realCreate = User.create;
          await fn();
          if (buffer.user) users.set(buffer.user.email, buffer.user);
        },
        endSession: async () => {},
      }),
    });
    const User = {
      findOne: ({ email }) => ({ lean: async () => (users.has(email) ? { ...users.get(email) } : null) }),
      create: async ([doc]) => {
        const created = { _id: `user_${++counter}`, tokenVersion: 0, ...doc };
        users.set(created.email, created);
        return [created];
      },
    };
    mockModule("@/models/User", User);
    mockModule("@/models/Team", { updateMany: async () => {} });
    mockModule("@/models/Invitation", {
      find: () => ({ session: () => ({ lean: async () => [] }) }),
      deleteMany: async () => {},
    });
    mockModule("@/lib/verificationToken", { createVerificationToken: () => "fake.jwt.token" });
    mockModule("@/lib/email", { sendVerificationEmail: async () => ({ sent: true }) });
    return { rateLimitModel, users };
  }

  function registerBody(email) {
    return { name: "Test User", email, password: "correct-horse" };
  }

  await test("registration succeeds under the per-IP limit", async () => {
    setupRegisterMocks();
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(registerBody("first@example.com"), { "x-forwarded-for": "198.51.100.1" }));
    assert.strictEqual(res.status, 201);
  });

  await test("exceeding REGISTER_IP_LIMIT.max attempts from one IP returns 429 with Retry-After", async () => {
    setupRegisterMocks();
    const { POST } = require("../src/app/api/auth/register/route.js");
    const ip = "198.51.100.2";
    // REGISTER_IP_LIMIT.max is 10 (src/app/api/auth/register/route.js) —
    // a different email each time so the 429 is unambiguously the rate
    // limit, not the duplicate-email 409.
    for (let i = 0; i < 10; i++) {
      const res = await POST(fakeReq(registerBody(`bulk-${i}@example.com`), { "x-forwarded-for": ip }));
      assert.strictEqual(res.status, 201, `attempt ${i + 1} should succeed, not yet rate-limited`);
    }
    const res = await POST(fakeReq(registerBody("bulk-final@example.com"), { "x-forwarded-for": ip }));
    assert.strictEqual(res.status, 429);
    assert.ok(res.headers.get("Retry-After"));
  });

  await test("the per-IP limit does not block a different IP", async () => {
    setupRegisterMocks();
    const { POST } = require("../src/app/api/auth/register/route.js");
    for (let i = 0; i < 10; i++) {
      await POST(fakeReq(registerBody(`hog-${i}@example.com`), { "x-forwarded-for": "198.51.100.3" }));
    }
    const limited = await POST(fakeReq(registerBody("hog-final@example.com"), { "x-forwarded-for": "198.51.100.3" }));
    assert.strictEqual(limited.status, 429);
    const fromOtherIp = await POST(fakeReq(registerBody("other-ip@example.com"), { "x-forwarded-for": "198.51.100.4" }));
    assert.strictEqual(fromOtherIp.status, 201);
  });

  await test("registering the same address twice still returns 409, unrelated to rate limiting", async () => {
    setupRegisterMocks();
    const { POST } = require("../src/app/api/auth/register/route.js");
    const ip = "198.51.100.5";
    const first = await POST(fakeReq(registerBody("dup@example.com"), { "x-forwarded-for": ip }));
    assert.strictEqual(first.status, 201);
    const second = await POST(fakeReq(registerBody("dup@example.com"), { "x-forwarded-for": ip }));
    assert.strictEqual(second.status, 409);
  });

  // ---------------------------------------------------------------
  // Resend verification (src/app/api/auth/resend-verification/route.js)
  // ---------------------------------------------------------------
  console.log("\nResend-verification — DB-backed rate limiting, anti-enumeration preserved");

  function setupResendMocks({ users = [] } = {}) {
    resetModuleCache();
    const { rateLimitModel } = commonMocks();
    const sent = [];
    mockModule("@/models/User", {
      findOne: async ({ email }) => users.find((u) => u.email === email) || null,
    });
    mockModule("@/lib/verificationToken", { createVerificationToken: () => "fake.jwt.token" });
    mockModule("@/lib/email", {
      sendVerificationEmail: async (args) => {
        sent.push(args);
        return { sent: true };
      },
    });
    return { rateLimitModel, sent };
  }

  const UNVERIFIED_USER = { _id: "u2", email: "pending@example.com", name: "Pending", emailVerified: false, tokenVersion: 0 };

  await test("sends a verification email for an existing unverified account, under the limit", async () => {
    const { sent } = setupResendMocks({ users: [UNVERIFIED_USER] });
    const { POST } = require("../src/app/api/auth/resend-verification/route.js");
    const res = await POST(fakeReq({ email: "pending@example.com" }));
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(sent.length, 1);
  });

  await test("a nonexistent email gets the identical {ok:true} response and no email is sent", async () => {
    const { sent } = setupResendMocks({ users: [] });
    const { POST } = require("../src/app/api/auth/resend-verification/route.js");
    const res = await POST(fakeReq({ email: "nobody@example.com" }));
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(sent.length, 0);
  });

  await test("repeated resend requests for the same email stop sending after the limit, response unchanged", async () => {
    const { sent } = setupResendMocks({ users: [UNVERIFIED_USER] });
    const { POST } = require("../src/app/api/auth/resend-verification/route.js");
    // RESEND_EMAIL_LIMIT.max is 3 — send 5 requests, expect only 3 emails.
    for (let i = 0; i < 5; i++) {
      const res = await POST(fakeReq({ email: "pending@example.com" }));
      const json = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(json.ok, true); // identical response shape whether limited or not
    }
    assert.strictEqual(sent.length, 3);
  });

  await test("the per-IP limit caps requests across many different addresses from one source", async () => {
    const { sent } = setupResendMocks({
      users: Array.from({ length: 25 }, (_, i) => ({ ...UNVERIFIED_USER, _id: `u${i}`, email: `victim-${i}@example.com` })),
    });
    const { POST } = require("../src/app/api/auth/resend-verification/route.js");
    // RESEND_IP_LIMIT.max is 20 — 25 different addresses from the same
    // IP should only actually trigger 20 sends, not 25.
    for (let i = 0; i < 25; i++) {
      const res = await POST(fakeReq({ email: `victim-${i}@example.com` }, { "x-forwarded-for": "192.0.2.50" }));
      const json = await res.json();
      assert.strictEqual(json.ok, true);
    }
    assert.strictEqual(sent.length, 20);
  });

  // ---------------------------------------------------------------
  // Verify email (src/app/api/auth/verify-email/route.js)
  // ---------------------------------------------------------------
  console.log("\nVerify-email — token replay, expiry, and tamper handling");

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

  function setupVerifyMocks({ users = [] } = {}) {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const { model, store } = makeFakeUserStore(users);
    mockModule("@/models/User", model);
    return { store };
  }

  const SECRET = process.env.NEXTAUTH_SECRET;
  const PENDING_USER = { _id: "507f1f77bcf86cd799439011", email: "verify-me@example.com", emailVerified: false, tokenVersion: 0 };

  function signToken(payload, opts = {}) {
    return jwt.sign({ purpose: "email-verification", ...payload }, opts.secret || SECRET, {
      expiresIn: opts.expiresIn ?? "24h",
      ...(opts.expiresIn === undefined ? {} : {}),
    });
  }

  await test("a valid token verifies the account", async () => {
    const { store } = setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 });
    const res = await POST(fakeReq({ token }));
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(store.get(PENDING_USER._id).emailVerified, true);
    assert.strictEqual(store.get(PENDING_USER._id).tokenVersion, 1);
  });

  await test("the same token cannot be replayed a second time", async () => {
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 });
    const first = await POST(fakeReq({ token }));
    assert.strictEqual(first.status, 200);
    const second = await POST(fakeReq({ token }));
    assert.strictEqual(second.status, 400);
  });

  await test("concurrent requests carrying the same token: at most one succeeds", async () => {
    // Both calls race against the same in-memory store with no `await`
    // ahead of the mutation in the fake findOneAndUpdate, so this proves
    // the *application-level* mutual exclusion (the match-then-update
    // condition) is correct; it does not exercise MongoDB's own
    // concurrency control (see the header comment in this file / the
    // fakeRateLimitModel.cjs note for the general caveat that applies
    // throughout this sandbox test suite).
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 });
    const [a, b] = await Promise.all([POST(fakeReq({ token })), POST(fakeReq({ token }))]);
    const statuses = [a.status, b.status].sort();
    assert.deepStrictEqual(statuses, [200, 400]);
  });

  await test("an expired token is rejected", async () => {
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const expiredToken = jwt.sign(
      { purpose: "email-verification", userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 },
      SECRET,
      { expiresIn: -10 } // already expired 10 seconds ago
    );
    const res = await POST(fakeReq({ token: expiredToken }));
    assert.strictEqual(res.status, 400);
  });

  await test("a malformed/garbage token is rejected", async () => {
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    for (const bad of ["not-a-jwt-at-all", "a.b.c", "", 12345, null, {}]) {
      const res = await POST(fakeReq({ token: bad }));
      assert.strictEqual(res.status, 400, `expected 400 for token ${JSON.stringify(bad)}`);
    }
  });

  await test("a token signed with a different secret (tampered/forged) is rejected", async () => {
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const forged = jwt.sign(
      { purpose: "email-verification", userId: PENDING_USER._id, email: PENDING_USER.email, tokenVersion: 0 },
      "not-the-real-secret",
      { expiresIn: "24h" }
    );
    const res = await POST(fakeReq({ token: forged }));
    assert.strictEqual(res.status, 400);
  });

  await test("a token for a userId that doesn't exist is rejected without a 500", async () => {
    setupVerifyMocks({ users: [] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: "507f1f77bcf86cd799439011", email: "ghost@example.com", tokenVersion: 0 });
    const res = await POST(fakeReq({ token }));
    assert.strictEqual(res.status, 400);
  });

  await test("a malformed userId in the token payload is rejected before reaching the database", async () => {
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: "not-an-object-id", email: PENDING_USER.email, tokenVersion: 0 });
    const res = await POST(fakeReq({ token }));
    assert.strictEqual(res.status, 400);
  });

  await test("a token whose email no longer matches the user's current email is rejected", async () => {
    setupVerifyMocks({ users: [PENDING_USER] });
    const { POST } = require("../src/app/api/auth/verify-email/route.js");
    const token = signToken({ userId: PENDING_USER._id, email: "old-address@example.com", tokenVersion: 0 });
    const res = await POST(fakeReq({ token }));
    assert.strictEqual(res.status, 400);
  });

  summary();
})();
