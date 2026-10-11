require("./register.cjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// L1-L7 (Low-priority security hardening). Real route/lib files are loaded;
// only Mongoose models, next/server's `after` and SMTP are swapped for fakes.

process.env.NEXTAUTH_SECRET = "test-secret-for-l1-l7";
const realServer = require("next/server");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const P = "111111111111111111111111";
const T = "222222222222222222222222";
const req = (body, headers = {}) => ({
  json: async () => {
    if (body === "__bad__") throw new SyntaxError("bad");
    return body;
  },
  headers: new Headers(headers),
});
const ctx = (id) => ({ params: Promise.resolve({ id }) });

(async () => {
  // ---------------------------------------------------------------- L1
  console.log("L1 - centralized email validation");
  resetModuleCache();
  const { isValidEmail } = require("../src/lib/emailValidation.js");
  const { validateEmailInput } = require("../src/lib/validation.js");

  await test("rejects the audited malformed values", () => {
    for (const bad of ["a<b@c.com>", "x@y.com,z", '"a"@b.com', "a@b", "a@b.c", "a b@c.com", "a@@c.com", "a@b..com", ".a@b.com", "a.@b.com", "a@-b.com", "a@b.com;c@d.com", "a@[1.2.3.4]", "a@1.2.3.4", "a(b)@c.com", "a\nb@c.com", "a@b.com\n", "@b.com", "a@", "", "a@b.123"]) {
      assert.strictEqual(isValidEmail(bad), false, JSON.stringify(bad));
    }
  });
  await test("accepts ordinary addresses, including plus-tags, subdomains and unicode", () => {
    for (const ok of ["ada@example.com", "first.last+tag@sub.example.co.uk", "o'brien@example.ie", "a_b-c@x-y.org", "x@y.io", "u@xn--mnchen-3ya.de", "用户@例子.广告", "müller@münchen.de", "a@b.museum"]) {
      assert.strictEqual(isValidEmail(ok), true, ok);
    }
  });
  await test("enforces length limits (254 total, 64 local, 63 label)", () => {
    assert.strictEqual(isValidEmail(`${"a".repeat(64)}@example.com`), true);
    assert.strictEqual(isValidEmail(`${"a".repeat(65)}@example.com`), false);
    assert.strictEqual(isValidEmail(`a@${"b".repeat(64)}.com`), false);
    assert.strictEqual(isValidEmail(`a@${"b.".repeat(130)}com`), false);
  });
  await test("validateEmailInput (team add-member) uses the same rule and still normalizes", () => {
    assert.deepStrictEqual(validateEmailInput("  Ada@Example.COM "), { value: "ada@example.com" });
    assert.ok(validateEmailInput("a<b@c.com>").error);
    assert.ok(validateEmailInput("x@y.com,z").error);
  });
  await test("registration rejects malformed values before any account lookup", async () => {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    mockModule("@/models/User", { findOne: () => { throw new Error("user lookup must not happen"); } });
    const { POST } = require("../src/app/api/auth/register/route.js");
    for (const email of ["a<b@c.com>", "x@y.com,z", '"a"@b.com']) {
      const res = await POST(req({ name: "N", email, password: "longenough1" }, { "x-forwarded-for": "198.51.100.1" }));
      assert.strictEqual(res.status, 400, email);
    }
  });

  // ---------------------------------------------------------------- L2
  console.log("L2 - rate-limit key/input handling");
  await test("email key part is a fixed-length digest; same address -> same bucket", () => {
    resetModuleCache();
    const { emailRateLimitKey } = require("../src/lib/rateLimitKey.js");
    const k = emailRateLimitKey(" Ada@Example.com ");
    assert.strictEqual(k, emailRateLimitKey("ada@example.com"));
    assert.notStrictEqual(k, emailRateLimitKey("ada2@example.com"));
    assert.strictEqual(k.length, 32);
    assert.strictEqual(emailRateLimitKey("x".repeat(1_000_000)).length, 32);
  });
  await test("an already-limited key causes no database write; TTL window and count unchanged", async () => {
    resetModuleCache();
    const model = makeFakeRateLimitModel();
    let writes = 0;
    const orig = model.findOneAndUpdate;
    model.findOneAndUpdate = async (...a) => { writes++; return orig(...a); };
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", model);
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    const cfg = { max: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) assert.strictEqual((await checkRateLimit("k", cfg)).limited, false);
    assert.strictEqual(writes, 3);
    const before = { ...model.__store.get("k") };
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit("k", cfg);
      assert.strictEqual(r.limited, true);
      assert.ok(r.retryAfterMs > 0);
    }
    assert.strictEqual(writes, 3, "limited requests must not write");
    assert.deepStrictEqual(model.__store.get("k"), before);
    // window expiry still resets
    model.__store.get("k").expiresAt = new Date(Date.now() - 1);
    const r = await checkRateLimit("k", cfg);
    assert.strictEqual(r.limited, false);
    assert.strictEqual(model.__store.get("k").count, 1);
  });
  await test("a request is limited exactly on attempt max+1 (behaviour preserved)", async () => {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    const { checkRateLimit } = require("../src/lib/rateLimit.js");
    const res = [];
    for (let i = 0; i < 5; i++) res.push((await checkRateLimit("z", { max: 4, windowMs: 1000 })).limited);
    assert.deepStrictEqual(res, [false, false, false, false, true]);
  });

  // forgot / resend harness
  function authSetup({ users = [], bindings = {} } = {}) {
    resetModuleCache();
    const deferred = [];
    mockModule("next/server", { NextResponse: realServer.NextResponse, after: (fn) => deferred.push(fn) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const rate = makeFakeRateLimitModel();
    mockModule("@/models/RateLimitAttempt", rate);
    const sent = [];
    const created = [];
    mockModule("@/models/User", { findOne: async ({ email }) => users.find((u) => u.email === email) || null });
    mockModule("@/models/PasswordResetToken", {
      deleteMany: async () => {},
      create: async (d) => { created.push(d); return d; },
    });
    mockModule("@/lib/email", {
      sendPasswordResetEmail: async (a) => { sent.push(["reset", a.to]); },
      sendVerificationEmail: async (a) => { sent.push(["verify", a.to]); },
    });
    return { deferred, rate, sent, created };
  }
  const USER = { _id: A, name: "Ada", email: "ada@example.com", emailVerified: false, tokenVersion: 0 };

  await test("forgot-password: oversized / malformed email -> 400, creates no rate-limit record", async () => {
    const s = authSetup();
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    for (const email of ["x".repeat(100_000) + "@example.com", "a<b@c.com>", "nope"]) {
      const res = await POST(req({ email }, { "x-forwarded-for": "198.51.100.7" }));
      assert.strictEqual(res.status, 400);
    }
    assert.strictEqual(s.rate.__store.size, 0);
  });
  await test("forgot-password/resend: keys hold only digests; a limited IP stops before minting email counters", async () => {
    const s = authSetup({ users: [USER] });
    const forgot = require("../src/app/api/auth/forgot-password/route.js");
    const ip = { "x-forwarded-for": "198.51.100.9" };
    for (let i = 0; i < 25; i++) await forgot.POST(req({ email: `u${i}@example.com` }, ip));
    const keys = [...s.rate.__store.keys()];
    assert.ok(keys.every((k) => !k.includes("@")), "no plaintext email in keys");
    const emailKeys = keys.filter((k) => k.startsWith("forgot-password:email:")).length;
    assert.strictEqual(emailKeys, 20, "IP limit is 20: later requests mint no per-email counters");
    const ipKey = s.rate.__store.get("forgot-password:ip:198.51.100.9");
    assert.strictEqual(ipKey.count, 20, "limited requests no longer write to the counter");
  });

  // ---------------------------------------------------------------- L3
  console.log("L3 - existence-dependent work runs after the response");
  await test("forgot-password: nothing account-dependent happens before the response; same reply for known/unknown", async () => {
    const s = authSetup({ users: [{ ...USER, emailVerified: true }] });
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    const known = await POST(req({ email: "ada@example.com" }, { "x-forwarded-for": "198.51.100.20" }));
    assert.strictEqual(s.deferred.length, 1);
    assert.strictEqual(s.created.length, 0, "no token written before the response");
    assert.strictEqual(s.sent.length, 0, "no email before the response");
    const unknown = await POST(req({ email: "nobody@example.com" }, { "x-forwarded-for": "198.51.100.21" }));
    assert.strictEqual(known.status, unknown.status);
    assert.deepStrictEqual(await known.json(), await unknown.json());
    for (const fn of s.deferred) await fn();
    assert.deepStrictEqual(s.sent, [["reset", "ada@example.com"]], "only the real account is emailed");
    assert.strictEqual(s.created.length, 1);
  });
  await test("forgot-password: an SMTP failure after the response is swallowed", async () => {
    const s = authSetup({ users: [USER] });
    mockModule("@/lib/email", { sendPasswordResetEmail: async () => { throw new Error("smtp down"); } });
    const { POST } = require("../src/app/api/auth/forgot-password/route.js");
    await POST(req({ email: "ada@example.com" }, { "x-forwarded-for": "198.51.100.22" }));
    const origErr = console.error; console.error = () => {};
    try { for (const fn of s.deferred) await fn(); } finally { console.error = origErr; }
  });
  await test("resend-verification: deferred; verified and unknown accounts get no email; unverified does", async () => {
    const s = authSetup({ users: [USER, { ...USER, _id: B, email: "done@example.com", emailVerified: true }] });
    const { POST } = require("../src/app/api/auth/resend-verification/route.js");
    const r = [];
    for (const [i, email] of ["ada@example.com", "done@example.com", "nobody@example.com"].entries()) {
      const res = await POST(req({ email }, { "x-forwarded-for": `198.51.100.3${i}` }));
      r.push([res.status, JSON.stringify(await res.json())]);
    }
    assert.strictEqual(new Set(r.map(String)).size, 1, "identical responses");
    assert.strictEqual(s.sent.length, 0);
    for (const fn of s.deferred) await fn();
    assert.deepStrictEqual(s.sent, [["verify", "ada@example.com"]]);
  });
  await test("without a request scope (after() unavailable) the work still runs, inline", async () => {
    const s = authSetup({ users: [USER] });
    mockModule("next/server", { NextResponse: realServer.NextResponse, after: () => { throw new Error("outside request scope"); } });
    const { POST } = require("../src/app/api/auth/resend-verification/route.js");
    await POST(req({ email: "ada@example.com" }, { "x-forwarded-for": "198.51.100.40" }));
    assert.deepStrictEqual(s.sent, [["verify", "ada@example.com"]]);
  });

  // ---------------------------------------------------------------- L4
  console.log("L4 - missing vs denied responses");
  const projectModel = (doc) => ({
    findById: () => ({ populate: function () { return this; }, lean: async () => doc }),
    updateOne: async () => {},
  });
  const projDoc = {
    _id: P, name: "Secret", manager: { _id: A },
    team: { _id: T, manager: { _id: A }, members: [{ _id: A }] },
    members: [{ _id: A }],
  };
  function projSetup(user, doc) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: user } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", projectModel(doc));
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/models/Task", { find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/lib/serialize", { toProjectDTO: () => ({}) });
  }
  const sig = async (res) => `${res.status} ${JSON.stringify(await res.json())}`;

  await test("GET project: nonexistent and not-accessible are indistinguishable", async () => {
    projSetup(B, null);
    const missing = await sig(await require("../src/app/api/projects/[id]/route.js").GET(req(), ctx(P)));
    projSetup(B, projDoc);
    const denied = await sig(await require("../src/app/api/projects/[id]/route.js").GET(req(), ctx(P)));
    assert.strictEqual(missing, denied);
    assert.ok(missing.startsWith("403"));
  });
  await test("PATCH/DELETE project and members/editors/share: missing == not-manager (403, same body)", async () => {
    const routes = [
      ["../src/app/api/projects/[id]/route.js", "PATCH", { name: "x" }],
      ["../src/app/api/projects/[id]/route.js", "DELETE", undefined],
      ["../src/app/api/projects/[id]/share/route.js", "GET", undefined],
      ["../src/app/api/projects/[id]/members/route.js", "POST", { userId: B }],
      ["../src/app/api/projects/[id]/editors/route.js", "POST", { userId: B }],
    ];
    for (const [file, method, body] of routes) {
      projSetup(B, null);
      const missing = await sig(await require(file)[method](req(body), ctx(P)));
      projSetup(B, projDoc);
      const denied = await sig(await require(file)[method](req(body), ctx(P)));
      assert.strictEqual(missing, denied, `${file} ${method}`);
      assert.ok(missing.startsWith("403"), `${file} ${method}: ${missing}`);
    }
  });
  await test("team routes: missing == not-manager / not-member", async () => {
    const teamDoc = { _id: T, name: "T", manager: A, members: [A] };
    const run = async (doc, user, file, method, body) => {
      resetModuleCache();
      mockModule("next-auth", { getServerSession: async () => ({ user: { id: user } }) });
      mockModule("@/lib/mongodb", { connectDB: async () => {} });
      const q = () => ({ populate: function () { return this; }, lean: async () => doc, then: (r) => r(doc) });
      mockModule("@/models/Team", { findById: q });
      mockModule("@/models/Invitation", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
      mockModule("@/lib/serialize", { toTeamDTO: () => ({}) });
      return sig(await require(file)[method](req(body), { params: Promise.resolve({ id: T, invitationId: P }) }));
    };
    for (const [file, method, body] of [
      ["../src/app/api/teams/[id]/route.js", "GET"],
      ["../src/app/api/teams/[id]/route.js", "PATCH", { name: "n" }],
      ["../src/app/api/teams/[id]/members/route.js", "POST", { email: "a@b.co" }],
      ["../src/app/api/teams/[id]/invitations/[invitationId]/route.js", "DELETE"],
    ]) {
      const missing = await run(null, B, file, method, body);
      const denied = await run(teamDoc, B, file, method, body);
      assert.strictEqual(missing, denied, `${file} ${method}`);
      assert.ok(missing.startsWith("403"));
    }
  });
  await test("legitimate semantics kept: manager gets through, malformed id stays a format 404, no session 401", async () => {
    projSetup(A, projDoc);
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    assert.strictEqual((await GET(req(), ctx(P))).status, 200);
    assert.strictEqual((await GET(req(), ctx("nope"))).status, 404);
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => null });
    assert.strictEqual((await require("../src/app/api/projects/[id]/route.js").GET(req(), ctx(P))).status, 401);
  });

  // ---------------------------------------------------------------- L5
  console.log("L5 - ObjectId validation");
  resetModuleCache();
  const { isValidObjectId, normalizeObjectId } = require("../src/lib/objectId.js");
  await test("accepts 24 hex chars in any case; rejects everything else", () => {
    for (const ok of ["507f1f77bcf86cd799439011", "507F1F77BCF86CD799439011", "507f1F77bcF86cd799439011"]) assert.ok(isValidObjectId(ok), ok);
    for (const bad of ["", "507f1f77bcf86cd79943901", "507f1f77bcf86cd7994390111", "507f1f77bcf86cd79943901g", "123456789012", " 507f1f77bcf86cd799439011", "507f1f77bcf86cd799439011\n", null, undefined, 5, {}, ["507f1f77bcf86cd799439011"]]) {
      assert.strictEqual(isValidObjectId(bad), false, String(bad));
    }
    assert.strictEqual(normalizeObjectId("507F1F77BCF86CD799439011"), "507f1f77bcf86cd799439011");
    assert.strictEqual(normalizeObjectId("zzz"), null);
  });
  await test("validators return canonical ids and dedupe across case", () => {
    resetModuleCache();
    const v = require("../src/lib/validation.js");
    assert.deepStrictEqual(v.validateObjectIdField(A.toUpperCase()), { value: A });
    assert.deepStrictEqual(v.validateObjectIdArray([A, A.toUpperCase(), B]), { value: [A, B] });
    const { validateColumnOrderPayload } = require("../src/lib/columnReorder.js");
    assert.ok(validateColumnOrderPayload([A, A.toUpperCase()], isValidObjectId).error, "case-variant duplicate rejected");
    assert.deepStrictEqual(validateColumnOrderPayload([A.toUpperCase(), B], isValidObjectId).value, [A, B]);
  });
  await test("validateAssignees accepts an upper-case id for a real member and still rejects outsiders", () => {
    resetModuleCache();
    const { validateAssignees } = require("../src/lib/authz.js");
    const project = { manager: A, members: [B], team: { members: [A, B] } };
    assert.deepStrictEqual(validateAssignees(project, [B.toUpperCase()]), { assignees: [B] });
    assert.ok(validateAssignees(project, ["cccccccccccccccccccccccc".toUpperCase()]).error);
  });
  await test("the upper-case spelling cannot sneak past 'manager can't be removed'", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Team", { findById: async () => ({ _id: T, manager: A, members: [A, B] }) });
    mockModule("@/models/Project", {}); mockModule("@/models/Task", {}); mockModule("@/models/Invitation", {}); mockModule("@/models/User", {});
    const { DELETE } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await DELETE({ url: `http://x/api/teams/${T}/members?userId=${A.toUpperCase()}`, headers: new Headers() }, ctx(T));
    assert.strictEqual(res.status, 400);
  });

  // ---------------------------------------------------------------- L6
  console.log("L6 - JWT algorithm pinning and CSRF");
  await test("verification tokens are HS256 and verified with algorithms pinned", () => {
    resetModuleCache();
    const { createVerificationToken, verifyVerificationToken } = require("../src/lib/verificationToken.js");
    const tok = createVerificationToken(A, "a@b.co", 0);
    assert.strictEqual(jwt.decode(tok, { complete: true }).header.alg, "HS256");
    assert.strictEqual(verifyVerificationToken(tok).userId, A);
  });
  await test("tokens signed with another HMAC algorithm or alg:none are rejected", () => {
    resetModuleCache();
    const { verifyVerificationToken } = require("../src/lib/verificationToken.js");
    const claims = { userId: A, email: "a@b.co", tokenVersion: 0, purpose: "email-verification" };
    const secret = process.env.NEXTAUTH_SECRET;
    assert.throws(() => verifyVerificationToken(jwt.sign(claims, secret, { algorithm: "HS512" })), /invalid algorithm/);
    assert.throws(() => verifyVerificationToken(jwt.sign(claims, secret, { algorithm: "HS384" })), /invalid algorithm/);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;
    assert.throws(() => verifyVerificationToken(none));
  });

  resetModuleCache();
  const { isSameOriginRequest } = require("../src/lib/csrf.js");
  const h = (o) => new Headers(o);
  const env = { NEXTAUTH_URL: "https://app.example.com" };
  const chk = (method, headers) => isSameOriginRequest({ method, headers: h(headers), env });
  await test("same-origin JSON and multipart POSTs pass (Origin matches Host)", () => {
    assert.ok(chk("POST", { origin: "https://app.example.com", host: "app.example.com", "content-type": "application/json" }));
    assert.ok(chk("POST", { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "multipart/form-data; boundary=x" }));
    assert.ok(chk("PATCH", { origin: "https://app.example.com", host: "internal:3000", "x-forwarded-host": "app.example.com" }));
    assert.ok(chk("DELETE", { origin: "https://app.example.com", host: "other" }), "NEXTAUTH_URL origin is trusted");
  });
  await test("cross-site, null and malformed origins are refused for every state-changing method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.strictEqual(chk(method, { origin: "https://evil.example", host: "app.example.com" }), false);
      assert.strictEqual(chk(method, { origin: "null", host: "app.example.com" }), false);
      assert.strictEqual(chk(method, { origin: "not a url", host: "app.example.com" }), false);
    }
    assert.strictEqual(chk("POST", { origin: "https://app.example.com.evil.example", host: "app.example.com" }), false);
  });
  await test("no Origin: Sec-Fetch-Site / Referer decide; with neither (non-browser) it passes", () => {
    assert.ok(chk("POST", { "sec-fetch-site": "same-origin", host: "a" }));
    assert.strictEqual(chk("POST", { "sec-fetch-site": "cross-site", host: "a" }), false);
    assert.strictEqual(chk("POST", { "sec-fetch-site": "same-site", host: "a" }), false);
    assert.ok(chk("POST", { referer: "https://a.test/page", host: "a.test" }));
    assert.strictEqual(chk("POST", { referer: "https://evil.test/", host: "a.test" }), false);
    assert.ok(chk("POST", { host: "a.test" }));
  });
  await test("GET/HEAD/OPTIONS are never blocked", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) assert.ok(chk(m, { origin: "https://evil.example", host: "a" }));
  });
  await test("middleware: API POST from a foreign origin -> 403 JSON; own origin and pages pass", () => {
    resetModuleCache();
    const { NextRequest } = realServer;
    const { middleware, config } = require("../src/middleware.js");
    const mk = (path, method, headers) => new NextRequest(`https://app.example.com${path}`, { method, headers });
    const bad = middleware(mk("/api/tasks", "POST", { origin: "https://evil.example", host: "app.example.com" }));
    assert.strictEqual(bad.status, 403);
    const good = middleware(mk("/api/tasks", "POST", { origin: "https://app.example.com", host: "app.example.com" }));
    assert.strictEqual(good.status, 200);
    assert.ok(!good.headers.get("content-security-policy"), "API requests don't get the page CSP");
    assert.strictEqual(middleware(mk("/api/tasks", "GET", { origin: "https://evil.example" })).status, 200);
    const page = middleware(mk("/dashboard", "GET", {}));
    assert.ok(page.headers.get("content-security-policy"));
    assert.ok(config.matcher.includes("/api/:path*"));
  });

  // ---------------------------------------------------------------- L7
  console.log("L7 - reset token consumed only with the password write");
  function resetSetup({ failUpdate = false, transactional = true } = {}) {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    const tokens = new Map();
    const user = { _id: A, passwordHash: "old", tokenVersion: 0 };
    let hashes = 0;
    const live = (doc) => doc && doc.expiresAt > new Date();
    mockModule("@/models/PasswordResetToken", {
      findOne: (f) => ({ select: function () { return this; }, lean: async () => (live(tokens.get(f.tokenHash)) ? tokens.get(f.tokenHash) : null) }),
      findOneAndDelete: (f) => {
        // Find-and-delete is one step, as in MongoDB.
        const run = async () => {
          const doc = live(tokens.get(f.tokenHash)) ? tokens.get(f.tokenHash) : null;
          if (doc) tokens.delete(f.tokenHash);
          return doc;
        };
        // Transactional fake: deletes are staged and rolled back on abort.
        const q = { session: (s) => { q._s = s; return q; }, then: (res, rej) => run().then((d) => { if (d && q._s) q._s.staged.push(d); return d; }).then(res, rej) };
        return q;
      },
      create: async (d) => { tokens.set(d.tokenHash, d); return d; },
    });
    mockModule("@/models/User", {
      findByIdAndUpdate: async (id, upd) => {
        if (failUpdate) throw new Error("db down");
        Object.assign(user, upd.$set); user.tokenVersion += upd.$inc.tokenVersion; return { ...user };
      },
    });
    mockModule("bcryptjs", { hash: async (pw) => { hashes++; return `h:${pw}`; }, compare: async () => false });
    mockModule("@/lib/mongoTransaction", {
      withOptionalTransaction: async (fn) => {
        if (!transactional) return fn(null);
        const session = { staged: [] };
        try { return await fn(session); } catch (e) { for (const d of session.staged) tokens.set(d.tokenHash, d); throw e; }
      },
    });
    const raw = "r".repeat(64);
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    tokens.set(hash, { tokenHash: hash, userId: A, expiresAt: new Date(Date.now() + 3600_000) });
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const call = (token = raw) => POST(req({ token, password: "newpassword1", confirmPassword: "newpassword1" }, { "x-forwarded-for": "198.51.100.77" }));
    return { tokens, user, call, hash, hashes: () => hashes };
  }
  const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

  await test("success: password changed, tokenVersion bumped, token gone, replay rejected", async () => {
    const s = resetSetup();
    const ok = await s.call();
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(s.user.passwordHash, "h:newpassword1");
    assert.strictEqual(s.user.tokenVersion, 1);
    assert.strictEqual(s.tokens.size, 0);
    assert.strictEqual((await s.call()).status, 400);
  });
  await test("database failure on the password write leaves the link usable (transaction)", async () => {
    const s = resetSetup({ failUpdate: true });
    const res = await quiet(() => s.call());
    assert.ok(res.status >= 500 || res.status === 400 || res.status === 503, `got ${res.status}`);
    assert.ok(s.tokens.has(s.hash), "token must survive a failed reset");
    assert.strictEqual(s.user.passwordHash, "old");
  });
  await test("database failure without transactions (standalone Mongo): token is restored", async () => {
    const s = resetSetup({ failUpdate: true, transactional: false });
    await quiet(() => s.call());
    assert.ok(s.tokens.has(s.hash), "token restored by compensation");
    assert.ok(s.tokens.get(s.hash).expiresAt > new Date());
  });
  await test("unknown / expired tokens: generic 400 and no password hashing is spent", async () => {
    const s = resetSetup();
    assert.strictEqual((await s.call("z".repeat(64))).status, 400);
    s.tokens.get(s.hash).expiresAt = new Date(Date.now() - 1);
    assert.strictEqual((await s.call()).status, 400);
    assert.strictEqual(s.hashes(), 0);
  });
  await test("concurrent submissions: exactly one succeeds", async () => {
    const s = resetSetup();
    const results = await Promise.all([s.call(), s.call(), s.call()]);
    assert.strictEqual(results.filter((r) => r.status === 200).length, 1);
    assert.strictEqual(s.user.tokenVersion, 1);
  });

  summary();
})();
