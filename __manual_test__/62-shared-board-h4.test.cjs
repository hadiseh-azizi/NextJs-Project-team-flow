require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// H4 — public shared-board endpoint (GET /api/shared/board/[token]):
//
//   1. Rate limiting is never skipped: per trusted IP when one exists, one
//      bounded shared fallback bucket when it does not (including
//      RATE_LIMIT_TRUST_PROXY=none), and a limiter that cannot run fails
//      CLOSED (503), never open.
//   2. The response is bounded: columns, tasks, assignees, attachments,
//      description length and total bytes, with an explicit `limits` report
//      and true per-column counts instead of silent omission.
//   3. Token semantics, the read-only/public model and the no-leak DTO are
//      unchanged.
//
// Same style as the rest of __manual_test__: the real route, limiter and
// serializer are loaded unmodified; only Mongoose models and connectDB are
// replaced by in-memory fakes. This does NOT exercise a real MongoDB (TTL
// sweep, index use, aggregation execution) or a real proxy — see the H4
// notes in README.md for what still needs verification on live infrastructure.

const PROJECT_ID = "111111111111111111111111";
const GOOD_TOKEN = "good-token";
const PLATFORM_LIMIT = 4_500_000; // PLATFORM_BODY_LIMIT_BYTES, lib/attachmentPolicy.js

function fakeReq(headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return { headers: { get: (name) => lowered[name.toLowerCase()] ?? null } };
}

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

function hex24(n) {
  return n.toString(16).padStart(24, "0");
}

// Mongoose-query lookalike that honours sort/limit like the database would,
// and records what the route asked for.
function makeQuery(rows, log) {
  let sortSpec = null;
  let limitN = Infinity;
  let filterFn = () => true;
  const q = {
    __setFilter(fn) {
      filterFn = fn;
    },
    select(arg) {
      log.select = arg;
      return q;
    },
    populate() {
      return q;
    },
    sort(spec) {
      sortSpec = spec;
      log.sort = spec;
      return q;
    },
    limit(n) {
      limitN = n;
      log.limit = n;
      return q;
    },
    async lean() {
      const keys = Object.keys(sortSpec || {});
      const sorted = rows.filter(filterFn).sort((a, b) => {
        for (const k of keys) {
          const av = a[k] instanceof Date ? a[k].getTime() : a[k];
          const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
          if (av < bv) return -1;
          if (av > bv) return 1;
        }
        return 0;
      });
      return sorted.slice(0, limitN);
    },
  };
  return q;
}

// A board with `nColumns` columns and `perColumn` tasks in each.
function buildBoard({ nColumns, perColumn, completedEvery = 0, taskExtras = () => ({}) }) {
  const columns = [];
  const tasks = [];
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  let t = 1;
  for (let c = 0; c < nColumns; c++) {
    columns.push({ _id: hex24(1000 + c), project: PROJECT_ID, name: `Col ${c}`, order: c, createdAt: new Date(base + c) });
    for (let i = 0; i < perColumn; i++, t++) {
      tasks.push({
        _id: hex24(100000 + t),
        project: PROJECT_ID,
        column: hex24(1000 + c),
        title: `Task ${c}-${i}`,
        description: null,
        order: i,
        completed: completedEvery ? t % completedEvery === 0 : false,
        dueDate: null,
        color: null,
        createdAt: new Date(base + t),
        assignees: [],
        attachments: [],
        ...taskExtras(c, i, t),
      });
    }
  }
  return { columns, tasks };
}

