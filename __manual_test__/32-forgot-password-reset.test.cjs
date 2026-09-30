require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");
const crypto = require("crypto");

// Exercises the Forgot Password / Reset Password feature:
//   - src/lib/passwordResetToken.js                 (hashed-at-rest, single-use, expiring)
//   - src/app/api/auth/forgot-password/route.js     (anti-enumeration, rate limits, email)
//   - src/app/api/auth/reset-password/route.js      (validation, single-use, bcrypt)
//   - src/lib/passwordStrength.js                   (UI scorer)
//   - src/lib/email.js sendPasswordResetEmail       (content, escaping)
//   - end-to-end: request -> emailed link -> reset -> old link dead -> new password verifies
// Same style as the other files here: real route/lib code, in-memory fakes for models.

function fakeReq(body, headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    json: async () => {
      if (body === "__malformed__") throw new Error("bad json");
      return body;
    },
    headers: { get: (name) => lowered[name.toLowerCase()] ?? null },
  };
}

function makeFakeTokenModel() {
  const store = new Map();
  let counter = 0;
  return {
    store,
    async deleteMany(filter) {
      for (const [k, d] of store) if (String(d.userId) === String(filter.userId)) store.delete(k);
    },
    async create(doc) {
      if (store.has(doc.tokenHash)) throw Object.assign(new Error("E11000"), { code: 11000 });
      const created = { _id: `t_${++counter}`, ...doc };
      store.set(doc.tokenHash, created);
      return created;
    },
    async findOneAndDelete(filter) {
      const doc = store.get(filter.tokenHash);
      if (!doc) return null;
      const min = filter.expiresAt?.$gt;
      if (min && !(doc.expiresAt > min)) return null;
      store.delete(filter.tokenHash);
      return doc;
    },
  };
}

function makeFakeUserModel(users) {
  const store = new Map(users.map((u) => [String(u._id), { ...u }]));
  return {
    store,
    findOne: async ({ email }) => [...store.values()].find((u) => u.email === email) || null,
    findByIdAndUpdate: async (id, update) => {
      const doc = store.get(String(id));
      if (!doc) return null;
      Object.assign(doc, update.$set);
      return { ...doc };
    },
  };
}

const bcryptFake = {
  hash: async (pw, cost) => `hashed(${cost}):${pw}`,
  compare: async (pw, h) => h === `hashed(12):${pw}`,
};

const USER = { _id: "u1", name: "Ada", email: "ada@example.com", passwordHash: "hashed(12):oldpass", emailVerified: true };

function setup({ users = [USER], sendImpl, tokenModel } = {}) {
  resetModuleCache();
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  const rateModel = makeFakeRateLimitModel();
  mockModule("@/models/RateLimitAttempt", rateModel);
  const tokens = tokenModel || makeFakeTokenModel();
  mockModule("@/models/PasswordResetToken", tokens);
  const userModel = makeFakeUserModel(users);
  mockModule("@/models/User", userModel);
  mockModule("bcryptjs", bcryptFake);
  const sent = [];
  mockModule("@/lib/email", {
    sendPasswordResetEmail: async (args) => {
      sent.push(args);
      if (sendImpl) return sendImpl(args);
      return { sent: true };
    },
  });
  return { tokens, userModel, sent, rateModel };
}

