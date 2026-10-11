require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");
const { makeDb, oid } = require("./fakeAuthDb.cjs");
const crypto = require("crypto");
const realBcrypt = require("bcryptjs");

// Medium-priority security fixes M1-M6. Real route/lib files, in-memory
// models (see fakeAuthDb.cjs). Real bcryptjs where hashing matters
// (Unicode, pre-hijack flow), a fast fake for the rate-limit loops.

const IP_A = "10.0.0.1";
const IP_B = "10.0.0.2";

function fakeReq(body, headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return { json: async () => body, url: "http://localhost/x", headers: { get: (n) => lowered[n.toLowerCase()] ?? null } };
}
const naReq = (ip) => ({ headers: ip ? { "x-forwarded-for": ip } : {} });

function setup({ fastBcrypt = false, mockAuth = false } = {}) {
  resetModuleCache();
  const db = makeDb();
  const rl = makeFakeRateLimitModel();
  const sentVerification = [];
  const sentInvites = [];
  const state = { session: null };
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/models/RateLimitAttempt", rl);
  mockModule("@/models/User", db.User);
  mockModule("@/models/Team", db.Team);
  mockModule("@/models/Invitation", db.Invitation);
  mockModule("@/models/AutoLoginToken", db.AutoLoginToken);
  mockModule("@/models/PasswordResetToken", db.PasswordResetToken);
  // No live MongoDB: run transaction callbacks without a session.
  mockModule("@/lib/mongoTransaction", { withOptionalTransaction: async (fn) => fn(null) });
  mockModule("@/models/Project", {});
  mockModule("@/models/Task", {});
  mockModule("@/lib/mongoTransaction", { withOptionalTransaction: async (fn) => fn(null) });
  mockModule("@/lib/email", {
    sendVerificationEmail: async (a) => { sentVerification.push(a); },
    sendTeamInviteEmail: async (a) => { sentInvites.push(a); },
    sendPasswordResetEmail: async () => {},
  });
  mockModule("next-auth", { getServerSession: async () => state.session });
  if (mockAuth) {
    mockModule("@/lib/auth", { authOptions: {} });
    mockModule("@/lib/authz", { isTeamManager: (t, uid) => String(t.manager) === String(uid) });
  }
  // mockModule() entries survive resetModuleCache(), so always set bcryptjs
  // explicitly — otherwise a "fast" test would leak its fake into later
  // tests that are meant to use the real library.
  mockModule("bcryptjs", realBcrypt);
  if (fastBcrypt) {
    mockModule("bcryptjs", {
      hash: async (p) => `H(${p})`,
      compare: async (p, h) => h === `H(${p})`,
    });
  }
  const authorize = () => require("../src/lib/auth.js").authOptions.providers[0].options.authorize;
  return { db, rl, sentVerification, sentInvites, state, authorize };
}

const cookieOf = (res) => {
  const sc = res.headers.get("set-cookie") || "";
  const m = /tf_reg_bind=([^;]+)/.exec(sc);
  return { raw: sc, secret: m ? m[1] : null };
};