function setupRoute({ board = { columns: [], tasks: [] }, project, rateLimitModel = makeFakeRateLimitModel(), connectDB } = {}) {
  resetModuleCache();
  const calls = { project: [], column: {}, task: {}, writes: [] };
  mockModule("@/lib/mongodb", { connectDB: connectDB || (async () => {}) });
  mockModule("@/models/RateLimitAttempt", rateLimitModel);
  const proj = project === undefined ? { _id: PROJECT_ID, name: "Launch Plan", shareEnabled: true, shareToken: GOOD_TOKEN } : project;
  mockModule("@/models/Project", {
    findOne: (filter) => {
      calls.project.push(filter);
      return { lean: async () => (proj && filter.shareToken === proj.shareToken && filter.shareEnabled === true && proj.shareEnabled ? proj : null) };
    },
    updateOne: async () => calls.writes.push("Project.updateOne"),
    findOneAndUpdate: async () => calls.writes.push("Project.findOneAndUpdate"),
  });
  mockModule("@/models/Column", {
    find: () => makeQuery(board.columns, calls.column),
    countDocuments: async () => board.columns.length,
    updateOne: async () => calls.writes.push("Column.updateOne"),
  });
  mockModule("@/models/Task", {
    find: (filter) => {
      calls.task.filter = filter;
      const allowed = new Set((filter.column?.$in || []).map(String));
      const q = makeQuery(board.tasks, calls.task);
      q.__setFilter((tk) => allowed.has(String(tk.column)));
      return q;
    },
    aggregate: async () => {
      const groups = new Map();
      for (const tk of board.tasks) {
        const g = groups.get(String(tk.column)) || { _id: tk.column, total: 0, done: 0 };
        g.total += 1;
        if (tk.completed === true) g.done += 1;
        groups.set(String(tk.column), g);
      }
      return [...groups.values()];
    },
    updateOne: async () => calls.writes.push("Task.updateOne"),
  });
  const route = require("../src/app/api/shared/board/[token]/route.js");
  return { route, calls, rateLimitModel };
}

const params = (token = GOOD_TOKEN) => ({ params: Promise.resolve({ token }) });

