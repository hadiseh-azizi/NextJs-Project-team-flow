require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");
const { makeDb, oid } = require("./fakeAuthDb.cjs");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Performance fixes H1 (jwt callback no longer queries the database on every
// call) and H2 (project counts and dashboard data computed in the database).
//
// What this file can and cannot show: the real route/lib files run against
// in-memory fakes. There is no MongoDB here, so the H2 pipelines are checked
// two ways — their shape, and a small reference evaluator (below) that applies
// the pipeline's $match/$group semantics to random data and compares the
// result with the old in-Node counting. The evaluator is NOT MongoDB; it
// shows the intended semantics are equivalent, not that Mongo executes them
// identically. A real-database check needs MONGODB_TEST_URI (not run here).

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// ---------------------------------------------------------------------------
// Reference evaluator for the handful of operators the count pipelines use.
function evalExpr(expr, doc) {
  if (typeof expr === "string" && expr.startsWith("$")) return doc[expr.slice(1)];
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(e, doc));
  if (expr && typeof expr === "object" && !(expr instanceof mongoose.Types.ObjectId) && !(expr instanceof Date)) {
    const [op, arg] = Object.entries(expr)[0];
    const a = Array.isArray(arg) ? arg.map((x) => evalExpr(x, doc)) : arg;
    switch (op) {
      case "$eq": return a[0] === a[1];
      case "$ne": return a[0] !== a[1];
      case "$and": return a.every(Boolean);
      case "$cond": return a[0] ? a[1] : a[2];
      case "$ifNull": return a[0] === undefined || a[0] === null ? a[1] : a[0];
      case "$literal": return arg;
      case "$in": return a[1].some((x) => String(x) === String(a[0]));
      default: throw new Error(`reference evaluator: unsupported ${op}`);
    }
  }
  return expr;
}
function runCountPipeline(pipeline, docs) {
  const match = pipeline[0].$match;
  const ids = match.project.$in.map(String);
  const kept = docs.filter((d) => ids.includes(String(d.project)));
  const group = pipeline[1].$group;
  const out = new Map();
  for (const d of kept) {
    const key = String(d.project);
    if (!out.has(key)) {
      const row = { _id: key };
      for (const f of Object.keys(group)) if (f !== "_id") row[f] = 0;
      out.set(key, row);
    }
    const row = out.get(key);
    for (const [f, spec] of Object.entries(group)) {
      if (f === "_id") continue;
      row[f] += evalExpr(spec.$sum, d);
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Fake Task model: records every call and answers from canned data.
function makeFakeTask({ countRows = [], openRows = [], doneRows = [] } = {}) {
  const calls = { aggregate: [], find: [] };
  const Task = {
    calls,
    async aggregate(pipeline) {
      calls.aggregate.push(pipeline);
      return pipeline.some((s) => s.$group) ? countRows : openRows;
    },
    find(filter) {
      const rec = { filter, sort: null, limit: null, select: null };
      calls.find.push(rec);
      const q = {
        sort: (s) => ((rec.sort = s), q),
        limit: (n) => ((rec.limit = n), q),
        select: (s) => ((rec.select = s), q),
        lean: () => q,
        then: (res, rej) => Promise.resolve(doneRows).then(res, rej),
      };
      return q;
    },
  };
  return Task;
}

(async () => {
  // =========================================================================
  console.log("H1 — session cache (unit)");
  resetModuleCache();
  const { createSessionCache, verifySessionToken, SESSION_CACHE_TTL_MS, SESSION_CACHE_MAX_ENTRIES } =
    require("../src/lib/sessionRevocationCache.js");

  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms) => (t += ms) };
  };
  const loaderFor = (db) => {
    const fn = async (id) => {
      fn.calls++;
      if (fn.fail) throw new Error("db down");
      return db.has(id) ? { ...db.get(id) } : null;
    };
    fn.calls = 0;
    return fn;
  };

  await test("defaults are short-lived and bounded", () => {
    assert.ok(SESSION_CACHE_TTL_MS > 0 && SESSION_CACHE_TTL_MS <= 30_000, "TTL must stay a short window");
    assert.ok(SESSION_CACHE_MAX_ENTRIES > 0 && SESSION_CACHE_MAX_ENTRIES <= 10_000);
  });

  await test("entries expire exactly at the TTL", () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 1000, now: c.now });
    cache.set("u1", { tokenVersion: 2, name: "A" });
    assert.deepStrictEqual(cache.get("u1"), { tokenVersion: 2, name: "A" });
    c.advance(999);
    assert.ok(cache.get("u1"), "still fresh 1 ms before the TTL");
    c.advance(1);
    assert.strictEqual(cache.get("u1"), undefined, "gone at the TTL");
    assert.strictEqual(cache.size, 0, "an expired entry is dropped when read");
  });

  await test("set() refreshes an entry's lifetime; invalidate() and clear() remove entries", () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 1000, now: c.now });
    cache.set("u1", { tokenVersion: 0, name: "A" });
    c.advance(800);
    cache.set("u1", { tokenVersion: 1, name: "A" });
    c.advance(800);
    assert.strictEqual(cache.get("u1").tokenVersion, 1);
    cache.invalidate("u1");
    assert.strictEqual(cache.get("u1"), undefined);
    cache.set("u2", { tokenVersion: 0, name: "B" });
    cache.clear();
    assert.strictEqual(cache.size, 0);
  });

  await test("the cache cannot grow without bound; expired entries are swept before live ones are evicted", () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 1000, maxEntries: 50, now: c.now });
    for (let i = 0; i < 10_000; i++) cache.set(`u${i}`, { tokenVersion: 0, name: "x" });
    assert.ok(cache.size <= 50, `size ${cache.size}`);
    assert.ok(cache.get("u9999"), "the newest entry is kept");
    assert.strictEqual(cache.get("u0"), undefined, "the oldest is evicted");

    const small = createSessionCache({ ttlMs: 1000, maxEntries: 3, now: c.now });
    small.set("a", { tokenVersion: 0 });
    small.set("b", { tokenVersion: 0 });
    c.advance(1500); // a and b are now expired
    small.set("c", { tokenVersion: 0 });
    small.set("d", { tokenVersion: 0 });
    small.set("e", { tokenVersion: 0 }); // full of live entries only after the sweep
    assert.ok(small.get("c") && small.get("d") && small.get("e"), "live entries survive; only the expired ones were swept");
  });

  // =========================================================================
  console.log("\nH1 — verifySessionToken (cache + revocation semantics)");

  await test("a warm entry answers without touching the database", async () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 10_000, now: c.now });
    const load = loaderFor(new Map([["u1", { tokenVersion: 4, name: "Ann" }]]));
    const tok = { id: "u1", tv: 4 };
    assert.deepStrictEqual(await verifySessionToken(tok, load, cache), { name: "Ann" });
    for (let i = 0; i < 25; i++) await verifySessionToken(tok, load, cache);
    assert.strictEqual(load.calls, 1, "26 verifications, one database read");
  });

  await test("after the TTL the next call re-reads the database (refresh)", async () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 10_000, now: c.now });
    const db = new Map([["u1", { tokenVersion: 0, name: "Ann" }]]);
    const load = loaderFor(db);
    await verifySessionToken({ id: "u1", tv: 0 }, load, cache);
    c.advance(10_001);
    db.get("u1").name = "Ann B.";
    assert.deepStrictEqual(await verifySessionToken({ id: "u1", tv: 0 }, load, cache), { name: "Ann B." });
    assert.strictEqual(load.calls, 2);
  });

  await test("revocation: once the entry is dropped or expired, the old token is rejected", async () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 10_000, now: c.now });
    const db = new Map([["u1", { tokenVersion: 0, name: "Ann" }]]);
    const load = loaderFor(db);
    const old = { id: "u1", tv: 0 };
    await verifySessionToken(old, load, cache);

    db.get("u1").tokenVersion = 1; // password reset elsewhere
    // Bounded window: until the entry goes, this process still honours it.
    assert.ok(await verifySessionToken(old, load, cache), "inside the TTL window the cached version is honoured");
    // The process that performed the reset invalidates immediately:
    cache.invalidate("u1");
    await assert.rejects(() => verifySessionToken(old, load, cache), /SessionRevoked/);

    // Other process: no invalidation, but the window ends at the TTL.
    const other = createSessionCache({ ttlMs: 10_000, now: c.now });
    db.get("u1").tokenVersion = 1;
    const tok1 = { id: "u1", tv: 1 };
    await verifySessionToken(tok1, load, other);
    db.get("u1").tokenVersion = 2;
    c.advance(10_001);
    await assert.rejects(() => verifySessionToken(tok1, load, other), /SessionRevoked/);
  });

  await test("a stale cache never rejects a valid token: a version mismatch is decided by the database", async () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 10_000, now: c.now });
    const db = new Map([["u1", { tokenVersion: 0, name: "Ann" }]]);
    const load = loaderFor(db);
    await verifySessionToken({ id: "u1", tv: 0 }, load, cache); // cached tv 0
    db.get("u1").tokenVersion = 1; // bumped in another process; person signs in again there
    assert.ok(await verifySessionToken({ id: "u1", tv: 1 }, load, cache), "new session accepted, not rejected on the stale cached 0");
    await assert.rejects(() => verifySessionToken({ id: "u1", tv: 0 }, load, cache), /SessionRevoked/);
  });

  await test("a deleted user is rejected and any cached entry is cleared", async () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 10_000, now: c.now });
    const db = new Map([["u1", { tokenVersion: 0, name: "Ann" }]]);
    const load = loaderFor(db);
    await verifySessionToken({ id: "u1", tv: 0 }, load, cache);
    cache.invalidate("u1"); // what DELETE /api/account does
    db.delete("u1");
    await assert.rejects(() => verifySessionToken({ id: "u1", tv: 0 }, load, cache), /SessionRevoked/);
    assert.strictEqual(cache.get("u1"), undefined);
    await assert.rejects(() => verifySessionToken({ id: "ghost", tv: 0 }, load, cache), /SessionRevoked/);
    assert.strictEqual(cache.get("ghost"), undefined, "misses are never cached");
  });

  await test("malformed tokens are rejected without a lookup", async () => {
    const cache = createSessionCache();
    const load = loaderFor(new Map());
    for (const bad of [undefined, {}, { id: "u1" }, { id: "u1", tv: "0" }, { tv: 0 }]) {
      await assert.rejects(() => verifySessionToken(bad, load, cache), /SessionInvalid/);
    }
    assert.strictEqual(load.calls, 0);
  });

  await test("database error: fails closed, is not cached, and an expired entry is never served", async () => {
    const c = clock();
    const cache = createSessionCache({ ttlMs: 10_000, now: c.now });
    const db = new Map([["u1", { tokenVersion: 0, name: "Ann" }]]);
    const load = loaderFor(db);

    load.fail = true;
    const origErr = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(" "));
    try {
      await assert.rejects(() => verifySessionToken({ id: "u1", tv: 0 }, load, cache), /SessionUnavailable/);
      assert.strictEqual(cache.size, 0, "a failed lookup leaves nothing behind");

      load.fail = false;
      await verifySessionToken({ id: "u1", tv: 0 }, load, cache);
      c.advance(10_001); // entry expired
      load.fail = true;
      await assert.rejects(() => verifySessionToken({ id: "u1", tv: 0 }, load, cache), /SessionUnavailable/, "expired entry is not used to ride out an outage");
    } finally {
      console.error = origErr;
    }
    assert.ok(logged.some((l) => /could not reach the database/.test(l)), "the failure is logged, not silent");

    // Inside the TTL the entry is, by design, still the answer (that is the
    // cache); outside it there is no fallback. Pin both so a change is noticed.
    load.fail = false;
    await verifySessionToken({ id: "u1", tv: 0 }, load, cache);
    load.fail = true;
    assert.ok(await verifySessionToken({ id: "u1", tv: 0 }, load, cache));
  });

  // =========================================================================
  console.log("\nH1 — wired into lib/auth.js (real jwt callback, in-memory users)");

  function authSetup() {
    resetModuleCache(); // also empties the global session cache
    const db = makeDb();
    const rl = makeFakeRateLimitModel();
    const finds = { count: 0 };
    const origFindById = db.User.findById;
    db.User.findById = (id) => {
      finds.count++;
      return origFindById(id);
    };
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rl);
    mockModule("@/models/User", db.User);
    mockModule("@/models/Team", db.Team);
    mockModule("@/models/Invitation", db.Invitation);
    mockModule("@/models/AutoLoginToken", db.AutoLoginToken);
    mockModule("@/models/PasswordResetToken", db.PasswordResetToken);
    mockModule("@/models/Project", {});
    mockModule("@/models/Task", {});
    mockModule("@/lib/mongoTransaction", { withOptionalTransaction: async (fn) => fn(null) });
    mockModule("next-auth", { getServerSession: async () => null });
    mockModule("bcryptjs", { hash: async (p) => `H(${p})`, compare: async (p, h) => h === `H(${p})` });
    return { db, finds };
  }
  const fakeReq = (body, headers = {}) => ({
    json: async () => body,
    url: "http://localhost/x",
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  });

  await test("repeated session checks after sign-in cause no user lookups; a password reset revokes at once", async () => {
    const { db, finds } = authSetup();
    db.users.push({ _id: oid("h1u"), name: "Hana", email: "h@x.com", emailVerified: true, tokenVersion: 0, passwordHash: "H(old-pass-1)" });
    const { authOptions } = require("../src/lib/auth.js");
    const reset = require("../src/app/api/auth/reset-password/route.js");
    const { createPasswordResetToken } = require("../src/lib/passwordResetToken.js");

    const tok = await authOptions.callbacks.jwt({ token: {}, user: { id: oid("h1u"), name: "Hana", tokenVersion: 0 } });
    for (let i = 0; i < 20; i++) assert.ok(await authOptions.callbacks.jwt({ token: { ...tok } }));
    assert.strictEqual(finds.count, 0, "sign-in seeds the cache; 20 session reads queried nothing");

    const rt = await createPasswordResetToken(db.users[0]._id);
    const r = await reset.POST(fakeReq({ token: rt, password: "new-pass-22", confirmPassword: "new-pass-22" }, { "x-forwarded-for": "10.9.9.9" }));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(db.users[0].tokenVersion, 1);

    await assert.rejects(() => authOptions.callbacks.jwt({ token: { ...tok } }), /SessionRevoked/, "old session dead immediately in the resetting process");
    assert.strictEqual(finds.count, 1, "exactly one lookup, to confirm against the database");
  });

  await test("jwt callback still refreshes the display name, from the same read", async () => {
    const { db, finds } = authSetup();
    db.users.push({ _id: oid("h1v"), name: "Old Name", email: "n@x.com", emailVerified: true, tokenVersion: 2, passwordHash: "x" });
    const { authOptions } = require("../src/lib/auth.js");
    const out = await authOptions.callbacks.jwt({ token: { id: oid("h1v"), tv: 2, name: "stale" } });
    assert.strictEqual(out.name, "Old Name");
    assert.strictEqual(finds.count, 1);
  });

  await test("a database failure rejects the session (fail closed) rather than passing it", async () => {
    const { db } = authSetup();
    db.User.findById = () => ({ select() { return this; }, lean() { return this; }, then: (_r, rej) => Promise.reject(new Error("Atlas unreachable")).then(_r, rej) });
    const { authOptions } = require("../src/lib/auth.js");
    const origErr = console.error;
    console.error = () => {};
    try {
      await assert.rejects(() => authOptions.callbacks.jwt({ token: { id: oid("h1w"), tv: 0 } }), /SessionUnavailable/);
    } finally {
      console.error = origErr;
    }
  });

  await test("every route that changes tokenVersion, name or existence drops the cached entry", () => {
    for (const f of [
      "src/app/api/auth/reset-password/route.js",
      "src/app/api/account/password/route.js",
      "src/app/api/auth/verify-email/route.js",
    ]) {
      assert.ok(/invalidateSessionCache\(/.test(read(f)), f);
    }
    const acct = read("src/app/api/account/route.js");
    assert.strictEqual((acct.match(/invalidateSessionCache\(/g) || []).length, 2, "rename and delete");
    // And nothing else in src writes tokenVersion without that being true:
    const writers = require("child_process")
      .execSync(`grep -rln "tokenVersion: 1" ${path.join(__dirname, "..", "src")} || true`).toString().trim().split("\n").filter(Boolean)
      .map((p) => path.relative(path.join(__dirname, ".."), p).replace(/\\/g, "/")).sort();
    assert.deepStrictEqual(writers, [
      "src/app/api/account/password/route.js",
      "src/app/api/auth/reset-password/route.js",
      "src/app/api/auth/verify-email/route.js",
    ], "a new tokenVersion writer must also invalidate the session cache");
  });

  // =========================================================================
  console.log("\nH2 — project list counts");
  resetModuleCache();

  const { projectCountsPipeline, countTasksByProjectIds } = (() => {
    const task = makeFakeTask();
    mockModule("@/models/Task", task);
    return require("../src/lib/taskCounts.js");
  })();
  const { countTasksByProject } = require("../src/lib/groupByProjectId.js");
  const { dashboardCountsPipeline, myOpenTasksPipeline, orderByProjects, OPEN_TASKS_LIMIT, DONE_TASKS_LIMIT } =
    require("../src/lib/dashboardData.js");

  await test("pipeline is a $match on the project ids then a $group — no task fields beyond completed are read", () => {
    const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const p = projectCountsPipeline(ids);
    assert.strictEqual(p.length, 2);
    assert.deepStrictEqual(p[0], { $match: { project: { $in: ids } } });
    assert.deepStrictEqual(Object.keys(p[1].$group).sort(), ["_id", "done", "total"]);
    assert.strictEqual(p[1].$group._id, "$project");
  });

  await test("aggregated counts equal the old in-Node counts on random data (reference evaluator)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let round = 0; round < 25; round++) {
      const ids = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => `p${i}`);
      const docs = [];
      for (let i = 0; i < Math.floor(rnd() * 80); i++) {
        const d = { project: [...ids, "other"][Math.floor(rnd() * (ids.length + 1))] };
        const r = rnd();
        if (r < 0.4) d.completed = true;
        else if (r < 0.8) d.completed = false; // else: field absent (legacy document)
        docs.push(d);
      }
      const old = countTasksByProject(docs.filter((d) => ids.includes(d.project)));
      const rows = runCountPipeline(projectCountsPipeline(ids), docs);
      const fresh = new Map(rows.map((r) => [String(r._id), { total: r.total, done: r.done }]));
      assert.deepStrictEqual([...fresh.keys()].sort(), [...old.keys()].sort(), "same projects have rows");
      for (const [k, v] of old) assert.deepStrictEqual(fresh.get(k), v, `round ${round} project ${k}`);
    }
  });

  await test("countTasksByProjectIds: maps rows to string keys; a project with no tasks has no row (read as 0 of 0)", async () => {
    resetModuleCache();
    const idA = new mongoose.Types.ObjectId();
    const idEmpty = new mongoose.Types.ObjectId();
    const task = makeFakeTask({ countRows: [{ _id: idA, total: 5, done: 2 }] });
    mockModule("@/models/Task", task);
    const { countTasksByProjectIds: count } = require("../src/lib/taskCounts.js");
    const { toProjectSummaryDTO } = require("../src/lib/serialize.js");
    const m = await count([idA, idEmpty]);
    assert.deepStrictEqual(m.get(String(idA)), { total: 5, done: 2 });
    assert.strictEqual(m.get(String(idEmpty)), undefined);
    const dto = toProjectSummaryDTO({ _id: idEmpty, name: "Empty", createdAt: 0, team: { _id: "t", name: "T" } }, m.get(String(idEmpty)));
    assert.deepStrictEqual(dto.progress, { total: 0, done: 0, pct: 0 });
    assert.strictEqual(task.calls.find.length, 0, "no per-task query");
  });

  await test("no projects: no database call at all and an empty Map", async () => {
    const task = makeFakeTask();
    mockModule("@/models/Task", task);
    resetModuleCache();
    mockModule("@/models/Task", task);
    const { countTasksByProjectIds: count } = require("../src/lib/taskCounts.js");
    const m = await count([]);
    assert.strictEqual(m.size, 0);
    assert.strictEqual(task.calls.aggregate.length, 0);
  });

  await test("GET /api/projects: 401 when signed out; counts only the projects the access check returned", async () => {
    resetModuleCache();
    const accessible = [
      { _id: new mongoose.Types.ObjectId(), name: "A", createdAt: new Date(0), manager: { _id: "m", name: "M", email: "e" }, team: { _id: "t", name: "T" } },
      { _id: new mongoose.Types.ObjectId(), name: "B", createdAt: new Date(0), manager: { _id: "m", name: "M", email: "e" }, team: { _id: "t", name: "T" } },
    ];
    const task = makeFakeTask({ countRows: [{ _id: accessible[0]._id, total: 4, done: 3 }] });
    const state = { session: null };
    mockModule("next-auth", { getServerSession: async () => state.session });
    mockModule("@/lib/auth", { authOptions: {} });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Task", task);
    mockModule("@/models/Project", {});
    mockModule("@/models/Team", {});
    mockModule("@/lib/authz", { isTeamManager: () => false });
    mockModule("@/lib/projectQueries", {
      TEAM_POPULATE: {}, MEMBERS_POPULATE: {},
      findAccessibleProjects: async () => accessible,
    });
    const { GET } = require("../src/app/api/projects/route.js");

    const denied = await GET();
    assert.strictEqual(denied.status, 401);
    assert.strictEqual(task.calls.aggregate.length, 0, "no query before authentication");

    state.session = { user: { id: "someone" } };
    const res = await GET();
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.map((p) => p.name), ["A", "B"], "order is the access query's order");
    assert.deepStrictEqual(body[0].progress, { total: 4, done: 3, pct: 75 });
    assert.deepStrictEqual(body[1].progress, { total: 0, done: 0, pct: 0 }, "a project with zero tasks still renders");
    assert.deepStrictEqual(task.calls.aggregate[0][0].$match.project.$in.map(String), accessible.map((p) => String(p._id)), "scoped to exactly the accessible projects");
    assert.strictEqual(task.calls.find.length, 0);

    // A user with no projects at all.
    mockModule("@/lib/projectQueries", { TEAM_POPULATE: {}, MEMBERS_POPULATE: {}, findAccessibleProjects: async () => [] });
    delete require.cache[require.resolve("../src/app/api/projects/route.js")];
    const before = task.calls.aggregate.length;
    const empty = await require("../src/app/api/projects/route.js").GET();
    assert.deepStrictEqual(await empty.json(), []);
    assert.strictEqual(task.calls.aggregate.length, before, "no projects, no task query");
  });

  // =========================================================================
  console.log("\nH2 — dashboard");

  await test("count pipeline: same totals as the old client-side counting, incl. 'my open tasks' (reference evaluator)", () => {
    const me = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let round = 0; round < 25; round++) {
      const ids = ["p0", "p1", "p2"];
      const docs = [];
      for (let i = 0; i < Math.floor(rnd() * 60); i++) {
        const d = { project: [...ids, "x"][Math.floor(rnd() * 4)] };
        const r = rnd();
        if (r < 0.4) d.completed = true; else if (r < 0.8) d.completed = false;
        const a = rnd();
        if (a < 0.3) d.assignees = [me];
        else if (a < 0.5) d.assignees = [other, me];
        else if (a < 0.8) d.assignees = [other];
        else if (a < 0.9) d.assignees = []; // else: field absent
        docs.push(d);
      }
      // Old behaviour, as OverviewStats computed it from every task.
      const inScope = docs.filter((d) => ids.includes(d.project));
      const oldDone = inScope.filter((d) => !!d.completed).length;
      const oldOpenMine = inScope.filter((d) => (d.assignees || []).some((x) => String(x) === String(me)) && !d.completed).length;

      const rows = runCountPipeline(dashboardCountsPipeline(ids, me), docs);
      assert.strictEqual(rows.reduce((s, r) => s + r.total, 0), inScope.length, "total");
      assert.strictEqual(rows.reduce((s, r) => s + r.done, 0), oldDone, "done");
      assert.strictEqual(rows.reduce((s, r) => s + r.myOpen, 0), oldOpenMine, "my open");
    }
  });

  await test("open-task pipeline: scoped to the ids and the user, sorted with undated tasks last, hard-limited, minimal fields", () => {
    const ids = [new mongoose.Types.ObjectId()];
    const me = new mongoose.Types.ObjectId();
    const p = myOpenTasksPipeline(ids, me);
    assert.deepStrictEqual(p[0].$match, { project: { $in: ids }, assignees: me, completed: { $ne: true } });
    const sortStage = p.find((s) => s.$sort).$sort;
    assert.deepStrictEqual(sortStage, { _dueKey: 1, _id: 1 });
    const key = p.find((s) => s.$addFields).$addFields._dueKey;
    assert.ok(key.$ifNull[1] instanceof Date && key.$ifNull[1].getTime() > Date.UTC(9999, 0, 1), "no due date sorts after every real date");
    assert.strictEqual(p.find((s) => s.$limit).$limit, OPEN_TASKS_LIMIT);
    assert.deepStrictEqual(Object.keys(p.find((s) => s.$project).$project).sort(), ["dueDate", "project", "title"]);
    assert.ok(p.findIndex((s) => s.$sort) < p.findIndex((s) => s.$limit), "sort before limit, so the cut is a true top-N");
  });

  function dashSetup(taskData) {
    resetModuleCache();
    const task = makeFakeTask(taskData);
    mockModule("@/models/Task", task);
    const mod = require("../src/lib/dashboardData.js");
    return { task, ...mod };
  }
  const proj = (name) => ({ _id: new mongoose.Types.ObjectId(), name });
  const ME = "aaaaaaaaaaaaaaaaaaaaaaaa";

  await test("user with no projects: empty result and no task query", async () => {
    const { task, loadDashboardData } = dashSetup({});
    const out = await loadDashboardData([], ME);
    assert.deepStrictEqual(out, { projects: [], counts: { total: 0, done: 0, open: 0 }, openTasks: [], completedTasks: [] });
    assert.strictEqual(task.calls.aggregate.length + task.calls.find.length, 0);
  });

  await test("projects with zero tasks appear with 0 of 0; totals add up across projects", async () => {
    const [a, b, c] = [proj("Alpha"), proj("Beta"), proj("Gamma")];
    const { loadDashboardData } = dashSetup({
      countRows: [{ _id: a._id, total: 10, done: 4, myOpen: 3 }, { _id: c._id, total: 2, done: 2, myOpen: 0 }],
    });
    const out = await loadDashboardData([a, b, c], ME);
    assert.deepStrictEqual(out.projects.map((p) => [p.name, p.progress]), [
      ["Alpha", { total: 10, done: 4, pct: 40 }],
      ["Beta", { total: 0, done: 0, pct: 0 }],
      ["Gamma", { total: 2, done: 2, pct: 100 }],
    ]);
    assert.deepStrictEqual(out.counts, { total: 12, done: 6, open: 3 });
  });

  await test("every query is scoped to the accessible projects only (authorization is unchanged)", async () => {
    const [a, b] = [proj("A"), proj("B")];
    const { task, loadDashboardData } = dashSetup({});
    await loadDashboardData([a, b], ME);
    const wanted = [String(a._id), String(b._id)];
    for (const pipeline of task.calls.aggregate) assert.deepStrictEqual(pipeline[0].$match.project.$in.map(String), wanted);
    assert.deepStrictEqual(task.calls.find[0].filter.project.$in.map(String), wanted);
    assert.strictEqual(task.calls.find[0].filter.completed, true);
  });

  await test("lists are bounded and minimal: completed query is sorted, limited and selects two fields", async () => {
    const [a] = [proj("A")];
    const { task, loadDashboardData } = dashSetup({});
    await loadDashboardData([a], ME);
    const f = task.calls.find[0];
    assert.strictEqual(f.limit, DONE_TASKS_LIMIT);
    assert.deepStrictEqual(f.sort, { updatedAt: -1, _id: -1 });
    assert.strictEqual(f.select, "project title");
    assert.ok(OPEN_TASKS_LIMIT > 0 && DONE_TASKS_LIMIT > 0);
  });

  await test("task items carry id, title, project and (open only) dueDate — no assignee ids, no completed flag", async () => {
    const [a, b] = [proj("Alpha"), proj("Beta")];
    const t1 = { _id: new mongoose.Types.ObjectId(), project: b._id, title: "Ship it", dueDate: new Date("2026-11-02T00:00:00Z"), assignees: [ME] };
    const t2 = { _id: new mongoose.Types.ObjectId(), project: a._id, title: "Plan", dueDate: null };
    const d1 = { _id: new mongoose.Types.ObjectId(), project: a._id, title: "Done 1" };
    const { loadDashboardData } = dashSetup({ countRows: [], openRows: [t1, t2], doneRows: [d1] });
    const out = await loadDashboardData([a, b], ME);
    assert.deepStrictEqual(out.openTasks.map((t) => Object.keys(t).sort()), [["dueDate", "id", "projectId", "projectName", "title"], ["dueDate", "id", "projectId", "projectName", "title"]]);
    assert.strictEqual(out.openTasks[0].dueDate, "2026-11-02T00:00:00.000Z");
    assert.strictEqual(out.openTasks[1].dueDate, null);
    assert.deepStrictEqual(out.openTasks.map((t) => t.projectName), ["Beta", "Alpha"], "server order (soonest due first) is preserved");
    assert.deepStrictEqual(Object.keys(out.completedTasks[0]).sort(), ["id", "projectId", "projectName", "title"]);
  });

  await test("completed tasks are laid out project by project in the page's project order, newest first within each", () => {
    const [a, b, c] = ["pa", "pb", "pc"];
    const items = [
      { project: c, n: 1 }, { project: a, n: 2 }, { project: c, n: 3 }, { project: b, n: 4 }, { project: a, n: 5 },
    ];
    assert.deepStrictEqual(orderByProjects(items, [a, b, c]).map((i) => i.n), [2, 5, 4, 1, 3]);
  });

  await test("an invalid user id yields no 'my tasks' and no crash", async () => {
    const a = proj("A");
    const { task, loadDashboardData } = dashSetup({ countRows: [{ _id: a._id, total: 3, done: 1, myOpen: 99 }] });
    const out = await loadDashboardData([a], "not-an-object-id");
    assert.deepStrictEqual(out.openTasks, []);
    const counting = task.calls.aggregate.find((p) => p.some((s) => s.$group));
    const myOpenExpr = counting[1].$group.myOpen.$sum.$cond[0].$and[1];
    assert.deepStrictEqual(myOpenExpr, { $literal: false });
    assert.strictEqual(task.calls.aggregate.length, 1, "the open-list query is skipped");
  });

  await test("payload before vs after: the old shape grows with every task, the new one is bounded", async () => {
    const projects = Array.from({ length: 20 }, (_, i) => proj(`Project ${i}`));
    const perProject = 500; // 10,000 tasks in total
    const oldPayload = projects.map((p) => ({
      id: String(p._id),
      name: p.name,
      tasks: Array.from({ length: perProject }, (_, i) => ({
        id: String(new mongoose.Types.ObjectId()),
        title: `Task number ${i} with a realistic title`,
        completed: i % 2 === 0,
        dueDate: i % 3 ? "2026-11-02T00:00:00.000Z" : null,
        assignees: [{ id: String(new mongoose.Types.ObjectId()) }],
      })),
    }));
    const oldBytes = JSON.stringify(oldPayload).length;

    const mkTask = (p, i) => ({ _id: new mongoose.Types.ObjectId(), project: p._id, title: `Task number ${i} with a realistic title`, dueDate: new Date("2026-11-02") });
    const { loadDashboardData } = dashSetup({
      countRows: projects.map((p) => ({ _id: p._id, total: perProject, done: perProject / 2, myOpen: 250 })),
      openRows: Array.from({ length: OPEN_TASKS_LIMIT }, (_, i) => mkTask(projects[i % 20], i)),
      doneRows: Array.from({ length: DONE_TASKS_LIMIT }, (_, i) => mkTask(projects[i % 20], i)),
    });
    const fresh = await loadDashboardData(projects, ME);
    const newBytes = JSON.stringify(fresh).length;
    console.log(`    payload for 20 projects x ${perProject} tasks: before ${oldBytes} bytes, after ${newBytes} bytes`);
    assert.ok(newBytes < oldBytes / 20, `${newBytes} vs ${oldBytes}`);
    assert.strictEqual(fresh.counts.total, 10_000, "true totals are still reported");
    assert.strictEqual(fresh.openTasks.length + fresh.completedTasks.length, OPEN_TASKS_LIMIT + DONE_TASKS_LIMIT);
  });

  await test("no index was added: the existing Task { project: 1 } index serves the $match", () => {
    const task = read("src/models/Task.js");
    const indexes = task.match(/TaskSchema\.index\(/g) || [];
    assert.strictEqual(indexes.length, 2, "column+order and project only");
    assert.ok(/TaskSchema\.index\(\{ project: 1 \}\)/.test(task));
  });

  summary();
})();