(async () => {
  // ---------------------------------------------------------------
  console.log("M5 — password policy (UTF-8 bytes, shared by register/reset/login)");
  {
    const { validatePassword, passwordByteLength } = require("../src/lib/passwordPolicy.js");
    const ok = (p) => assert.ok(!validatePassword(p).error, `expected valid: ${String(p).slice(0, 12)}…`);
    const bad = (p) => assert.ok(validatePassword(p).error, `expected invalid: ${String(p).slice(0, 12)}…`);

    await test("72 ASCII bytes accepted, 73 rejected", () => { ok("a".repeat(72)); bad("a".repeat(73)); });
    await test("24 CJK characters (72 bytes) accepted, 25 (75 bytes) rejected", () => {
      assert.strictEqual(passwordByteLength("密".repeat(24)), 72);
      ok("密".repeat(24));
      bad("密".repeat(25));
    });
    await test("old length check would have let 72 CJK characters (216 bytes) through; now rejected", () => {
      assert.ok("密".repeat(72).length <= 72);
      bad("密".repeat(72));
    });
    await test("emoji counted as 4 bytes: 18 accepted, 19 rejected", () => { ok("🔐".repeat(18)); bad("🔐".repeat(19)); });
    await test("minimum is 6 characters, counted as characters not UTF-16 units", () => {
      bad("abcde"); ok("abcdef");
      bad("🔐🔐🔐🔐🔐"); // 5 characters though length 10
      ok("🔐🔐🔐🔐🔐🔐");
    });
    await test("lone surrogates and non-strings are rejected", () => { bad("abc\ud800def"); bad(""); bad(undefined); bad(12345678); });
  }

  await test("register and reset enforce the same limit and message", async () => {
    const s = setup({ fastBcrypt: true });
    const register = require("../src/app/api/auth/register/route.js");
    const reset = require("../src/app/api/auth/reset-password/route.js");
    const long = "密".repeat(25);
    const r1 = await register.POST(fakeReq({ name: "A", email: "a@x.com", password: long }, { "x-forwarded-for": IP_A }));
    const r2 = await reset.POST(fakeReq({ token: "t", password: long, confirmPassword: long }, { "x-forwarded-for": IP_A }));
    assert.strictEqual(r1.status, 400);
    assert.strictEqual(r2.status, 400);
    assert.strictEqual((await r1.json()).error, (await r2.json()).error);
    assert.strictEqual(s.db.users.length, 0);
  });

  await test("Unicode password round-trips: register -> verify -> login (real bcrypt)", async () => {
    const s = setup();
    const register = require("../src/app/api/auth/register/route.js");
    const verify = require("../src/app/api/auth/verify-email/route.js");
    const pw = "pässwörd密码🔐Ω";
    const reg = await register.POST(fakeReq({ name: "U", email: "uni@x.com", password: pw }, { "x-forwarded-for": IP_A }));
    assert.strictEqual(reg.status, 201);
    const { secret } = cookieOf(reg);
    const v = await verify.POST(fakeReq({ token: s.sentVerification[0].token }, { cookie: `tf_reg_bind=${secret}` }));
    assert.strictEqual((await v.json()).ok, true);
    const authorize = s.authorize();
    assert.ok(await authorize({ email: "uni@x.com", password: pw }, naReq(IP_A)));
    assert.strictEqual(await authorize({ email: "uni@x.com", password: "pässwörd密码🔐Ψ" }, naReq(IP_A)), null);
  });

  await test("login treats a >72-byte password as wrong (no silent truncation)", async () => {
    const s = setup();
    const seventyTwo = "a".repeat(72);
    s.db.users.push({ _id: oid("u99"), name: "T", email: "t@x.com", emailVerified: true, tokenVersion: 0, passwordHash: realBcrypt.hashSync(seventyTwo, 4) });
    const authorize = s.authorize();
    assert.ok(await authorize({ email: "t@x.com", password: seventyTwo }, naReq(IP_A)));
    assert.strictEqual(await authorize({ email: "t@x.com", password: seventyTwo + "extra" }, naReq(IP_A)), null);
  });

  // ---------------------------------------------------------------
  console.log("\nM1 — account pre-hijacking");
  await test("registration sets an httpOnly, SameSite=Strict, auth-scoped binding cookie; token carries only its hash", async () => {
    const s = setup({ fastBcrypt: true });
    const register = require("../src/app/api/auth/register/route.js");
    const res = await register.POST(fakeReq({ name: "V", email: "v@x.com", password: "secret1" }, { "x-forwarded-for": IP_A }));
    assert.strictEqual(res.status, 201);
    const { raw, secret } = cookieOf(res);
    assert.ok(secret, "cookie set");
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /SameSite=strict/i);
    assert.match(raw, /Path=\/api\/auth/i);
    const payload = require("jsonwebtoken").decode(s.sentVerification[0].token);
    assert.strictEqual(payload.bind, crypto.createHash("sha256").update(secret).digest("hex"));
    assert.ok(!JSON.stringify(payload).includes(secret), "raw secret is not in the token");
  });

  await test("same browser: verification works as before — password kept, auto-login token issued", async () => {
    const s = setup({ fastBcrypt: true });
    const register = require("../src/app/api/auth/register/route.js");
    const verify = require("../src/app/api/auth/verify-email/route.js");
    const reg = await register.POST(fakeReq({ name: "V", email: "v@x.com", password: "mypass1" }, { "x-forwarded-for": IP_A }));
    const { secret } = cookieOf(reg);
    const res = await verify.POST(fakeReq({ token: s.sentVerification[0].token }, { cookie: `other=1; tf_reg_bind=${secret}` }));
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.autoLoginToken);
    assert.ok(!body.requiresPasswordSetup);
    assert.strictEqual(s.db.users[0].passwordHash, "H(mypass1)");
    assert.strictEqual(s.db.users[0].emailVerified, true);
  });

  await test("PRE-HIJACK: attacker registers victim's email; victim verifies elsewhere -> attacker's password is dead, no auto-login", async () => {
    const s = setup();
    const register = require("../src/app/api/auth/register/route.js");
    const verify = require("../src/app/api/auth/verify-email/route.js");
    const reset = require("../src/app/api/auth/reset-password/route.js");
    const authorize = s.authorize();

    // Attacker registers the victim's address with a password they know.
    const reg = await register.POST(fakeReq({ name: "Mallory", email: "victim@x.com", password: "attacker-pw-1" }, { "x-forwarded-for": IP_A }));
    assert.strictEqual(reg.status, 201);
    const token = s.sentVerification[0].token; // lands in the victim's inbox

    // Victim opens the link in THEIR browser: no binding cookie.
    const res = await verify.POST(fakeReq({ token }, { "x-forwarded-for": IP_B }));
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.requiresPasswordSetup, true);
    assert.ok(body.passwordResetToken, "victim is handed a password-setup token");
    assert.ok(!body.autoLoginToken, "no automatic sign-in");
    assert.strictEqual(s.db.AutoLoginToken.store.size, 0);

    // Account is verified, but the attacker's password no longer opens it.
    assert.strictEqual(s.db.users[0].emailVerified, true);
    assert.strictEqual(await authorize({ email: "victim@x.com", password: "attacker-pw-1" }, naReq(IP_A)), null);

    // Victim chooses their own password via the one-time token and signs in.
    const r = await reset.POST(fakeReq({ token: body.passwordResetToken, password: "victims-own-pw", confirmPassword: "victims-own-pw" }, { "x-forwarded-for": IP_B }));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(await authorize({ email: "victim@x.com", password: "attacker-pw-1" }, naReq(IP_A)), null);
    assert.ok(await authorize({ email: "victim@x.com", password: "victims-own-pw" }, naReq(IP_B)));
  });

  await test("a different browser's binding cookie, or a token with no binding, is treated as not-the-registrant", async () => {
    const s = setup({ fastBcrypt: true });
    const register = require("../src/app/api/auth/register/route.js");
    const verify = require("../src/app/api/auth/verify-email/route.js");
    await register.POST(fakeReq({ name: "V", email: "v@x.com", password: "mypass1" }, { "x-forwarded-for": IP_A }));
    const wrong = await verify.POST(fakeReq({ token: s.sentVerification[0].token }, { cookie: "tf_reg_bind=not-the-secret" }));
    assert.strictEqual((await wrong.json()).requiresPasswordSetup, true);

    const s2 = setup({ fastBcrypt: true });
    const { createVerificationToken } = require("../src/lib/verificationToken.js");
    const verify2 = require("../src/app/api/auth/verify-email/route.js");
    s2.db.users.push({ _id: oid("u50"), name: "N", email: "n@x.com", emailVerified: false, tokenVersion: 0, passwordHash: "H(x)" });
    const unbound = createVerificationToken(oid("u50"), "n@x.com", 0);
    const res = await verify2.POST(fakeReq({ token: unbound }, { cookie: "tf_reg_bind=anything" }));
    assert.strictEqual((await res.json()).requiresPasswordSetup, true);
  });

  await test("verification link is still single-use", async () => {
    const s = setup({ fastBcrypt: true });
    const register = require("../src/app/api/auth/register/route.js");
    const verify = require("../src/app/api/auth/verify-email/route.js");
    const reg = await register.POST(fakeReq({ name: "V", email: "v@x.com", password: "mypass1" }, { "x-forwarded-for": IP_A }));
    const cookie = `tf_reg_bind=${cookieOf(reg).secret}`;
    const t = s.sentVerification[0].token;
    assert.strictEqual((await verify.POST(fakeReq({ token: t }, { cookie }))).status, 200);
    assert.strictEqual((await verify.POST(fakeReq({ token: t }, { cookie }))).status, 400);
  });

  await test("resend-verification binds to the requesting browser's cookie when present, otherwise issues an unbound token", async () => {
    const s = setup({ fastBcrypt: true });
    const resend = require("../src/app/api/auth/resend-verification/route.js");
    s.db.users.push({ _id: oid("u60"), name: "R", email: "r@x.com", emailVerified: false, tokenVersion: 0, passwordHash: "H(x)" });
    await resend.POST(fakeReq({ email: "r@x.com" }, { "x-forwarded-for": IP_A, cookie: "tf_reg_bind=abc123" }));
    await resend.POST(fakeReq({ email: "r@x.com" }, { "x-forwarded-for": IP_B }));
    const jwt = require("jsonwebtoken");
    assert.strictEqual(jwt.decode(s.sentVerification[0].token).bind, crypto.createHash("sha256").update("abc123").digest("hex"));
    assert.strictEqual(jwt.decode(s.sentVerification[1].token).bind, undefined);
  });

  // ---------------------------------------------------------------
  console.log("\nM2 — sessions revoked after password reset");
  await test("jwt callback: valid until reset; after reset the old token is rejected; new login works", async () => {
    const s = setup();
    const register = require("../src/app/api/auth/register/route.js");
    const verify = require("../src/app/api/auth/verify-email/route.js");
    const reset = require("../src/app/api/auth/reset-password/route.js");
    const { createPasswordResetToken } = require("../src/lib/passwordResetToken.js");
    const reg = await register.POST(fakeReq({ name: "S", email: "s@x.com", password: "first-pass" }, { "x-forwarded-for": IP_A }));
    await verify.POST(fakeReq({ token: s.sentVerification[0].token }, { cookie: `tf_reg_bind=${cookieOf(reg).secret}` }));
    const authorize = s.authorize();
    const { authOptions } = require("../src/lib/auth.js");

    // Sign in on two devices.
    const u1 = await authorize({ email: "s@x.com", password: "first-pass" }, naReq(IP_A));
    const u2 = await authorize({ email: "s@x.com", password: "first-pass" }, naReq(IP_B));
    const tok1 = await authOptions.callbacks.jwt({ token: {}, user: u1 });
    const tok2 = await authOptions.callbacks.jwt({ token: {}, user: u2 });
    assert.strictEqual(typeof tok1.tv, "number");
    assert.ok(await authOptions.callbacks.jwt({ token: { ...tok1 } }), "valid before reset");

    // Password reset.
    const rt = await createPasswordResetToken(s.db.users[0]._id);
    const r = await reset.POST(fakeReq({ token: rt, password: "second-pass", confirmPassword: "second-pass" }, { "x-forwarded-for": IP_A }));
    assert.strictEqual(r.status, 200);

    await assert.rejects(() => authOptions.callbacks.jwt({ token: { ...tok1 } }), /SessionRevoked/);
    await assert.rejects(() => authOptions.callbacks.jwt({ token: { ...tok2 } }), /SessionRevoked/);

    // Old password dead, new one works, and a fresh session is valid.
    assert.strictEqual(await authorize({ email: "s@x.com", password: "first-pass" }, naReq(IP_A)), null);
    const fresh = await authorize({ email: "s@x.com", password: "second-pass" }, naReq(IP_A));
    assert.ok(fresh);
    const tok3 = await authOptions.callbacks.jwt({ token: {}, user: fresh });
    assert.ok(await authOptions.callbacks.jwt({ token: { ...tok3 } }));
  });

  await test("jwt callback rejects tokens with no version stamp, and tokens for deleted users", async () => {
    const s = setup();
    s.db.users.push({ _id: oid("u7"), name: "L", email: "l@x.com", emailVerified: true, tokenVersion: 3, passwordHash: "x" });
    const { authOptions } = require("../src/lib/auth.js");
    await assert.rejects(() => authOptions.callbacks.jwt({ token: { id: oid("u7") } }), /SessionInvalid/);
    await assert.rejects(() => authOptions.callbacks.jwt({ token: { id: "ghost", tv: 0 } }), /SessionRevoked/);
    assert.ok(await authOptions.callbacks.jwt({ token: { id: oid("u7"), tv: 3 } }));
  });

  await test("a legacy user document with no tokenVersion field still signs in and keeps a valid session", async () => {
    const s = setup();
    s.db.users.push({ _id: oid("u8"), name: "Old", email: "old@x.com", emailVerified: true, passwordHash: realBcrypt.hashSync("legacy-pw", 4) });
    delete s.db.users[0].tokenVersion;
    const { authOptions } = require("../src/lib/auth.js");
    const user = await s.authorize()({ email: "old@x.com", password: "legacy-pw" }, naReq(IP_A));
    const tok = await authOptions.callbacks.jwt({ token: {}, user });
    assert.ok(await authOptions.callbacks.jwt({ token: { ...tok } }));
  });

  // ---------------------------------------------------------------
  console.log("\nM3 — login throttling cannot be used to lock a victim out");
  const VICTIM = { _id: oid("v1"), name: "Vic", email: "vic@x.com", emailVerified: true, tokenVersion: 0, passwordHash: "H(right-pass)" };
  await test("attacker exhausting their own budget does not block the victim from another IP", async () => {
    const s = setup({ fastBcrypt: true });
    s.db.users.push({ ...VICTIM });
    const authorize = s.authorize();
    for (let i = 0; i < 10; i++) assert.strictEqual(await authorize({ email: "vic@x.com", password: "guess" + i }, naReq(IP_A)), null);
    await assert.rejects(() => authorize({ email: "vic@x.com", password: "guess-x" }, naReq(IP_A)), /TooManyAttempts/);
    assert.ok(await authorize({ email: "vic@x.com", password: "right-pass" }, naReq(IP_B)), "victim signs in from their own IP");
  });

  await test("requests stopped at the IP/pair level never move the per-email counter", async () => {
    const s = setup({ fastBcrypt: true });
    s.db.users.push({ ...VICTIM });
    const authorize = s.authorize();
    for (let i = 0; i < 200; i++) {
      try { await authorize({ email: "vic@x.com", password: "g" + i }, naReq(IP_A)); } catch { /* limited */ }
    }
    const emailCounter = s.rl.__store.get(`login:email:${require("../src/lib/rateLimitKey.js").emailRateLimitKey("vic@x.com")}`) /* L2: keys hold a digest, not the address */;
    assert.ok(emailCounter.count <= 10, `per-email counter only saw the ${emailCounter.count} requests that passed the gates`);
    assert.ok(await authorize({ email: "vic@x.com", password: "right-pass" }, naReq(IP_B)));
  });

  await test("one IP spraying many accounts is still stopped (per-IP limit kept)", async () => {
    const s = setup({ fastBcrypt: true });
    const authorize = s.authorize();
    let blockedAt = null;
    for (let i = 0; i < 40 && blockedAt === null; i++) {
      try { await authorize({ email: `u${i}@x.com`, password: "g" }, naReq(IP_A)); } catch { blockedAt = i + 1; }
    }
    assert.strictEqual(blockedAt, 31);
  });

  await test("brute force from one source is still capped at 10 attempts per account", async () => {
    const s = setup({ fastBcrypt: true });
    s.db.users.push({ ...VICTIM });
    const authorize = s.authorize();
    for (let i = 0; i < 10; i++) await authorize({ email: "vic@x.com", password: "g" + i }, naReq(IP_A));
    await assert.rejects(() => authorize({ email: "vic@x.com", password: "right-pass" }, naReq(IP_A)), /TooManyAttempts/);
  });

  await test("a successful sign-in clears that user's failed-attempt counter for the IP", async () => {
    const s = setup({ fastBcrypt: true });
    s.db.users.push({ ...VICTIM });
    const authorize = s.authorize();
    for (let i = 0; i < 9; i++) await authorize({ email: "vic@x.com", password: "typo" + i }, naReq(IP_A));
    assert.ok(await authorize({ email: "vic@x.com", password: "right-pass" }, naReq(IP_A)));
    for (let i = 0; i < 9; i++) assert.strictEqual(await authorize({ email: "vic@x.com", password: "typo" + i }, naReq(IP_A)), null);
  });

  await test("distributed guessing across many IPs trips the per-email backstop (documented residual limit)", async () => {
    const s = setup({ fastBcrypt: true });
    s.db.users.push({ ...VICTIM });
    const authorize = s.authorize();
    let tripped = false;
    for (let ip = 1; ip <= 8 && !tripped; ip++) {
      for (let i = 0; i < 10 && !tripped; i++) {
        try { await authorize({ email: "vic@x.com", password: "g" }, naReq(`10.9.0.${ip}`)); } catch (e) { tripped = /TooManyAttempts/.test(e.message); }
      }
    }
    assert.ok(tripped, "needs more than 5 distinct IPs (50 attempts) to trip");
  });

  await test("limits don't depend on the account existing (no enumeration signal)", async () => {
    const s = setup({ fastBcrypt: true });
    const authorize = s.authorize();
    for (let i = 0; i < 10; i++) assert.strictEqual(await authorize({ email: "nobody@x.com", password: "g" + i }, naReq(IP_A)), null);
    await assert.rejects(() => authorize({ email: "nobody@x.com", password: "g" }, naReq(IP_A)), /TooManyAttempts/);
  });

  await test("untrusted/unknown IP falls back to the previous email-only limit (10)", async () => {
    const s = setup({ fastBcrypt: true });
    s.db.users.push({ ...VICTIM });
    const authorize = s.authorize();
    for (let i = 0; i < 10; i++) await authorize({ email: "vic@x.com", password: "g" + i }, naReq(null));
    await assert.rejects(() => authorize({ email: "vic@x.com", password: "right-pass" }, naReq(null)), /TooManyAttempts/);
  });

  // ---------------------------------------------------------------
  console.log("\nM4 — team add-member: no enumeration, no forced membership");
  function teamSetup() {
    const s = setup({ mockAuth: true, fastBcrypt: true });
    s.db.users.push(
      { _id: oid("m1"), name: "Manager", email: "boss@x.com", emailVerified: true },
      { _id: oid("e1"), name: "Existing", email: "exists@x.com", emailVerified: true },
      { _id: oid("o1"), name: "Other", email: "other@x.com", emailVerified: true },
    );
    s.db.teams.push({ _id: oid("t1"), name: "Core", manager: oid("m1"), members: [oid("m1")] });
    s.state.session = { user: { id: oid("m1") } };
    return s;
  }
  const params = (id) => ({ params: Promise.resolve({ id }) });

  await test("existing and unknown emails get an identical response; existing account is NOT added", async () => {
    const s = teamSetup();
    const members = require("../src/app/api/teams/[id]/members/route.js");
    const a = await members.POST(fakeReq({ email: "exists@x.com" }), params(oid("t1")));
    const b = await members.POST(fakeReq({ email: "stranger@x.com" }), params(oid("t1")));
    assert.strictEqual(a.status, 201);
    assert.strictEqual(b.status, 201);
    const [ja, jb] = [await a.json(), await b.json()];
    assert.deepStrictEqual(Object.keys(ja), Object.keys(jb));
    assert.strictEqual(ja.status, "invited");
    assert.strictEqual(jb.status, "invited");
    assert.deepStrictEqual(s.db.teams[0].members, [oid("m1")], "no one was added");
    assert.strictEqual(s.db.invitations.length, 2);
    assert.strictEqual(s.sentInvites.length, 2, "both are emailed");
  });

  await test("existing user sees only their own invitation, can accept it, and then is a member", async () => {
    const s = teamSetup();
    const members = require("../src/app/api/teams/[id]/members/route.js");
    const list = require("../src/app/api/invitations/route.js");
    const one = require("../src/app/api/invitations/[id]/route.js");
    await members.POST(fakeReq({ email: "exists@x.com" }), params(oid("t1")));
    const invId = s.db.invitations[0]._id;

    s.state.session = { user: { id: oid("o1") } };
    assert.deepStrictEqual(await (await list.GET()).json(), [], "someone else sees nothing");
    assert.strictEqual((await one.POST(fakeReq({}), params(invId))).status, 404, "someone else can't accept it");
    assert.strictEqual((await one.DELETE(fakeReq({}), params(invId))).status, 404, "or decline it");

    s.state.session = { user: { id: oid("e1") } };
    const mine = await (await list.GET()).json();
    assert.strictEqual(mine.length, 1);
    assert.deepStrictEqual(Object.keys(mine[0]).sort(), ["createdAt", "id", "inviterName", "teamName"]);
    assert.strictEqual(mine[0].teamName, "Core");
    const acc = await one.POST(fakeReq({}), params(invId));
    assert.strictEqual(acc.status, 200);
    assert.deepStrictEqual(s.db.teams[0].members, [oid("m1"), oid("e1")]);
    assert.strictEqual(s.db.invitations.length, 0);
    assert.strictEqual((await one.POST(fakeReq({}), params(invId))).status, 404, "single use");
  });

  await test("declining removes the invitation without joining; expired invitations can't be accepted", async () => {
    const s = teamSetup();
    const members = require("../src/app/api/teams/[id]/members/route.js");
    const one = require("../src/app/api/invitations/[id]/route.js");
    await members.POST(fakeReq({ email: "exists@x.com" }), params(oid("t1")));
    s.state.session = { user: { id: oid("e1") } };
    assert.strictEqual((await one.DELETE(fakeReq({}), params(s.db.invitations[0]._id))).status, 200);
    assert.deepStrictEqual(s.db.teams[0].members, [oid("m1")]);

    s.state.session = { user: { id: oid("m1") } };
    await members.POST(fakeReq({ email: "exists@x.com" }), params(oid("t1")));
    s.db.invitations[0].expiresAt = new Date(Date.now() - 1000);
    s.state.session = { user: { id: oid("e1") } };
    assert.strictEqual((await one.POST(fakeReq({}), params(s.db.invitations[0]._id))).status, 404);
    assert.deepStrictEqual(s.db.teams[0].members, [oid("m1")]);
  });

  await test("only the manager can invite; duplicate invite and existing member still 409; unauthenticated 401", async () => {
    const s = teamSetup();
    const members = require("../src/app/api/teams/[id]/members/route.js");
    s.state.session = { user: { id: oid("o1") } };
    assert.strictEqual((await members.POST(fakeReq({ email: "x@y.com" }), params(oid("t1")))).status, 403);
    s.state.session = null;
    assert.strictEqual((await members.POST(fakeReq({ email: "x@y.com" }), params(oid("t1")))).status, 401);
    s.state.session = { user: { id: oid("m1") } };
    assert.strictEqual((await members.POST(fakeReq({ email: "x@y.com" }), params(oid("t1")))).status, 201);
    assert.strictEqual((await members.POST(fakeReq({ email: "x@y.com" }), params(oid("t1")))).status, 409);
    assert.strictEqual((await members.POST(fakeReq({ email: "boss@x.com" }), params(oid("t1")))).status, 409);
  });

  await test("invitation emails are rate limited for existing-account addresses too", async () => {
    const s = teamSetup();
    const members = require("../src/app/api/teams/[id]/members/route.js");
    let limited = 0;
    for (let i = 0; i < 35; i++) {
      const r = await members.POST(fakeReq({ email: `p${i}@x.com` }), params(oid("t1")));
      if (r.status === 429) limited++;
    }
    assert.strictEqual(limited, 5);
  });

  await test("registering with an invited address still joins the team automatically (unchanged)", async () => {
    const s = teamSetup();
    const members = require("../src/app/api/teams/[id]/members/route.js");
    const register = require("../src/app/api/auth/register/route.js");
    await members.POST(fakeReq({ email: "newbie@x.com" }), params(oid("t1")));
    await register.POST(fakeReq({ name: "N", email: "newbie@x.com", password: "newbie-pw" }, { "x-forwarded-for": IP_A }));
    assert.ok(s.db.teams[0].members.includes(s.db.users.find((u) => u.email === "newbie@x.com")._id), "new account joined via invitation");
    assert.strictEqual(s.db.invitations.length, 0);
  });

  // ---------------------------------------------------------------
  console.log("\nM6 — security headers");
  const { buildCsp, generateNonce } = require("../src/lib/csp.js");
  await test("CSP: nonce + strict-dynamic, no unsafe-inline/eval for scripts, frames and objects blocked", () => {
    const csp = buildCsp("abc123", { isDev: false });
    const dir = (n) => csp.split("; ").find((d) => d.startsWith(n + " ")) || "";
    assert.match(dir("script-src"), /'nonce-abc123'/);
    assert.match(dir("script-src"), /'strict-dynamic'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(dir("script-src")));
    assert.match(dir("style-src-elem"), /'nonce-abc123'/);
    assert.ok(!/unsafe-inline/.test(dir("style-src-elem")));
    assert.strictEqual(dir("frame-ancestors"), "frame-ancestors 'none'");
    assert.strictEqual(dir("object-src"), "object-src 'none'");
    assert.match(dir("base-uri"), /'self'/);
    assert.match(dir("form-action"), /'self'/);
    assert.match(dir("font-src"), /fonts\.gstatic\.com/);
    assert.match(dir("style-src-elem"), /fonts\.googleapis\.com/);
    assert.ok(csp.includes("upgrade-insecure-requests"));
  });
  await test("CSP: dev adds unsafe-eval and drops upgrade-insecure-requests; nonces are unique", () => {
    const dev = buildCsp("n", { isDev: true });
    assert.match(dev, /'unsafe-eval'/);
    assert.ok(!dev.includes("upgrade-insecure-requests"));
    assert.notStrictEqual(generateNonce(), generateNonce());
  });
  await test("middleware puts the CSP on the response AND the request (so Next can stamp its own scripts)", () => {
    const { NextRequest } = require("next/server");
    const { middleware } = require("../src/middleware.js");
    const res = middleware(new NextRequest("http://localhost/login"));
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp);
    const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    const overridden = res.headers.get("x-middleware-override-headers") || "";
    assert.match(overridden, /x-nonce/);
    assert.match(overridden, /content-security-policy/);
    assert.strictEqual(res.headers.get("x-middleware-request-x-nonce"), nonce);
  });
  await test("static headers: nosniff, frame deny, referrer policy, permissions policy; HSTS only in production; API CSP", async () => {
    const load = async (env) => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = env;
      delete require.cache[require.resolve("../next.config.js")];
      const cfg = require("../next.config.js");
      process.env.NODE_ENV = prev;
      const rules = await cfg.headers();
      return Object.fromEntries(rules.find((r) => r.source === "/:path*").headers.map((h) => [h.key, h.value]));
    };
    const prod = await load("production");
    assert.strictEqual(prod["X-Content-Type-Options"], "nosniff");
    assert.strictEqual(prod["X-Frame-Options"], "DENY");
    assert.strictEqual(prod["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.match(prod["Permissions-Policy"], /camera=\(\)/);
    assert.match(prod["Strict-Transport-Security"], /max-age=31536000/);
    const dev = await load("development");
    assert.strictEqual(dev["Strict-Transport-Security"], undefined);
    const rules = await require("../next.config.js").headers();
    assert.ok(rules.find((r) => r.source === "/api/:path*").headers[0].value.includes("default-src 'none'"));
  });
  await test("layout stamps the nonce on the theme script and style tags; Emotion cache gets it too", () => {
    const fs = require("fs");
    const layout = fs.readFileSync(require.resolve("../src/app/layout.jsx"), "utf8");
    assert.match(layout, /<script nonce=\{nonce\}/);
    assert.match(layout, /<style id="brand-tokens" nonce=\{nonce\}/);
    const registry = fs.readFileSync(require.resolve("../src/components/ThemeRegistry.jsx"), "utf8");
    assert.match(registry, /createCache\(\{ key: "mui", nonce \}\)/);
  });

  summary();
})();
