require("./register.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// L17-L19 (Low-priority audit batch).
//   L17  mongodb-memory-server is NOT unused (checked below), so it stays.
//   L18  team delete / team leave / profile name / password change / account
//        deletion: authorization, cascade, and session behavior.
//   L19  lib/passwordHash.js: native bcrypt <-> bcryptjs compatibility, cost,
//        fallback, and that nothing else imports bcryptjs directly.
// The real route/lib files run against an in-memory fake of the models.

const ROOT = path.join(__dirname, "..");
const realBcryptjs = require("bcryptjs");
const oid = (n) => String(n).padStart(24, "0");

const U = { owner: oid(1), member: oid(2), other: oid(3), outsider: oid(4) };
const T = { a: oid(11), b: oid(12) }; // team A (owner), team B (other)
const P = { a1: oid(21), a2: oid(22), b1: oid(23), legacy: oid(24) };

// ---------- tiny in-memory Mongo ----------
const same = (a, b) => String(a) === String(b);
function matches(doc, f) {
  return Object.entries(f || {}).every(([k, c]) => {
    if (k === "$or") return c.some((sub) => matches(doc, sub));
    const v = doc[k];
    if (c && typeof c === "object" && !(c instanceof Date) && !Array.isArray(c)) {
      if ("$in" in c) return c.$in.some((x) => (Array.isArray(v) ? v.some((y) => same(x, y)) : same(x, v)));
      if ("$gt" in c) return v instanceof Date && v > c.$gt;
    }
    return Array.isArray(v) ? v.some((y) => same(y, c)) : same(v, c);
  });
}
function applyUpdate(d, u) {
  for (const [k, v] of Object.entries(u.$set || {})) d[k] = v;
  for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] ?? 0) + v;
  for (const [k, v] of Object.entries(u.$pull || {})) if (Array.isArray(d[k])) d[k] = d[k].filter((x) => !same(x, v));
}
const chain = (get) => {
  const q = { select: () => q, session: () => q, populate: () => q, sort: () => q, lean: () => q, then: (r, j) => Promise.resolve().then(get).then(r, j) };
  return q;
};
function model(docs) {
  const clone = (d) => (d ? JSON.parse(JSON.stringify(d), (k, v) => v) : d);
  return {
    docs,
    find: (f) => chain(() => docs.filter((d) => matches(d, f)).map(clone)),
    findOne: (f) => chain(() => clone(docs.find((d) => matches(d, f)) || null)),
    findById: (id) => chain(() => clone(docs.find((d) => same(d._id, id)) || null)),
    exists: (f) => chain(() => (docs.some((d) => matches(d, f)) ? { _id: 1 } : null)),
    countDocuments: async (f) => docs.filter((d) => matches(d, f)).length,
    async updateOne(f, u) {
      const d = docs.find((x) => matches(x, f));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(d, u);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(f, u) {
      const hit = docs.filter((x) => matches(x, f));
      hit.forEach((d) => applyUpdate(d, u));
      return { matchedCount: hit.length, modifiedCount: hit.length };
    },
    // A Query in real Mongoose (the route chains .lean()); applied on await.
    findByIdAndUpdate: (id, u) => chain(() => {
      const d = docs.find((x) => same(x._id, id));
      if (!d) return null;
      applyUpdate(d, u);
      return clone(d);
    }),
    async deleteMany(f) {
      const keep = docs.filter((d) => !matches(d, f));
      const n = docs.length - keep.length;
      docs.splice(0, docs.length, ...keep);
      return { deletedCount: n };
    },
    async deleteOne(f) {
      const i = docs.findIndex((d) => matches(d, f));
      if (i >= 0) docs.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
  };
}

function seed() {
  const hash = (pw) => realBcryptjs.hashSync(pw, 4); // fast; compare reads cost from the hash
  const users = [
    { _id: U.owner, name: "Olive Owner", email: "owner@x.com", passwordHash: hash("owner-pass-1"), tokenVersion: 0, emailVerified: true },
    { _id: U.member, name: "Mia Member", email: "member@x.com", passwordHash: hash("member-pass-1"), tokenVersion: 0, emailVerified: true },
    { _id: U.other, name: "Omar Other", email: "other@x.com", passwordHash: hash("other-pass-1"), tokenVersion: 0, emailVerified: true },
    { _id: U.outsider, name: "Ola Outsider", email: "outsider@x.com", passwordHash: hash("outsider-pass-1"), tokenVersion: 0, emailVerified: true },
  ];
  const teams = [
    { _id: T.a, name: "Alpha", manager: U.owner, members: [U.owner, U.member, U.other] },
    { _id: T.b, name: "Bravo", manager: U.other, members: [U.other, U.member] },
  ];
  const projects = [
    { _id: P.a1, name: "A1", manager: U.owner, team: T.a, members: [U.owner, U.member], editors: [U.member] },
    { _id: P.a2, name: "A2", manager: U.owner, team: T.a, members: [U.owner, U.other], editors: [] },
    { _id: P.legacy, name: "Legacy", manager: U.owner, team: T.a }, // no members field
    { _id: P.b1, name: "B1", manager: U.other, team: T.b, members: [U.other, U.member], editors: [U.member] },
  ];
  const tasks = [
    { _id: oid(31), project: P.a1, column: oid(41), assignees: [U.member, U.owner] },
    { _id: oid(32), project: P.a2, column: oid(42), assignees: [U.other] },
    { _id: oid(33), project: P.b1, column: oid(43), assignees: [U.member, U.other] },
  ];
  const columns = [
    { _id: oid(41), project: P.a1 }, { _id: oid(42), project: P.a2 }, { _id: oid(43), project: P.b1 },
  ];
  const invitations = [
    { _id: oid(51), email: "new@x.com", team: T.a, invitedBy: U.owner },
    { _id: oid(52), email: "member@x.com", team: T.b, invitedBy: U.other }, // addressed to the member
    { _id: oid(53), email: "z@x.com", team: T.b, invitedBy: U.other },
  ];
  const resetTokens = [{ _id: oid(61), userId: U.member }, { _id: oid(62), userId: U.other }];
  const autoTokens = [{ _id: oid(71), userId: U.member }];
  return { users, teams, projects, tasks, columns, invitations, resetTokens, autoTokens };
}

function setup() {
  resetModuleCache();
  const data = seed();
  const state = { session: null, limits: new Map(), limitHits: 0 };
  const M = {
    User: model(data.users), Team: model(data.teams), Project: model(data.projects), Task: model(data.tasks),
    Column: model(data.columns), Invitation: model(data.invitations),
    PasswordResetToken: model(data.resetTokens), AutoLoginToken: model(data.autoTokens),
  };
  for (const [name, m] of Object.entries(M)) mockModule(`@/models/${name}`, m);
  mockModule("next-auth", { getServerSession: async () => state.session });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/mongoTransaction", { withOptionalTransaction: async (fn) => fn(null) });
  // Real counting limiter semantics, in memory.
  mockModule("@/lib/rateLimit", {
    checkRateLimit: async (key, { max }) => {
      const n = (state.limits.get(key) || 0) + 1;
      state.limits.set(key, n);
      if (n > max) { state.limitHits++; return { limited: true, remaining: 0, retryAfterMs: 1000 }; }
      return { limited: false, remaining: max - n, retryAfterMs: 0 };
    },
    resetRateLimit: async (key) => { state.limits.delete(key); },
  });
  mockModule("bcryptjs", realBcryptjs);
  const as = (userId) => { state.session = userId ? { user: { id: userId } } : null; };
  return { data, M, state, as };
}

const req = (body, headers = {}) => ({
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error("no body"); return body; },
  url: "http://localhost/x",
});
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const snapshot = (data) => JSON.stringify(data);

(async () => {
  // ------------------------------------------------------------ L17
  console.log("L17 — mongodb-memory-server is still referenced, so it stays");
  await test("two test files require it (optional live-Mongo provider), so it is not unused", () => {
    const users = fs.readdirSync(__dirname).filter((f) => f.endsWith(".cjs") && f !== path.basename(__filename))
      .filter((f) => /require\("mongodb-memory-server"\)/.test(fs.readFileSync(path.join(__dirname, f), "utf8")));
    assert.deepStrictEqual(users.sort(), ["45-share-token-live-mongo.test.cjs", "49-hot-path-indexes-h6.test.cjs"]);
  });
  await test("it is still a devDependency, and no build/lint config mentions it", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.ok(pkg.devDependencies["mongodb-memory-server"]);
    for (const f of ["next.config.js", "eslint.config.mjs", "jsconfig.json"]) {
      assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("mongodb-memory-server"), f);
    }
  });

  // ------------------------------------------------------------ L18 team delete
  console.log("\nL18 — team delete");
  await test("a non-manager member cannot delete the team (403), nothing changes", async () => {
    const s = setup(); s.as(U.member);
    const before = snapshot(s.data);
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    const res = await DELETE(req({ confirmName: "Alpha" }), ctx(T.a));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("an outsider and a missing team get the same 403", async () => {
    const s = setup(); s.as(U.outsider);
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    assert.strictEqual((await DELETE(req({ confirmName: "Alpha" }), ctx(T.a))).status, 403);
    assert.strictEqual((await DELETE(req({ confirmName: "Alpha" }), ctx(oid(999)))).status, 403);
    assert.strictEqual((await DELETE(req({}), ctx("nope"))).status, 404);
  });
  await test("unauthenticated -> 401", async () => {
    const s = setup(); s.as(null);
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    assert.strictEqual((await DELETE(req({ confirmName: "Alpha" }), ctx(T.a))).status, 401);
  });
  await test("the manager must send the exact team name: missing, wrong, non-string, bad body -> 400, nothing deleted", async () => {
    const s = setup(); s.as(U.owner);
    const before = snapshot(s.data);
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    for (const body of [{}, { confirmName: "alpha" }, { confirmName: "Alph" }, { confirmName: 5 }, { confirmName: "Bravo" }]) {
      assert.strictEqual((await DELETE(req(body), ctx(T.a))).status, 400, JSON.stringify(body));
    }
    assert.strictEqual((await DELETE(req(undefined), ctx(T.a))).status, 400);
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("the manager's confirmed delete removes the team, its projects, columns, tasks and invitations", async () => {
    const s = setup(); s.as(U.owner);
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    const res = await DELETE(req({ confirmName: " Alpha " }), ctx(T.a));
    assert.strictEqual(res.status, 200);
    assert.ok(!s.data.teams.some((t) => t._id === T.a));
    assert.deepStrictEqual(s.data.projects.map((p) => p._id), [P.b1]);
    assert.deepStrictEqual(s.data.tasks.map((t) => t._id), [oid(33)]);
    assert.deepStrictEqual(s.data.columns.map((c) => c._id), [oid(43)]);
    assert.ok(!s.data.invitations.some((i) => i.team === T.a));
  });
  await test("no user account is deleted, and the other team is untouched", async () => {
    const s = setup(); s.as(U.owner);
    const usersBefore = snapshot(s.data.users);
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    await DELETE(req({ confirmName: "Alpha" }), ctx(T.a));
    assert.strictEqual(snapshot(s.data.users), usersBefore);
    const b = s.data.teams.find((t) => t._id === T.b);
    assert.deepStrictEqual(b.members, [U.other, U.member]);
    assert.deepStrictEqual(s.data.projects[0].members, [U.other, U.member]);
    assert.strictEqual(s.data.invitations.filter((i) => i.team === T.b).length, 2);
  });
  await test("deleting a team with no projects works", async () => {
    const s = setup(); s.as(U.other);
    s.data.projects.splice(3, 1); // remove B1
    const { DELETE } = require("../src/app/api/teams/[id]/route.js");
    assert.strictEqual((await DELETE(req({ confirmName: "Bravo" }), ctx(T.b))).status, 200);
    assert.ok(!s.data.teams.some((t) => t._id === T.b));
  });

  // ------------------------------------------------------------ L18 team leave
  console.log("\nL18 — team leave");
  await test("a member leaves: off the roster, project access, editors and assignments of THAT team only", async () => {
    const s = setup(); s.as(U.member);
    const { POST } = require("../src/app/api/teams/[id]/leave/route.js");
    assert.strictEqual((await POST(req({}), ctx(T.a))).status, 200);
    assert.deepStrictEqual(s.data.teams[0].members, [U.owner, U.other]);
    const a1 = s.data.projects.find((p) => p._id === P.a1);
    assert.deepStrictEqual(a1.members, [U.owner]);
    assert.deepStrictEqual(a1.editors, []);
    assert.deepStrictEqual(s.data.tasks[0].assignees, [U.owner]);
    // legacy project stays legacy (no members field created)
    assert.ok(!("members" in s.data.projects.find((p) => p._id === P.legacy)));
    // team B is untouched
    assert.deepStrictEqual(s.data.teams[1].members, [U.other, U.member]);
    assert.deepStrictEqual(s.data.projects.find((p) => p._id === P.b1).members, [U.other, U.member]);
    assert.deepStrictEqual(s.data.tasks[2].assignees, [U.member, U.other]);
    assert.strictEqual(s.data.users.length, 4);
  });
  await test("the manager cannot leave (400) and the team is unchanged", async () => {
    const s = setup(); s.as(U.owner);
    const before = snapshot(s.data);
    const { POST } = require("../src/app/api/teams/[id]/leave/route.js");
    const res = await POST(req({}), ctx(T.a));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /Delete the team/);
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("a non-member / missing team -> 404; unauthenticated -> 401; bad id -> 404", async () => {
    const s = setup();
    const { POST } = require("../src/app/api/teams/[id]/leave/route.js");
    s.as(U.outsider);
    assert.strictEqual((await POST(req({}), ctx(T.a))).status, 404);
    assert.strictEqual((await POST(req({}), ctx(oid(999)))).status, 404);
    assert.strictEqual((await POST(req({}), ctx("zzz"))).status, 404);
    s.as(null);
    assert.strictEqual((await POST(req({}), ctx(T.a))).status, 401);
  });
  await test("after leaving, the user can no longer reach the team's projects (authz)", async () => {
    const s = setup(); s.as(U.member);
    const { POST } = require("../src/app/api/teams/[id]/leave/route.js");
    await POST(req({}), ctx(T.a));
    const { projectAccessFor } = require("../src/lib/authz.js");
    const proj = { ...s.data.projects[0], team: s.data.teams[0] };
    assert.strictEqual(projectAccessFor(proj, U.member).allowed, false);
    const legacy = { ...s.data.projects[2], team: s.data.teams[0] };
    assert.strictEqual(projectAccessFor(legacy, U.member).allowed, false);
  });
  await test("the manager's remove-member route still works through the shared helper", async () => {
    const s = setup(); s.as(U.owner);
    mockModule("@/lib/authz", { isTeamManager: (t, u) => String(t.manager) === String(u) });
    mockModule("@/lib/email", { sendTeamInviteEmail: async () => {} });
    const { DELETE } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await DELETE({ url: `http://localhost/x?userId=${U.member}`, headers: { get: () => null } }, ctx(T.a));
    assert.strictEqual(res.status, 200, JSON.stringify(await res.clone().json().catch(() => null)));
    assert.deepStrictEqual(s.data.tasks[0].assignees, [U.owner]);
    assert.deepStrictEqual(s.data.projects[0].editors, []);
  });

  // ------------------------------------------------------------ L18 profile
  console.log("\nL18 — profile (name only)");
  await test("PATCH /api/account updates only the signed-in user's name", async () => {
    const s = setup(); s.as(U.member);
    const { PATCH } = require("../src/app/api/account/route.js");
    const res = await PATCH(req({ name: "  Mia M.  ", email: "evil@x.com", _id: U.owner, passwordHash: "x" }));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { name: "Mia M.", email: "member@x.com" });
    const mem = s.data.users.find((u) => u._id === U.member);
    assert.strictEqual(mem.email, "member@x.com");
    assert.notStrictEqual(mem.passwordHash, "x");
    assert.strictEqual(s.data.users.find((u) => u._id === U.owner).name, "Olive Owner");
  });
  await test("empty, whitespace, over-long and non-string names -> 400; unauthenticated -> 401", async () => {
    const s = setup(); s.as(U.member);
    const { PATCH } = require("../src/app/api/account/route.js");
    for (const name of ["", "   ", "x".repeat(101), 5, null, undefined]) {
      assert.strictEqual((await PATCH(req({ name }))).status, 400, String(name));
    }
    assert.strictEqual((await PATCH(req(undefined))).status, 400);
    s.as(null);
    assert.strictEqual((await PATCH(req({ name: "A" }))).status, 401);
  });
  await test("a new name reaches the session: the jwt callback refreshes token.name from the database", async () => {
    const s = setup(); s.as(U.member);
    const { PATCH } = require("../src/app/api/account/route.js");
    assert.strictEqual((await PATCH(req({ name: "Renamed" }))).status, 200);
    const { authOptions } = require("../src/lib/auth.js");
    const token = await authOptions.callbacks.jwt({ token: { id: U.member, tv: 0, name: "Mia Member" } });
    assert.strictEqual(token.name, "Renamed");
  });

  // ------------------------------------------------------------ L18 password
  console.log("\nL18 — password change");
  const CHANGE = () => require("../src/app/api/account/password/route.js").POST;
  await test("wrong current password -> 400; hash, sessions and tokens unchanged", async () => {
    const s = setup(); s.as(U.member);
    const before = snapshot(s.data);
    const res = await CHANGE()(req({ currentPassword: "nope-nope", newPassword: "brand-new-pass" }));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /Current password is incorrect/);
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("the new password must pass the shared policy (too short, over 72 bytes)", async () => {
    const s = setup(); s.as(U.member);
    const before = snapshot(s.data);
    for (const newPassword of ["abc", "密".repeat(25), "a".repeat(73), "", undefined, 12345678]) {
      assert.strictEqual((await CHANGE()(req({ currentPassword: "member-pass-1", newPassword }))).status, 400, String(newPassword).slice(0, 8));
    }
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("new password equal to the current one is refused", async () => {
    const s = setup(); s.as(U.member);
    const res = await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "member-pass-1" }));
    assert.strictEqual(res.status, 400);
  });
  await test("missing/non-string current password -> 400; unauthenticated -> 401", async () => {
    const s = setup(); s.as(U.member);
    assert.strictEqual((await CHANGE()(req({ newPassword: "brand-new-pass" }))).status, 400);
    assert.strictEqual((await CHANGE()(req({ currentPassword: 5, newPassword: "brand-new-pass" }))).status, 400);
    s.as(null);
    assert.strictEqual((await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "brand-new-pass" }))).status, 401);
  });
  await test("success: new hash works, old doesn't, tokenVersion +1, only this user's reset/auto-login tokens deleted", async () => {
    const s = setup(); s.as(U.member);
    const res = await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "brand-new-pass" }));
    assert.strictEqual(res.status, 200);
    const u = s.data.users.find((x) => x._id === U.member);
    assert.ok(await realBcryptjs.compare("brand-new-pass", u.passwordHash));
    assert.ok(!(await realBcryptjs.compare("member-pass-1", u.passwordHash)));
    assert.strictEqual(u.tokenVersion, 1);
    assert.deepStrictEqual(s.data.resetTokens.map((t) => t.userId), [U.other]);
    assert.strictEqual(s.data.autoTokens.length, 0);
    assert.strictEqual(s.data.users.find((x) => x._id === U.other).tokenVersion, 0);
  });
  await test("existing sessions are revoked: the old token fails, a fresh sign-in token passes", async () => {
    const s = setup(); s.as(U.member);
    const { authOptions } = require("../src/lib/auth.js");
    const old = { id: U.member, tv: 0 };
    assert.ok(await authOptions.callbacks.jwt({ token: { ...old } })); // valid before
    await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "brand-new-pass" }));
    await assert.rejects(() => authOptions.callbacks.jwt({ token: { ...old } }), /SessionRevoked/);
    assert.ok(await authOptions.callbacks.jwt({ token: { id: U.member, tv: 1 } }));
  });
  await test("login works with the new password and not the old one (real authorize())", async () => {
    const s = setup(); s.as(U.member);
    await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "brand-new-pass" }));
    const authorize = require("../src/lib/auth.js").authOptions.providers[0].options.authorize;
    const r = { headers: { "x-forwarded-for": "9.9.9.9" } };
    assert.strictEqual(await authorize({ email: "member@x.com", password: "member-pass-1" }, r), null);
    const ok = await authorize({ email: "member@x.com", password: "brand-new-pass" }, r);
    assert.strictEqual(ok.id, U.member);
    assert.strictEqual(ok.tokenVersion, 1);
  });
  await test("wrong current passwords are rate limited per user (429 after 10), and a correct one clears the count", async () => {
    const s = setup(); s.as(U.member);
    for (let i = 0; i < 10; i++) assert.strictEqual((await CHANGE()(req({ currentPassword: "bad-bad-bad", newPassword: "brand-new-pass" }))).status, 400);
    const limited = await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "brand-new-pass" }));
    assert.strictEqual(limited.status, 429);
    assert.ok(limited.headers.get("Retry-After"));
    const s2 = setup(); s2.as(U.member);
    for (let i = 0; i < 9; i++) await CHANGE()(req({ currentPassword: "bad-bad-bad", newPassword: "brand-new-pass" }));
    assert.strictEqual((await CHANGE()(req({ currentPassword: "member-pass-1", newPassword: "brand-new-pass" }))).status, 200);
    assert.ok(![...s2.state.limits.keys()].some((k) => k.includes(U.member)), "counter cleared on success");
  });
  await test("the password-reset flow is untouched: its route still resets a password via a valid token", async () => {
    const s = setup();
    mockModule("@/lib/passwordResetToken", {
      peekPasswordResetToken: async () => true,
      takePasswordResetToken: async () => ({ userId: U.owner }),
      restorePasswordResetToken: async () => {},
    });
    const { POST } = require("../src/app/api/auth/reset-password/route.js");
    const res = await POST(req({ token: "t", password: "after-reset-pw", confirmPassword: "after-reset-pw" }, { "x-forwarded-for": "8.8.8.8" }));
    assert.strictEqual(res.status, 200);
    const u = s.data.users.find((x) => x._id === U.owner);
    assert.ok(await realBcryptjs.compare("after-reset-pw", u.passwordHash));
    assert.strictEqual(u.tokenVersion, 1);
  });

  // ------------------------------------------------------------ L18 account deletion
  console.log("\nL18 — account deletion");
  const DEL = () => require("../src/app/api/account/route.js").DELETE;
  await test("unauthenticated -> 401; wrong password -> 400; wrong/missing email confirmation -> 400; nothing deleted", async () => {
    const s = setup();
    s.as(null);
    assert.strictEqual((await DEL()(req({ password: "member-pass-1", confirmEmail: "member@x.com" }))).status, 401);
    s.as(U.member);
    const before = snapshot(s.data);
    assert.strictEqual((await DEL()(req({ password: "wrong-wrong", confirmEmail: "member@x.com" }))).status, 400);
    assert.strictEqual((await DEL()(req({ password: "member-pass-1", confirmEmail: "other@x.com" }))).status, 400);
    assert.strictEqual((await DEL()(req({ password: "member-pass-1" }))).status, 400);
    assert.strictEqual((await DEL()(req({ confirmEmail: "member@x.com" }))).status, 400);
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("a team manager is refused (409) with the team named; the account and the team survive", async () => {
    const s = setup(); s.as(U.owner);
    const before = snapshot(s.data);
    const res = await DEL()(req({ password: "owner-pass-1", confirmEmail: "OWNER@x.com" }));
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /“Alpha”/);
    assert.strictEqual(snapshot(s.data), before);
  });
  await test("a project manager outside any managed team is refused too (no orphaned project)", async () => {
    const s = setup(); s.as(U.member);
    s.data.projects.push({ _id: oid(25), name: "Stray", manager: U.member, team: T.b, members: [] });
    const res = await DEL()(req({ password: "member-pass-1", confirmEmail: "member@x.com" }));
    assert.strictEqual(res.status, 409);
    assert.ok(s.data.users.some((u) => u._id === U.member));
  });
  await test("a plain member deletes the account: user gone, removed from every team/project/task, own tokens and invitations gone", async () => {
    const s = setup(); s.as(U.member);
    const res = await DEL()(req({ password: "member-pass-1", confirmEmail: "member@x.com" }));
    assert.strictEqual(res.status, 200);
    assert.ok(!s.data.users.some((u) => u._id === U.member));
    for (const t of s.data.teams) assert.ok(!t.members.includes(U.member));
    for (const p of s.data.projects) { assert.ok(!(p.members || []).includes(U.member)); assert.ok(!(p.editors || []).includes(U.member)); }
    for (const t of s.data.tasks) assert.ok(!t.assignees.includes(U.member));
    assert.ok(!s.data.invitations.some((i) => i.email === "member@x.com"));
    assert.deepStrictEqual(s.data.resetTokens.map((t) => t.userId), [U.other]);
    assert.strictEqual(s.data.autoTokens.length, 0);
  });
  await test("shared data of other people is untouched: teams, projects, tasks, columns, other users and invitations all remain", async () => {
    const s = setup(); s.as(U.member);
    await DEL()(req({ password: "member-pass-1", confirmEmail: "member@x.com" }));
    assert.strictEqual(s.data.teams.length, 2);
    assert.strictEqual(s.data.projects.length, 4);
    assert.strictEqual(s.data.tasks.length, 3);
    assert.strictEqual(s.data.columns.length, 3);
    assert.deepStrictEqual(s.data.users.map((u) => u._id).sort(), [U.other, U.outsider, U.owner].sort());
    assert.deepStrictEqual(s.data.tasks[1].assignees, [U.other]);
    assert.strictEqual(s.data.invitations.length, 2); // only the one addressed to the member went
    assert.strictEqual(s.data.teams.find((t) => t._id === T.a).manager, U.owner);
  });
  await test("the deleted user's old session stops working (jwt callback), and the email can register again", async () => {
    const s = setup(); s.as(U.member);
    await DEL()(req({ password: "member-pass-1", confirmEmail: "member@x.com" }));
    const { authOptions } = require("../src/lib/auth.js");
    await assert.rejects(() => authOptions.callbacks.jwt({ token: { id: U.member, tv: 0 } }), /SessionRevoked/);
    assert.ok(!s.data.users.some((u) => u.email === "member@x.com"));
  });
  await test("after deleting their team first, a former manager can delete the account", async () => {
    const s = setup(); s.as(U.owner);
    const { DELETE: delTeam } = require("../src/app/api/teams/[id]/route.js");
    assert.strictEqual((await delTeam(req({ confirmName: "Alpha" }), ctx(T.a))).status, 200);
    assert.strictEqual((await DEL()(req({ password: "owner-pass-1", confirmEmail: "owner@x.com" }))).status, 200);
    assert.ok(!s.data.users.some((u) => u._id === U.owner));
    assert.ok(s.data.teams.some((t) => t._id === T.b)); // not theirs
  });

  // ------------------------------------------------------------ L19
  console.log("\nL19 — password hashing (lib/passwordHash.js)");
  const loadWrapper = (env) => {
    resetModuleCache();
    delete require.cache[require.resolve("../src/lib/passwordHash.js")];
    if (env === undefined) delete process.env.PASSWORD_HASHER; else process.env.PASSWORD_HASHER = env;
    mockModule("bcryptjs", realBcryptjs);
    return require("../src/lib/passwordHash.js");
  };
  let nativeOk = true;
  try { require("bcrypt"); } catch { nativeOk = false; }
  await test("native bcrypt is installed and selected by default", () => {
    assert.ok(nativeOk, "bcrypt should load in this environment");
    assert.strictEqual(loadWrapper(undefined).passwordHasherName(), "bcrypt");
  });
  await test("PASSWORD_HASHER=bcryptjs forces the pure-JS library", () => {
    assert.strictEqual(loadWrapper("bcryptjs").passwordHasherName(), "bcryptjs");
  });
  await test("existing bcryptjs ($2a$, cost 12) hashes verify under native, and wrong passwords fail", async () => {
    const legacy = realBcryptjs.hashSync("pässwörd密码🔐", 12);
    assert.ok(legacy.startsWith("$2a$12$"));
    const w = loadWrapper(undefined);
    assert.strictEqual(w.passwordHasherName(), "bcrypt");
    assert.strictEqual(await w.verifyPassword("pässwörd密码🔐", legacy), true);
    assert.strictEqual(await w.verifyPassword("pässwörd密码", legacy), false);
  });
  await test("new native hashes are cost 12 and verify under bcryptjs (rollback is possible)", async () => {
    const w = loadWrapper(undefined);
    const h = await w.hashPassword("correct horse battery");
    assert.ok(/^\$2[ab]\$12\$/.test(h), h.slice(0, 7));
    assert.strictEqual(await realBcryptjs.compare("correct horse battery", h), true);
    assert.strictEqual(await realBcryptjs.compare("correct horse batterz", h), false);
    assert.strictEqual(w.BCRYPT_COST, 12);
  });
  await test("bcryptjs mode produces cost-12 hashes the native mode accepts", async () => {
    const h = await loadWrapper("bcryptjs").hashPassword("another-pass-12");
    assert.ok(h.startsWith("$2a$12$"));
    assert.strictEqual(await loadWrapper(undefined).verifyPassword("another-pass-12", h), true);
  });
  await test("embedded NUL, the 72-byte boundary and a malformed hash behave the same in both libraries", async () => {
    const nat = loadWrapper(undefined);
    const js = loadWrapper("bcryptjs");
    const nulHash = realBcryptjs.hashSync("abc\u0000def", 4);
    for (const w of [nat, js]) {
      assert.strictEqual(await w.verifyPassword("abc\u0000def", nulHash), true);
      assert.strictEqual(await w.verifyPassword("abc", nulHash), false);
      assert.strictEqual(await w.verifyPassword("x", "not-a-hash"), false);
    }
    const h72 = realBcryptjs.hashSync("a".repeat(72), 4);
    assert.strictEqual(await nat.verifyPassword("a".repeat(72), h72), true);
    assert.strictEqual(await js.verifyPassword("a".repeat(72), h72), true);
  });
  await test("the login dummy hash is accepted by native bcrypt without throwing and never matches", async () => {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/auth.js"), "utf8");
    const dummy = /DUMMY_PASSWORD_HASH = "([^"]+)"/.exec(src)[1];
    assert.ok(dummy.startsWith("$2a$12$"));
    const w = loadWrapper(undefined);
    assert.strictEqual(await w.verifyPassword("x", dummy), false);
    assert.strictEqual(await w.verifyPassword("anything at all", dummy), false);
    assert.ok(/verifyPassword\(\s*withinLimit \? credentials\.password : "x",\s*withinLimit && user\?\.passwordHash \? user\.passwordHash : DUMMY_PASSWORD_HASH/.test(src), "dummy comparison still always runs");
  });
  await test("if the native addon can't be loaded, it falls back to bcryptjs and keeps working", async () => {
    const realLoad = Module._load;
    const warn = console.warn; const warnings = [];
    console.warn = (...a) => warnings.push(a.join(" "));
    Module._load = function (request, ...rest) {
      if (request === "bcrypt") { const e = new Error("simulated: no native binary"); e.code = "MODULE_NOT_FOUND"; throw e; }
      return realLoad.call(this, request, ...rest);
    };
    try {
      const w = loadWrapper(undefined);
      assert.strictEqual(w.passwordHasherName(), "bcryptjs");
      const h = await w.hashPassword("fallback-pass-1");
      assert.ok(h.startsWith("$2a$12$"));
      assert.strictEqual(await w.verifyPassword("fallback-pass-1", h), true);
      assert.ok(warnings.some((m) => /native bcrypt unavailable/.test(m)));
    } finally { Module._load = realLoad; console.warn = warn; }
  });
  await test("the registration, reset, verify-email and login paths all go through the wrapper (cost in one place)", () => {
    const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
    const importers = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name) && /from "bcryptjs"|require\("bcryptjs"\)/.test(fs.readFileSync(p, "utf8"))) importers.push(path.relative(ROOT, p));
      }
    })(path.join(ROOT, "src"));
    assert.deepStrictEqual(importers, ["src/lib/passwordHash.js"]);
    for (const f of ["src/app/api/auth/register/route.js", "src/app/api/auth/reset-password/route.js", "src/app/api/auth/verify-email/route.js", "src/app/api/account/password/route.js"]) {
      assert.ok(rd(f).includes("hashPassword"), f);
    }
    assert.ok(rd("src/lib/auth.js").includes("verifyPassword"));
    assert.ok(!/BCRYPT_COST\s*=/.test(["src/app/api/auth/register/route.js", "src/app/api/auth/reset-password/route.js", "src/app/api/auth/verify-email/route.js"].map(rd).join("")));
  });
  await test("bcrypt is an exact-pinned optional dependency; bcryptjs and mongodb-memory-server are still present", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.strictEqual(pkg.optionalDependencies.bcrypt, "6.0.0");
    assert.ok(pkg.dependencies.bcryptjs);
    assert.ok(pkg.devDependencies["mongodb-memory-server"]);
  });

  delete process.env.PASSWORD_HASHER;
  summary();
})();
