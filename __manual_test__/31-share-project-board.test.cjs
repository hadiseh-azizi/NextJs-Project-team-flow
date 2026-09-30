require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// Covers this phase's "Share Project Board as Read-Only + Offline" feature:
//
//   - lib/shareToken.js               (token shape/randomness)
//   - lib/serialize.js                (toSharedBoardDTO — the public DTO
//     never leaks email, team/membership/editing data, the share token
//     itself, or attachment ids/bytes)
//   - POST/GET/DELETE /api/projects/[id]/share  (manager-only: enable,
//     read status, regenerate, disable-as-revoke)
//   - GET /api/shared/board/[token]   (public, unauthenticated: valid
//     link, and that invalid/disabled/revoked all produce an identical
//     404 rather than leaking which case it was — same convention as
//     lib/authz.js's getAccessibleProject; plus per-IP rate limiting)
//
// Client-side offline caching (lib/sharedBoardCache.js, public/sw.js) and
// the shared board page's own online/offline state machine are DOM/
// Service-Worker/Cache-Storage-dependent and are exercised by the "manual
// verification against a live browser" matrix documented alongside this
// phase's changelog entry, not by this Node harness — consistent with
// this project's standing "no browser-level test suite" limitation (see
// CHANGELOG.md).

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_USER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PROJECT_ID = "111111111111111111111111";
const COLUMN_ID = "222222222222222222222222";
const TASK_ID = "333333333333333333333333";
const ASSIGNEE_ID = "444444444444444444444444";

function fakeReq(headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return { headers: { get: (name) => lowered[name.toLowerCase()] ?? null } };
}