(async () => {
  // ------------------------------------------------------------------
  console.log("lib/rateLimit.js — failClosed mode");

  function setupLimiter({ model = makeFakeRateLimitModel(), connectDB } = {}) {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: connectDB || (async () => {}) });
    mockModule("@/models/RateLimitAttempt", model);
    return { model, ...require("../src/lib/rateLimit.js") };
  }
  const originalConsoleError = console.error;
  const quiet = async (fn) => {
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = originalConsoleError;
    }
  };

  await test("default mode still fails OPEN when the store errors (other endpoints unchanged)", async () => {
    const { model, checkRateLimit } = setupLimiter();
    model.__forceError(new Error("db down"));
    const r = await quiet(() => checkRateLimit("k", { max: 2, windowMs: 1000 }));
    assert.strictEqual(r.limited, false);
    assert.ok(!r.unavailable);
  });

  await test("failClosed: a store error is reported as unavailable, not as 'allowed'", async () => {
    const { model, checkRateLimit } = setupLimiter();
    model.__forceError(new Error("db down"));
    const r = await quiet(() => checkRateLimit("k", { max: 2, windowMs: 1000, failClosed: true }));
    assert.strictEqual(r.limited, true);
    assert.strictEqual(r.unavailable, true);
    assert.ok(r.retryAfterMs > 0);
  });

  await test("failClosed: a connectDB failure inside the limiter is reported as unavailable", async () => {
    const { checkRateLimit } = setupLimiter({
      connectDB: async () => {
        throw new Error("no connection");
      },
    });
    const r = await quiet(() => checkRateLimit("k", { max: 2, windowMs: 1000, failClosed: true }));
    assert.strictEqual(r.unavailable, true);
  });

  await test("failClosed: counting itself is unchanged (allows up to max, then limits)", async () => {
    const { checkRateLimit } = setupLimiter();
    const cfg = { max: 3, windowMs: 60000, failClosed: true };
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit("k", cfg);
      assert.strictEqual(r.limited, false);
      assert.strictEqual(r.unavailable, false);
    }
    const r = await checkRateLimit("k", cfg);
    assert.strictEqual(r.limited, true);
    assert.ok(!r.unavailable);
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/shared/board/[token] — rate limiting with a trusted client IP");

  await test("a known IP gets its own bucket: 60 requests pass, the 61st is 429 with Retry-After", async () => {
    const { route, rateLimitModel } = setupRoute();
    const req = fakeReq({ "x-forwarded-for": "203.0.113.50" });
    for (let i = 0; i < 60; i++) assert.strictEqual((await route.GET(req, params())).status, 200);
    const res = await route.GET(req, params());
    assert.strictEqual(res.status, 429);
    assert.ok(Number(res.headers.get("Retry-After")) >= 1, "429 should say when to retry");
    assert.ok(rateLimitModel.__store.has("shared-board:ip:203.0.113.50"));
    assert.ok(!rateLimitModel.__store.has("shared-board:no-ip-fallback"), "a known IP must not touch the fallback bucket");
  });

  await test("a different IP is unaffected by another IP being limited", async () => {
    const { route } = setupRoute();
    const a = fakeReq({ "x-forwarded-for": "203.0.113.1" });
    for (let i = 0; i < 61; i++) await route.GET(a, params());
    assert.strictEqual((await route.GET(a, params())).status, 429);
    assert.strictEqual((await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.2" }), params())).status, 200);
  });

  await test("limited requests never reach the project lookup", async () => {
    const { route, calls } = setupRoute();
    const req = fakeReq({ "x-forwarded-for": "203.0.113.9" });
    for (let i = 0; i < 60; i++) await route.GET(req, params());
    const before = calls.project.length;
    await route.GET(req, params());
    assert.strictEqual(calls.project.length, before);
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/shared/board/[token] — unknown client IP / RATE_LIMIT_TRUST_PROXY=none");

  await test("no forwarding header at all: request is metered against the single fallback bucket", async () => {
    const { route, rateLimitModel } = setupRoute();
    await withEnv("RATE_LIMIT_TRUST_PROXY", undefined, async () => {
      assert.strictEqual((await route.GET(fakeReq(), params())).status, 200);
    });
    assert.deepStrictEqual([...rateLimitModel.__store.keys()], ["shared-board:no-ip-fallback"]);
  });

  await test("RATE_LIMIT_TRUST_PROXY=none: spoofed x-forwarded-for / x-real-ip values are ignored and cannot create buckets", async () => {
    const { route, rateLimitModel } = setupRoute();
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", async () => {
      for (let i = 0; i < 200; i++) {
        const res = await route.GET(fakeReq({ "x-forwarded-for": `198.51.100.${i % 250}`, "x-real-ip": `192.0.2.${i % 250}` }), params());
        assert.strictEqual(res.status, 200);
      }
    });
    const keys = [...rateLimitModel.__store.keys()];
    assert.deepStrictEqual(keys, ["shared-board:no-ip-fallback"], `expected exactly one bucket, got ${keys.length}`);
    assert.strictEqual(rateLimitModel.__store.get("shared-board:no-ip-fallback").count, 200);
  });

  await test("RATE_LIMIT_TRUST_PROXY=none: the fallback bucket enforces its ceiling (600/min) with 429 + Retry-After", async () => {
    const { route } = setupRoute();
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", async () => {
      let last;
      for (let i = 0; i < 600; i++) last = (await route.GET(fakeReq({ "x-forwarded-for": `198.51.100.${i % 250}` }), params())).status;
      assert.strictEqual(last, 200);
      const res = await route.GET(fakeReq(), params());
      assert.strictEqual(res.status, 429);
      assert.ok(Number(res.headers.get("Retry-After")) >= 1);
    });
  });

  await test("a malformed forwarding header with proxy trust ON also falls back instead of skipping the limit", async () => {
    const { route, rateLimitModel } = setupRoute();
    await withEnv("RATE_LIMIT_TRUST_PROXY", "vercel", async () => {
      const res = await route.GET(fakeReq({ "x-forwarded-for": "not-an-ip; DROP TABLE" }), params());
      assert.strictEqual(res.status, 200);
    });
    assert.deepStrictEqual([...rateLimitModel.__store.keys()], ["shared-board:no-ip-fallback"]);
  });

  await test("fallback bucket expiry: window carries an expiresAt, and an expired bucket resets to a fresh count", async () => {
    const { route, rateLimitModel } = setupRoute();
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", async () => {
      const before = Date.now();
      for (let i = 0; i < 600; i++) await route.GET(fakeReq(), params());
      assert.strictEqual((await route.GET(fakeReq(), params())).status, 429);

      const doc = rateLimitModel.__store.get("shared-board:no-ip-fallback");
      const ttl = doc.expiresAt.getTime() - before;
      assert.ok(ttl > 55_000 && ttl <= 61_000, `expected a ~60s window, got ${ttl}ms`);

      // Simulate the window having elapsed (the real TTL sweep is MongoDB's job,
      // but the limiter itself must also treat a past expiresAt as a new window).
      doc.expiresAt = new Date(Date.now() - 1);
      assert.strictEqual((await route.GET(fakeReq(), params())).status, 200);
      assert.strictEqual(rateLimitModel.__store.get("shared-board:no-ip-fallback").count, 1);
    });
  });

  await test("storage is bounded: the RateLimitAttempt schema has a TTL index on expiresAt, and the fallback key is a constant", async () => {
    resetModuleCache();
    const mod = require("../src/models/RateLimitAttempt.js");
    const RateLimitAttempt = mod.default || mod;
    const ttl = RateLimitAttempt.schema.indexes().find(([fields, opts]) => fields.expiresAt === 1 && opts.expireAfterSeconds === 0);
    assert.ok(ttl, "expected TTL index { expiresAt: 1 } with expireAfterSeconds: 0");
    const src = fs.readFileSync(path.join(__dirname, "../src/app/api/shared/board/[token]/route.js"), "utf8");
    assert.ok(/const FALLBACK_BUCKET_KEY = "shared-board:no-ip-fallback";/.test(src), "fallback key must be a literal constant");
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/shared/board/[token] — limiter / infrastructure failure");

  await test("limiter store error: 503 with Retry-After (not 200, not 429), and the board is never queried", async () => {
    const model = makeFakeRateLimitModel();
    model.__forceError(new Error("db down"));
    const { route, calls } = setupRoute({ rateLimitModel: model });
    const res = await quiet(() => route.GET(fakeReq({ "x-forwarded-for": "203.0.113.7" }), params()));
    assert.strictEqual(res.status, 503);
    assert.ok(Number(res.headers.get("Retry-After")) >= 1);
    assert.strictEqual(calls.project.length, 0, "must not serve the board unmetered");
  });

  await test("limiter store error with an unknown IP is also 503 (fallback path fails closed too)", async () => {
    const model = makeFakeRateLimitModel();
    model.__forceError(new Error("db down"));
    const { route, calls } = setupRoute({ rateLimitModel: model });
    await withEnv("RATE_LIMIT_TRUST_PROXY", "none", async () => {
      const res = await quiet(() => route.GET(fakeReq(), params()));
      assert.strictEqual(res.status, 503);
    });
    assert.strictEqual(calls.project.length, 0);
  });

  await test("connectDB failure: 503, not an unmetered 200", async () => {
    const { route, calls } = setupRoute({
      connectDB: async () => {
        throw new Error("no connection");
      },
    });
    const res = await quiet(() => route.GET(fakeReq({ "x-forwarded-for": "203.0.113.8" }), params()));
    assert.strictEqual(res.status, 503);
    assert.strictEqual(calls.project.length, 0);
  });

  await test("recovery: once the store works again requests succeed normally", async () => {
    const model = makeFakeRateLimitModel();
    const { route } = setupRoute({ rateLimitModel: model });
    model.__forceError(new Error("blip"));
    await quiet(() => route.GET(fakeReq({ "x-forwarded-for": "203.0.113.20" }), params()));
    model.__clearForcedError();
    assert.strictEqual((await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.20" }), params())).status, 200);
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/shared/board/[token] — token semantics are unchanged");

  await test("malformed tokens (empty, over 200 chars) get 404 before any limiter or database work", async () => {
    const { route, calls, rateLimitModel } = setupRoute();
    for (const token of ["", "x".repeat(201)]) {
      assert.strictEqual((await route.GET(fakeReq(), params(token))).status, 404);
    }
    assert.strictEqual(calls.project.length, 0);
    assert.strictEqual(rateLimitModel.__store.size, 0);
  });

  await test("unknown, disabled and revoked tokens are indistinguishable 404s", async () => {
    const bodies = [];
    for (const [project, token] of [
      [undefined, "never-issued"],
      [{ _id: PROJECT_ID, name: "X", shareEnabled: false, shareToken: GOOD_TOKEN }, GOOD_TOKEN], // disabled
      [{ _id: PROJECT_ID, name: "X", shareEnabled: true, shareToken: "regenerated-new-token" }, GOOD_TOKEN], // old link after regenerate
      [{ _id: PROJECT_ID, name: "X", shareEnabled: true }, GOOD_TOKEN], // revoked: token cleared
    ]) {
      const { route } = setupRoute({ project });
      const res = await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.30" }), params(token));
      assert.strictEqual(res.status, 404);
      bodies.push(await res.json());
    }
    for (const b of bodies) assert.deepStrictEqual(b, bodies[0]);
  });

  await test("invalid tokens are metered too: guessing at tokens from one IP gets 429 eventually", async () => {
    const { route } = setupRoute();
    const req = fakeReq({ "x-forwarded-for": "203.0.113.31" });
    let last;
    for (let i = 0; i < 61; i++) last = (await route.GET(req, params(`guess-${i}`))).status;
    assert.strictEqual(last, 429);
  });

  await test("share links have no expiry field in this app, so 'expired' is not a separate state (documented)", async () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/models/Project.js"), "utf8");
    assert.ok(!/shareExpire|shareExpiresAt/i.test(src));
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/shared/board/[token] — valid access and read-only behaviour");

  await test("a valid link returns the board with no private data", async () => {
    const board = buildBoard({ nColumns: 2, perColumn: 2, taskExtras: (c, i) => (c === 0 && i === 0 ? {
      description: "short",
      assignees: [{ _id: hex24(7), name: "Priya", email: "priya@example.com" }],
      attachments: [{ _id: "attach-id-1", filename: "brief.pdf", mimeType: "application/pdf", size: 10, data: "BASE64SECRET" }],
    } : {}) });
    const { route } = setupRoute({ board, project: { _id: PROJECT_ID, name: "Launch Plan", description: "d", shareEnabled: true, shareToken: GOOD_TOKEN, manager: "m", team: "TEAMREF", members: ["u"] } });
    const res = await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.40" }), params());
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    const text = JSON.stringify(json);
    assert.strictEqual(json.projectName, "Launch Plan");
    assert.strictEqual(json.columns.length, 2);
    assert.strictEqual(json.tasks.length, 4);
    for (const leak of ["priya@example.com", "BASE64SECRET", "attach-id-1", GOOD_TOKEN, "TEAMREF"]) {
      assert.ok(!text.includes(leak), `${leak} leaked into the public response`);
    }
    assert.strictEqual(json.limits.truncated, false);
  });

  await test("read-only: the route exports GET only and performs no database writes", async () => {
    const board = buildBoard({ nColumns: 1, perColumn: 1 });
    const { route, calls } = setupRoute({ board });
    await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.41" }), params());
    assert.deepStrictEqual(Object.keys(route).sort(), ["GET"]);
    assert.deepStrictEqual(calls.writes, []);
  });

  await test("the task query still excludes attachment bytes and only requests tasks of the columns being sent", async () => {
    const board = buildBoard({ nColumns: 3, perColumn: 1 });
    const { route, calls } = setupRoute({ board });
    await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.42" }), params());
    assert.strictEqual(calls.task.select, "-attachments.data");
    assert.deepStrictEqual(calls.task.filter.column.$in.map(String), board.columns.map((c) => c._id));
    assert.strictEqual(String(calls.task.filter.project), PROJECT_ID);
  });

  // ------------------------------------------------------------------
  console.log("\nResponse bounds — oversized boards");

  const limits = () => require("../src/lib/sharedBoardLimits.js");

  await test("a board within every limit is returned complete and un-flagged", async () => {
    const board = buildBoard({ nColumns: 5, perColumn: 20, completedEvery: 4 });
    const { route } = setupRoute({ board });
    const json = await (await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.50" }), params())).json();
    assert.strictEqual(json.tasks.length, 100);
    assert.strictEqual(json.columns.length, 5);
    assert.deepStrictEqual(json.limits, { truncated: false, columns: { total: 5, shown: 5 }, tasks: { total: 100, shown: 100 } });
    assert.ok(json.columns.every((c) => c.taskCount === 20));
  });

  await test("more columns than the limit: the first 50 in board order are sent, and the response says so", async () => {
    const board = buildBoard({ nColumns: 80, perColumn: 2 });
    const { route, calls } = setupRoute({ board });
    const json = await (await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.51" }), params())).json();
    assert.strictEqual(calls.column.limit, limits().SHARED_BOARD_MAX_COLUMNS);
    assert.strictEqual(json.columns.length, 50);
    assert.deepStrictEqual(json.columns.map((c) => c.name), board.columns.slice(0, 50).map((c) => c.name));
    assert.strictEqual(json.limits.truncated, true);
    assert.deepStrictEqual(json.limits.columns, { total: 80, shown: 50 });
    assert.strictEqual(json.limits.tasks.total, 160, "total reflects the whole board, not just what was sent");
    assert.strictEqual(json.tasks.length, 100);
    assert.strictEqual(json.progress.total, 160);
  });

  await test("more tasks than the limit: DB query is capped, every column shows a contiguous run of its first tasks, true counts are kept", async () => {
    // 10 columns x 120 tasks = 1200 tasks; cap is 500.
    const board = buildBoard({ nColumns: 10, perColumn: 120, completedEvery: 3 });
    const { route, calls } = setupRoute({ board });
    const res = await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.52" }), params());
    const json = await res.json();
    assert.strictEqual(calls.task.limit, limits().SHARED_BOARD_MAX_TASKS);
    assert.deepStrictEqual(Object.keys(calls.task.sort), ["order", "createdAt", "_id"], "sort needs a full tie-break to be deterministic");
    assert.strictEqual(json.tasks.length, 500);
    assert.strictEqual(json.limits.truncated, true);
    assert.deepStrictEqual(json.limits.tasks, { total: 1200, shown: 500 });
    assert.strictEqual(json.progress.total, 1200, "progress is for the whole board, not the slice");
    assert.strictEqual(json.progress.done, board.tasks.filter((t) => t.completed).length);
    assert.ok(json.columns.every((c) => c.taskCount === 120), "each column reports its true size");

    // Prefix property: in each column the delivered tasks are exactly its first N by display order.
    for (const col of board.columns) {
      const sent = json.tasks.filter((t) => t.columnId === col._id).map((t) => t.order);
      assert.deepStrictEqual(sent, sent.map((_, i) => i), `column ${col.name} has a gap in its first tasks`);
    }
  });

  await test("the same oversized board always yields the same slice (deterministic)", async () => {
    const board = buildBoard({ nColumns: 6, perColumn: 150 });
    const a = await (await setupRoute({ board }).route.GET(fakeReq({ "x-forwarded-for": "203.0.113.53" }), params())).json();
    const b = await (await setupRoute({ board }).route.GET(fakeReq({ "x-forwarded-for": "203.0.113.54" }), params())).json();
    assert.deepStrictEqual(a, b);
  });

  await test("tasks that sit in columns cut by the column limit are not sent, and the column query bounds the task query", async () => {
    const board = buildBoard({ nColumns: 60, perColumn: 1 });
    const { route, calls } = setupRoute({ board });
    const json = await (await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.55" }), params())).json();
    assert.strictEqual(calls.task.filter.column.$in.length, 50);
    assert.ok(json.tasks.every((t) => json.columns.some((c) => c.id === t.columnId)));
  });

  console.log("\nResponse bounds — per-field projections and the byte budget");

  await test("description is cut to 280 chars with an ellipsis; short text is untouched; surrogate pairs are not split", async () => {
    const { truncateText } = limits();
    assert.strictEqual(truncateText("short", 280), "short");
    assert.strictEqual(truncateText(null, 280), null);
    const cut = truncateText("a".repeat(5000), 280);
    assert.ok(cut.length <= 280 && cut.endsWith("…"));
    const emoji = truncateText("😀".repeat(400), 281);
    assert.ok(!/[\ud800-\udbff]…$/.test(emoji) && !/[\ud800-\udbff]$/.test(emoji.slice(0, -1)), "ended on a lone surrogate");
  });

  await test("assignees are capped at 10 but assigneeCount keeps the true number; attachments capped at 20; metadata only", async () => {
    resetModuleCache();
    const { toSharedBoardDTO: dtoFn } = require("../src/lib/serialize.js");
    const assignees = Array.from({ length: 40 }, (_, i) => ({ _id: hex24(5000 + i), name: `U${i}`, email: `u${i}@example.com` }));
    const attachments = Array.from({ length: 30 }, (_, i) => ({ _id: `a${i}`, filename: `f${i}.pdf`, mimeType: "application/pdf", size: 1, data: "SECRET" }));
    const col = { _id: hex24(1), name: "C", order: 0, createdAt: new Date() };
    const task = { _id: hex24(2), column: hex24(1), title: "T", description: "d".repeat(3000), order: 0, createdAt: new Date(), assignees, attachments };
    const dto = dtoFn({ name: "P" }, [col], [task]);
    const t = dto.tasks[0];
    assert.strictEqual(t.assignees.length, 10);
    assert.strictEqual(t.assigneeCount, 40);
    assert.strictEqual(t.attachments.length, 20);
    assert.ok(t.description.length <= 280);
    const text = JSON.stringify(dto);
    assert.ok(!text.includes("SECRET") && !text.includes("@example.com"));
  });

  await test("worst-case board (500 tasks, every field at its maximum, multi-byte text) stays under the platform response limit with headroom", async () => {
    const wide = (n) => "漢".repeat(n); // 3 bytes per char in UTF-8
    const { columns, tasks } = buildBoard({
      nColumns: 50,
      perColumn: 20,
      taskExtras: () => ({
        title: wide(200),
        description: wide(5000),
        color: "mint",
        dueDate: new Date(),
        assignees: Array.from({ length: 500 }, (_, i) => ({ _id: hex24(9000 + i), name: wide(100) })),
        attachments: Array.from({ length: 20 }, () => ({ filename: wide(150), mimeType: "application/octet-stream", size: 1 })),
      }),
    });
    const { toSharedBoardDTO } = require("../src/lib/serialize.js");
    const dto = toSharedBoardDTO({ name: wide(150), description: wide(2000) }, columns, tasks.slice(0, 500));
    const bytes = Buffer.byteLength(JSON.stringify(dto));
    assert.ok(bytes <= limits().SHARED_BOARD_MAX_TASK_BYTES + 100_000, `response is ${bytes} bytes`);
    assert.ok(bytes < PLATFORM_LIMIT * 0.75, `response is ${bytes} bytes, too close to ${PLATFORM_LIMIT}`);
    assert.ok(dto.tasks.length < 500, "the byte budget should have cut this board");
    assert.strictEqual(dto.limits.truncated, true);
    assert.strictEqual(dto.limits.tasks.total, 500);
  });

  await test("byte-budget cut keeps a prefix of board order (never drops from the middle)", async () => {
    const { takeWithinByteBudget } = limits();
    const items = Array.from({ length: 100 }, (_, i) => ({ i, pad: "x".repeat(100) }));
    const taken = takeWithinByteBudget(items, 5000);
    assert.ok(taken.length > 0 && taken.length < 100);
    assert.deepStrictEqual(taken.map((x) => x.i), taken.map((_, k) => k));
    assert.ok(Buffer.byteLength(JSON.stringify(taken)) <= 5000);
    assert.strictEqual(takeWithinByteBudget(items, 10_000_000).length, 100);
    assert.strictEqual(takeWithinByteBudget(items, 1).length, 0);
  });

  await test("a board cut only by bytes is still reported as truncated, with true totals", async () => {
    const board = buildBoard({ nColumns: 5, perColumn: 100, taskExtras: () => ({ description: "漢".repeat(5000), title: "漢".repeat(200) }) });
    const { route } = setupRoute({ board });
    const res = await route.GET(fakeReq({ "x-forwarded-for": "203.0.113.60" }), params());
    const json = await res.json();
    assert.strictEqual(json.limits.tasks.total, 500);
    assert.ok(json.limits.tasks.shown <= 500);
    assert.strictEqual(json.limits.truncated, json.limits.tasks.shown < 500);
    assert.strictEqual(json.progress.total, 500);
  });

  console.log("\nShared page — what the client does with the new response");

  await test("page and board view use the new fields defensively (old cached snapshots without them still render)", async () => {
    const view = fs.readFileSync(path.join(__dirname, "../src/components/SharedBoardView.jsx"), "utf8");
    const page = fs.readFileSync(path.join(__dirname, "../src/app/shared/board/[token]/page.jsx"), "utf8");
    assert.ok(view.includes("column.taskCount ?? colTasks.length"));
    assert.ok(view.includes("task.assigneeCount ?? task.assignees.length"));
    assert.ok(page.includes("board.limits?.truncated"));
    // 429/503 are handled by the generic non-OK branch (message shown, Retry button, cached board kept).
    assert.ok(page.includes("transient server-side problem"));
  });

  summary();
})();