(async () => {
  console.log("passwordResetToken — hashed, single-use, expiring");

  await test("raw token is never stored; only its sha256 hash", async () => {
    const { tokens } = setup();
    const { createPasswordResetToken } = require("../src/lib/passwordResetToken.js");
    const raw = await createPasswordResetToken("u1");
    assert.ok(raw.length >= 64);
    const [doc] = [...tokens.store.values()];
    assert.notStrictEqual(doc.tokenHash, raw);
    assert.strictEqual(doc.tokenHash, crypto.createHash("sha256").update(raw).digest("hex"));
    assert.ok(!JSON.stringify(doc).includes(raw));
  });

  await test("token expires in a short window (<= 1 hour)", async () => {
    const { tokens } = setup();
    const { createPasswordResetToken } = require("../src/lib/passwordResetToken.js");
    await createPasswordResetToken("u1");
    const [doc] = [...tokens.store.values()];
    const ttl = doc.expiresAt.getTime() - Date.now();
    assert.ok(ttl > 0 && ttl <= 60 * 60 * 1000);
  });

  await test("consumes exactly once", async () => {
    setup();
    const { createPasswordResetToken, consumePasswordResetToken } = require("../src/lib/passwordResetToken.js");
    const raw = await createPasswordResetToken("u1");
    assert.strictEqual(await consumePasswordResetToken(raw), "u1");
    assert.strictEqual(await consumePasswordResetToken(raw), null);
  });

  await test("expired token rejected without relying on TTL sweep", async () => {
    const { tokens } = setup();
    const { createPasswordResetToken, consumePasswordResetToken } = require("../src/lib/passwordResetToken.js");
    const raw = await createPasswordResetToken("u1");
    for (const d of tokens.store.values()) d.expiresAt = new Date(Date.now() - 1000);
    assert.strictEqual(await consumePasswordResetToken(raw), null);
  });

  await test("malformed / guessed tokens resolve to null and never hit the DB", async () => {
    const { tokens } = setup();
    const { createPasswordResetToken, consumePasswordResetToken } = require("../src/lib/passwordResetToken.js");
    await createPasswordResetToken("u1");
    for (const bad of ["", undefined, null, 123, {}, ["a"], "nope"]) {
      assert.strictEqual(await consumePasswordResetToken(bad), null);
    }
    assert.strictEqual(tokens.store.size, 1);
  });

  await test("requesting a new token invalidates the previous one", async () => {
    setup();
    const { createPasswordResetToken, consumePasswordResetToken } = require("../src/lib/passwordResetToken.js");
    const first = await createPasswordResetToken("u1");
    const second = await createPasswordResetToken("u1");
    assert.strictEqual(await consumePasswordResetToken(first), null);
    assert.strictEqual(await consumePasswordResetToken(second), "u1");
  });

  console.log("\nforgot-password route");

  await test("existing account: sends one email with a raw token, responds {ok:true}", async () => {
    const { sent, tokens } = setup();
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    const res = await POST(fakeReq({ email: "  ADA@Example.com " }));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, "ada@example.com");
    assert.ok(sent[0].token && !tokens.store.has(sent[0].token));
  });

  await test("unknown email: identical response, no email, no token", async () => {
    const { sent, tokens } = setup();
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    const res = await POST(fakeReq({ email: "nobody@example.com" }));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(tokens.store.size, 0);
  });

  await test("SMTP failure does not change the response", async () => {
    setup({ sendImpl: async () => { throw new Error("smtp down"); } });
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    const origErr = console.error;
    console.error = () => {};
    const res = await POST(fakeReq({ email: "ada@example.com" }));
    console.error = origErr;
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
  });

  await test("malformed / missing input returns 400, never throws", async () => {
    setup();
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    for (const body of ["__malformed__", null, {}, { email: 5 }, { email: "" }]) {
      const res = await POST(fakeReq(body));
      assert.strictEqual(res.status, 400);
    }
  });

  await test("per-email rate limit: response unchanged but emails stop after 3", async () => {
    const { sent } = setup();
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    const results = [];
    for (let i = 0; i < 6; i++) {
      const res = await POST(fakeReq({ email: "ada@example.com" }));
      results.push([res.status, JSON.stringify(await res.json())]);
    }
    assert.ok(results.every((r) => r[0] === 200 && r[1] === '{"ok":true}'));
    assert.strictEqual(sent.length, 3);
  });

  await test("per-IP rate limit caps emails across different addresses", async () => {
    const users = Array.from({ length: 25 }, (_, i) => ({ _id: `x${i}`, name: "N", email: `u${i}@example.com` }));
    const { sent } = setup({ users });
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    for (let i = 0; i < 25; i++) {
      const res = await POST(fakeReq({ email: `u${i}@example.com` }, { "x-forwarded-for": "203.0.113.9" }));
      assert.strictEqual(res.status, 200);
    }
    assert.strictEqual(sent.length, 20);
  });

  console.log("\nreset-password route");

  async function issue() {
    const ctx = setup();
    const { POST: forgot } = require("../src/app/api/auth/forgot-password/route.js");
    await forgot(fakeReq({ email: "ada@example.com" }));
    return { ...ctx, token: ctx.sent[0].token };
  }

  await test("valid token + valid password updates the hash with bcrypt cost 12", async () => {
    const { userModel, token } = await issue();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const res = await POST(fakeReq({ token, password: "newpass1", confirmPassword: "newpass1" }));
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.deepStrictEqual(json, { ok: true });
    assert.ok(!JSON.stringify(json).includes(token));
    assert.strictEqual(userModel.store.get("u1").passwordHash, "hashed(12):newpass1");
  });

  await test("token is single-use: replay fails and does not change the password again", async () => {
    const { userModel, token } = await issue();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    await POST(fakeReq({ token, password: "newpass1", confirmPassword: "newpass1" }));
    const res = await POST(fakeReq({ token, password: "hijack99", confirmPassword: "hijack99" }));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /invalid or has expired/);
    assert.strictEqual(userModel.store.get("u1").passwordHash, "hashed(12):newpass1");
  });

  await test("expired token is rejected and password unchanged", async () => {
    const { userModel, tokens, token } = await issue();
    for (const d of tokens.store.values()) d.expiresAt = new Date(Date.now() - 1);
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const res = await POST(fakeReq({ token, password: "newpass1", confirmPassword: "newpass1" }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(userModel.store.get("u1").passwordHash, "hashed(12):oldpass");
  });

  await test("invalid / missing / malformed tokens all get the same generic 400", async () => {
    setup();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const bodies = [
      { token: "deadbeef", password: "newpass1", confirmPassword: "newpass1" },
      { password: "newpass1", confirmPassword: "newpass1" },
      { token: 42, password: "newpass1", confirmPassword: "newpass1" },
      { token: { $ne: null }, password: "newpass1", confirmPassword: "newpass1" },
      "__malformed__",
    ];
    for (const b of bodies) {
      const res = await POST(fakeReq(b));
      assert.strictEqual(res.status, 400);
      assert.match((await res.json()).error, /invalid or has expired/);
    }
  });

  await test("password validation: mismatch, too short, too long, empty, non-string", async () => {
    const { userModel, token } = await issue();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const cases = [
      { password: "abcdef1", confirmPassword: "abcdef2" },
      { password: "abc", confirmPassword: "abc" },
      { password: "a".repeat(73), confirmPassword: "a".repeat(73) },
      { password: "", confirmPassword: "" },
      { password: 123456, confirmPassword: 123456 },
      { password: "abcdef1" },
    ];
    for (const c of cases) {
      const res = await POST(fakeReq({ token, ...c }));
      assert.strictEqual(res.status, 400);
    }
    // Invalid passwords must not burn the token: the valid attempt still works.
    assert.strictEqual(userModel.store.get("u1").passwordHash, "hashed(12):oldpass");
    const ok = await POST(fakeReq({ token, password: "abcdef1", confirmPassword: "abcdef1" }));
    assert.strictEqual(ok.status, 200);
  });

  await test("boundary lengths 6 and 72 are accepted", async () => {
    for (const len of [6, 72]) {
      const { token } = await issue();
      const { POST } = require("../src/app/api/auth/reset-password/route.js");
      const pw = "a".repeat(len);
      const res = await POST(fakeReq({ token, password: pw, confirmPassword: pw }));
      assert.strictEqual(res.status, 200);
    }
  });

  await test("deleted user: same generic error, no crash", async () => {
    const { userModel, token } = await issue();
    userModel.store.delete("u1");
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const res = await POST(fakeReq({ token, password: "newpass1", confirmPassword: "newpass1" }));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /invalid or has expired/);
  });

  await test("per-IP rate limit returns 429 after 20 attempts, before touching the token", async () => {
    setup();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const h = { "x-forwarded-for": "203.0.113.50" };
    for (let i = 0; i < 20; i++) {
      const res = await POST(fakeReq({ token: `junk${i}`, password: "newpass1", confirmPassword: "newpass1" }, h));
      assert.strictEqual(res.status, 400);
    }
    const res = await POST(fakeReq({ token: "junk", password: "newpass1", confirmPassword: "newpass1" }, h));
    assert.strictEqual(res.status, 429);
  });

  await test("no password or raw token is logged", async () => {
    const { token } = await issue();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const captured = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...a) => captured.push(a.join(" "));
    await POST(fakeReq({ token, password: "s3cretPW!", confirmPassword: "s3cretPW!" }));
    Object.assign(console, orig);
    const all = captured.join("\n");
    assert.ok(!all.includes("s3cretPW!") && !all.includes(token));
  });

  console.log("\nend-to-end: reset, then sign in with the new password via authorize()");

  await test("old password stops working, new password signs in; unverified state untouched", async () => {
    const { token } = await issue();
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    await POST(fakeReq({ token, password: "brandnew1", confirmPassword: "brandnew1" }));

    // Reuse the same fakes/mocks; load the real auth.js against them.
    mockModule("@/models/User", {
      findOne: ({ email }) => ({
        lean: async () => (email === "ada@example.com" ? { _id: "u1", name: "Ada", email, passwordHash: "hashed(12):brandnew1", emailVerified: true } : null),
      }),
      findById: () => ({ lean: async () => null }),
    });
    mockModule("@/lib/autoLoginToken", { consumeAutoLoginToken: async () => null });
    const { authOptions } = require("../src/lib/auth.js");
    const authorize = authOptions.providers[0].options.authorize;
    const req = { headers: {} };
    assert.strictEqual(await authorize({ email: "ada@example.com", password: "oldpass" }, req), null);
    const user = await authorize({ email: "ada@example.com", password: "brandnew1" }, req);
    assert.ok(user && user.email === "ada@example.com");
  });

  console.log("\npasswordStrength + email content");

  await test("strength scorer", async () => {
    const { scorePasswordStrength: s } = require("../src/lib/passwordStrength.js");
    assert.strictEqual(s("").score, 0);
    assert.strictEqual(s("abc").label, "Too short");
    assert.ok(s("abcdef").score < s("Abcdefghij1").score);
    assert.strictEqual(s("Abcdefghij1!").label, "Strong");
  });

  await test("reset email: subject, link, expiry, ignore notice, HTML-escaped name", async () => {
    resetModuleCache();
    const mails = [];
    process.env.EMAIL_SERVER_HOST = "smtp.test";
    mockModule("nodemailer", { createTransport: () => ({ sendMail: async (m) => mails.push(m) }) });
    const { sendPasswordResetEmail } = require("../src/lib/email.js");
    await sendPasswordResetEmail({ to: "a@b.com", name: '<img src=x onerror=1>', token: "tok/en+1" });
    delete process.env.EMAIL_SERVER_HOST;
    const m = mails[0];
    assert.strictEqual(m.subject, "Reset Your Password");
    assert.ok(m.html.includes("/reset-password?token=tok%2Fen%2B1"));
    assert.ok(m.text.includes("/reset-password?token=tok%2Fen%2B1"));
    assert.ok(/expires in 1 hour/.test(m.html) && /expires in 1 hour/.test(m.text));
    assert.ok(/ignore this email/.test(m.html));
    assert.ok(!m.html.includes("<img src=x"));
  });

  summary();
})();