(async () => {
  // ------------------------------------------------------------------
  console.log("lib/shareToken.js — generateShareToken()");

  await test("produces a URL-safe token with no padding/plus/slash characters", async () => {
    const { generateShareToken } = require("../src/lib/shareToken.js");
    const token = generateShareToken();
    assert.strictEqual(typeof token, "string");
    assert.ok(token.length >= 32, `expected a long token, got length ${token.length}`);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(token), `token contains non-URL-safe characters: ${token}`);
  });

  await test("two calls never produce the same token", async () => {
    const { generateShareToken } = require("../src/lib/shareToken.js");
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(generateShareToken());
    assert.strictEqual(seen.size, 500);
  });

  // ------------------------------------------------------------------
  console.log("\nlib/serialize.js — toSharedBoardDTO()");

  await test("exposes only the allowed project/column/task fields — no email, no team/membership/editing data, no share token", async () => {
    const { toSharedBoardDTO } = require("../src/lib/serialize.js");
    const project = {
      _id: PROJECT_ID,
      name: "Launch Plan",
      description: "Q4 launch",
      completed: false,
      manager: MANAGER_ID,
      team: "should-never-appear",
      members: [MANAGER_ID, OTHER_USER_ID],
      editingMode: "manager_approval",
      editors: [OTHER_USER_ID],
      shareEnabled: true,
      shareToken: "super-secret-token-should-never-appear",
    };
    const columns = [{ _id: COLUMN_ID, project: PROJECT_ID, name: "To do", order: 0, isDoneColumn: false, createdAt: new Date() }];
    const tasks = [
      {
        _id: TASK_ID,
        project: PROJECT_ID,
        column: COLUMN_ID,
        title: "Write copy",
        description: "Draft the landing page",
        order: 0,
        completed: false,
        dueDate: new Date("2026-10-01"),
        color: "mint",
        createdAt: new Date(),
        assignees: [{ _id: ASSIGNEE_ID, name: "Priya", email: "priya@example.com" }],
        attachments: [{ _id: "attach1", filename: "brief.pdf", mimeType: "application/pdf", size: 4096, data: "base64-should-never-appear", uploadedAt: new Date() }],
      },
    ];

    const dto = toSharedBoardDTO(project, columns, tasks);
    const serialized = JSON.stringify(dto);

    assert.strictEqual(dto.projectName, "Launch Plan");
    assert.strictEqual(dto.projectDescription, "Q4 launch");
    assert.strictEqual(dto.progress.total, 1);
    assert.strictEqual(dto.progress.done, 0);
    assert.strictEqual(dto.columns.length, 1);
    assert.strictEqual(dto.tasks.length, 1);

    const [task] = dto.tasks;
    assert.strictEqual(task.title, "Write copy");
    assert.deepStrictEqual(task.assignees, [{ id: ASSIGNEE_ID, name: "Priya" }]);
    assert.deepStrictEqual(task.attachments, [{ filename: "brief.pdf", mimeType: "application/pdf", size: 4096 }]);

    // The real leak check: none of these ever appear anywhere in the
    // serialized payload, not just "not in the fields we happened to read".
    assert.ok(!serialized.includes("priya@example.com"), "assignee email leaked into the public DTO");
    assert.ok(!serialized.includes("super-secret-token-should-never-appear"), "share token leaked into the public DTO");
    assert.ok(!serialized.includes("base64-should-never-appear"), "attachment file bytes leaked into the public DTO");
    assert.ok(!serialized.includes("should-never-appear"), "team reference leaked into the public DTO");
    assert.ok(!serialized.includes("manager_approval") && !serialized.includes("editingMode"), "editing-permission settings leaked into the public DTO");
    assert.ok(!serialized.includes("attach1"), "attachment id leaked into the public DTO (would be a live download target)");
  });

  // ------------------------------------------------------------------
  console.log("\nPOST/GET/DELETE /api/projects/[id]/share — manager-only settings route");

  function projectDoc(overrides = {}) {
    return { _id: PROJECT_ID, manager: MANAGER_ID, shareEnabled: false, shareToken: null, ...overrides };
  }

  function setupShareSettingsMocks({ callerId = MANAGER_ID, project = projectDoc(), updateImpl } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => (callerId ? { user: { id: callerId } } : null) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const updateCalls = [];
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => project }),
      updateOne: async (filter, update) => {
        updateCalls.push({ filter, update });
        if (updateImpl) return updateImpl(filter, update);
      },
    });
    return { updateCalls };
  }

  await test("GET: 401 with no session", async () => {
    setupShareSettingsMocks({ callerId: null });
    const { GET } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("GET: 403 when the caller is not the project manager", async () => {
    setupShareSettingsMocks({ callerId: OTHER_USER_ID });
    const { GET } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("GET: 404 for a malformed project id (never reaches Mongoose as a CastError)", async () => {
    setupShareSettingsMocks();
    const { GET } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: "not-an-object-id" }) });
    assert.strictEqual(res.status, 404);
  });

  await test("GET: reports sharing disabled and a null link on a project that has never enabled it", async () => {
    setupShareSettingsMocks({ project: projectDoc() });
    const { GET } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(json, { shareEnabled: false, shareUrl: null });
  });

  await test("GET: returns the existing link (re-displayable, not one-time) when already enabled", async () => {
    setupShareSettingsMocks({ project: projectDoc({ shareEnabled: true, shareToken: "existing-token" }) });
    const { GET } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(json, { shareEnabled: true, shareUrl: "/shared/board/existing-token" });
  });

  await test("POST: 401 with no session, 403 for a non-manager — never touches the database", async () => {
    const { updateCalls: unauth } = setupShareSettingsMocks({ callerId: null });
    const { POST } = require("../src/app/api/projects/[id]/share/route.js");
    let res = await POST(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(unauth.length, 0);

    const { updateCalls: forbidden } = setupShareSettingsMocks({ callerId: OTHER_USER_ID });
    const { POST: POST2 } = require("../src/app/api/projects/[id]/share/route.js");
    res = await POST2(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(forbidden.length, 0);
  });

  await test("POST: the manager can enable sharing for the first time, getting back a working link", async () => {
    const { updateCalls } = setupShareSettingsMocks({ project: projectDoc() });
    const { POST } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await POST(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.shareEnabled, true);
    assert.ok(json.shareUrl.startsWith("/shared/board/"));
    assert.strictEqual(updateCalls.length, 1);
    assert.deepStrictEqual(updateCalls[0].filter, { _id: PROJECT_ID });
    assert.strictEqual(updateCalls[0].update.$set.shareEnabled, true);
    assert.ok(typeof updateCalls[0].update.$set.shareToken === "string" && updateCalls[0].update.$set.shareToken.length > 0);
  });

  await test("POST: regenerating an already-enabled link issues a brand-new token, not the old one", async () => {
    const { updateCalls } = setupShareSettingsMocks({ project: projectDoc({ shareEnabled: true, shareToken: "old-token" }) });
    const { POST } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await POST(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.notStrictEqual(json.shareUrl, "/shared/board/old-token");
    assert.notStrictEqual(updateCalls[0].update.$set.shareToken, "old-token");
  });

  await test("POST: retries once on a token collision (duplicate-key race) rather than failing the request", async () => {
    let attempts = 0;
    const { updateCalls } = setupShareSettingsMocks({
      project: projectDoc(),
      updateImpl: () => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      },
    });
    const { POST } = require("../src/app/api/projects/[id]/share/route.js");
    const res = await POST(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(updateCalls.length, 2);
    assert.notStrictEqual(updateCalls[0].update.$set.shareToken, updateCalls[1].update.$set.shareToken);
  });

  await test("DELETE: 403 for a non-manager, and disabling clears both shareEnabled and shareToken (immediate revoke)", async () => {
    const { updateCalls: forbidden } = setupShareSettingsMocks({ callerId: OTHER_USER_ID });
    const { DELETE } = require("../src/app/api/projects/[id]/share/route.js");
    let res = await DELETE(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(forbidden.length, 0);

    const { updateCalls } = setupShareSettingsMocks({ project: projectDoc({ shareEnabled: true, shareToken: "live-token" }) });
    const { DELETE: DELETE2 } = require("../src/app/api/projects/[id]/share/route.js");
    res = await DELETE2(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(json, { shareEnabled: false, shareUrl: null });
    assert.deepStrictEqual(updateCalls[0].update, { $set: { shareEnabled: false, shareToken: null } });
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/shared/board/[token] — public, unauthenticated route");

  function setupPublicRouteMocks({ project = null, rateLimitModel = makeFakeRateLimitModel() } = {}) {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rateLimitModel);
    const findOneCalls = [];
    mockModule("@/models/Project", {
      findOne: (filter) => {
        findOneCalls.push(filter);
        return { lean: async () => (project && filter.shareToken === project.shareToken && filter.shareEnabled === true && project.shareEnabled ? project : null) };
      },
    });
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/models/Task", {
      find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }),
    });
    return { findOneCalls, rateLimitModel };
  }

  await test("returns 200 with the board for a valid, enabled token", async () => {
    setupPublicRouteMocks({ project: { _id: PROJECT_ID, name: "Launch Plan", shareEnabled: true, shareToken: "good-token" } });
    const { GET } = require("../src/app/api/shared/board/[token]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ token: "good-token" }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.projectName, "Launch Plan");
  });

  await test("an unknown token, a disabled project's token, and a revoked (cleared) token all return the identical 404 body", async () => {
    setupPublicRouteMocks({ project: { _id: PROJECT_ID, name: "X", shareEnabled: true, shareToken: "good-token" } });
    const { GET } = require("../src/app/api/shared/board/[token]/route.js");

    const unknown = await GET(fakeReq(), { params: Promise.resolve({ token: "never-issued" }) });
    assert.strictEqual(unknown.status, 404);
    const unknownBody = await unknown.json();

    setupPublicRouteMocks({ project: { _id: PROJECT_ID, name: "X", shareEnabled: false, shareToken: "good-token" } });
    const { GET: GET2 } = require("../src/app/api/shared/board/[token]/route.js");
    const disabled = await GET2(fakeReq(), { params: Promise.resolve({ token: "good-token" }) });
    assert.strictEqual(disabled.status, 404);
    const disabledBody = await disabled.json();

    assert.deepStrictEqual(unknownBody, disabledBody, "invalid vs disabled must not be distinguishable from the response");
  });

  await test("rejects an absurdly long token before it ever reaches a database query", async () => {
    const { findOneCalls } = setupPublicRouteMocks();
    const { GET } = require("../src/app/api/shared/board/[token]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ token: "x".repeat(500) }) });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(findOneCalls.length, 0);
  });

  await test("never includes attachment file data in the DB query for tasks (select excludes attachments.data)", async () => {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    mockModule("@/models/Project", { findOne: () => ({ lean: async () => ({ _id: PROJECT_ID, name: "X", shareEnabled: true, shareToken: "good-token" }) }) });
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    let selectArg = null;
    mockModule("@/models/Task", {
      find: () => ({
        select: function (arg) {
          selectArg = arg;
          return this;
        },
        populate: function () { return this; },
        sort: function () { return this; },
        lean: async () => [],
      }),
    });
    const { GET } = require("../src/app/api/shared/board/[token]/route.js");
    await GET(fakeReq(), { params: Promise.resolve({ token: "good-token" }) });
    assert.strictEqual(selectArg, "-attachments.data");
  });

  await test("a per-IP flood is rate-limited with 429, independent of whether the token is valid", async () => {
    const rateLimitModel = makeFakeRateLimitModel();
    setupPublicRouteMocks({ project: { _id: PROJECT_ID, name: "X", shareEnabled: true, shareToken: "good-token" }, rateLimitModel });
    const { GET } = require("../src/app/api/shared/board/[token]/route.js");
    const req = fakeReq({ "x-forwarded-for": "203.0.113.50" });
    let lastStatus;
    // SHARED_BOARD_IP_LIMIT.max is 60 (route.js).
    for (let i = 0; i < 60; i++) {
      const res = await GET(req, { params: Promise.resolve({ token: "good-token" }) });
      lastStatus = res.status;
    }
    assert.strictEqual(lastStatus, 200);
    const limited = await GET(req, { params: Promise.resolve({ token: "good-token" }) });
    assert.strictEqual(limited.status, 429);
  });

  await test("requests with no determinable IP (untrusted/missing proxy header) are never rate-limited against each other", async () => {
    const rateLimitModel = makeFakeRateLimitModel();
    setupPublicRouteMocks({ project: { _id: PROJECT_ID, name: "X", shareEnabled: true, shareToken: "good-token" }, rateLimitModel });
    const { GET } = require("../src/app/api/shared/board/[token]/route.js");
    const req = fakeReq(); // no x-forwarded-for
    let lastStatus;
    for (let i = 0; i < 65; i++) {
      const res = await GET(req, { params: Promise.resolve({ token: "good-token" }) });
      lastStatus = res.status;
    }
    assert.strictEqual(lastStatus, 200);
  });

  summary();
})();
