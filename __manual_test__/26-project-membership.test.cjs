require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers the new per-project membership feature: a Team member no longer
// automatically has access to every Project belonging to that Team.
//
//   - lib/authz.js: projectAccessFor()'s legacy-vs-restricted distinction,
//     validateAssignees() staying in step with it, filterAccessibleProjects(),
//     and applyProjectMembership()'s seed-then-mutate behavior.
//   - The new POST/DELETE /api/projects/[id]/members route (add/remove,
//     manager-only, outsiders rejected).
//   - GET /api/projects/[id] and GET /api/projects end-to-end through the
//     real (unmocked) authz.js, proving the access boundary actually holds
//     for a real request, not just in the unit tests above.

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const MEMBER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb"; // on the team, added to the project
const OTHER_MEMBER_ID = "cccccccccccccccccccccccc"; // on the team, NOT added to the project
const OUTSIDER_ID = "dddddddddddddddddddddddd"; // not on the team at all
const PROJECT_ID = "111111111111111111111111";
const TEAM_ID = "222222222222222222222222";

function fakeReq(body) {
  return {
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
    headers: new Map(),
  };
}

function fakeReqWithUrl(url) {
  return { url, headers: new Map() };
}

function team() {
  return { _id: TEAM_ID, manager: MANAGER_ID, members: [MANAGER_ID, MEMBER_ID, OTHER_MEMBER_ID] };
}

(async () => {
  console.log("authz.js — projectAccessFor: legacy (unrestricted) vs. access-restricted projects");

  const { projectAccessFor, validateAssignees, filterAccessibleProjects, applyProjectMembership } = require("../src/lib/authz.js");

  await test("legacy project (no `members` key at all) still grants every team member access", async () => {
    const project = { manager: MANAGER_ID, team: team() };
    assert.strictEqual(projectAccessFor(project, MANAGER_ID).allowed, true);
    assert.strictEqual(projectAccessFor(project, MEMBER_ID).allowed, true);
    assert.strictEqual(projectAccessFor(project, OTHER_MEMBER_ID).allowed, true);
    assert.strictEqual(projectAccessFor(project, MANAGER_ID).hasProjectMembersList, false);
  });

  await test("a restricted project (members: []) denies every team member except the manager", async () => {
    const project = { manager: MANAGER_ID, team: team(), members: [] };
    assert.strictEqual(projectAccessFor(project, MANAGER_ID).allowed, true);
    assert.strictEqual(projectAccessFor(project, MEMBER_ID).allowed, false);
    assert.strictEqual(projectAccessFor(project, OTHER_MEMBER_ID).allowed, false);
  });

  await test("a restricted project only grants access to the listed members", async () => {
    const project = { manager: MANAGER_ID, team: team(), members: [MEMBER_ID] };
    const access = projectAccessFor(project, MEMBER_ID);
    assert.strictEqual(access.allowed, true);
    assert.strictEqual(access.isProjectMember, true);
    assert.strictEqual(projectAccessFor(project, OTHER_MEMBER_ID).allowed, false, "a team member not on the project's list must be denied");
  });

  await test("an outsider is denied regardless of legacy vs. restricted", async () => {
    const legacy = { manager: MANAGER_ID, team: team() };
    const restricted = { manager: MANAGER_ID, team: team(), members: [MEMBER_ID] };
    assert.strictEqual(projectAccessFor(legacy, OUTSIDER_ID).allowed, false);
    assert.strictEqual(projectAccessFor(restricted, OUTSIDER_ID).allowed, false);
  });

  await test("isTeamMember reflects team membership independent of project restriction", async () => {
    const project = { manager: MANAGER_ID, team: team(), members: [] };
    // OTHER_MEMBER_ID has no project access, but is still on the team —
    // the project-members UI needs this distinction to offer them as an
    // addable candidate.
    const access = projectAccessFor(project, OTHER_MEMBER_ID);
    assert.strictEqual(access.allowed, false);
    assert.strictEqual(access.isTeamMember, true);
  });

  console.log("\nauthz.js — filterAccessibleProjects");

  await test("keeps only the projects a user can actually access out of a broader team-based candidate set", async () => {
    const legacyOk = { _id: "p1", manager: MANAGER_ID, team: team() };
    const restrictedDenied = { _id: "p2", manager: MANAGER_ID, team: team(), members: [] };
    const restrictedAllowed = { _id: "p3", manager: MANAGER_ID, team: team(), members: [OTHER_MEMBER_ID] };
    const result = filterAccessibleProjects([legacyOk, restrictedDenied, restrictedAllowed], OTHER_MEMBER_ID);
    assert.deepStrictEqual(result.map((p) => p._id), ["p1", "p3"]);
  });

  console.log("\nauthz.js — validateAssignees stays in step with project access, not raw team membership");

  await test("a legacy project still allows any team member as an assignee (back-compat)", async () => {
    const project = { manager: MANAGER_ID, team: team() };
    const result = validateAssignees(project, [OTHER_MEMBER_ID]);
    assert.deepStrictEqual(result.assignees, [OTHER_MEMBER_ID]);
  });

  await test("a restricted project rejects a team member who hasn't been added to the project", async () => {
    const project = { manager: MANAGER_ID, team: team(), members: [MEMBER_ID] };
    const result = validateAssignees(project, [OTHER_MEMBER_ID]);
    assert.ok(result.error, "assigning someone who can't see the project should be rejected");
  });

  await test("a restricted project accepts the manager and every listed project member", async () => {
    const project = { manager: MANAGER_ID, team: team(), members: [MEMBER_ID] };
    const result = validateAssignees(project, [MANAGER_ID, MEMBER_ID]);
    assert.deepStrictEqual(result.assignees.sort(), [MANAGER_ID, MEMBER_ID].sort());
  });

  console.log("\nauthz.js — applyProjectMembership: seed-on-first-touch for legacy projects");

  await test("adding to a legacy project seeds `members` with the full current team roster, then adds the target", async () => {
    resetModuleCache();
    const calls = [];
    mockModule("@/models/Project", {
      updateOne: async (filter, update) => {
        calls.push({ filter, update });
      },
    });
    const { applyProjectMembership: applyFresh } = require("../src/lib/authz.js");
    const project = { _id: PROJECT_ID, team: team() }; // no `members` key — legacy
    await applyFresh(project, MEMBER_ID, "add");

    assert.strictEqual(calls.length, 2, "expected a seed write, then the add");
    assert.deepStrictEqual(calls[0].filter, { _id: PROJECT_ID, members: { $exists: false } });
    assert.deepStrictEqual(calls[0].update.$set.members.sort(), [MANAGER_ID, MEMBER_ID, OTHER_MEMBER_ID].sort());
    assert.deepStrictEqual(calls[1].update, { $addToSet: { members: MEMBER_ID } });
  });

  await test("removing from a legacy project also seeds first, so everyone but the one removed keeps access", async () => {
    resetModuleCache();
    const calls = [];
    mockModule("@/models/Project", {
      updateOne: async (filter, update) => {
        calls.push({ filter, update });
      },
    });
    const { applyProjectMembership: applyFresh } = require("../src/lib/authz.js");
    const project = { _id: PROJECT_ID, team: team() };
    await applyFresh(project, OTHER_MEMBER_ID, "remove");

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0].update.$set.members.sort(), [MANAGER_ID, MEMBER_ID, OTHER_MEMBER_ID].sort());
    assert.deepStrictEqual(calls[1].update, { $pull: { members: OTHER_MEMBER_ID } });
  });

  await test("an already-restricted project skips the seed and only issues the add/remove", async () => {
    resetModuleCache();
    const calls = [];
    mockModule("@/models/Project", {
      updateOne: async (filter, update) => {
        calls.push({ filter, update });
      },
    });
    const { applyProjectMembership: applyFresh } = require("../src/lib/authz.js");
    const project = { _id: PROJECT_ID, team: team(), members: [MEMBER_ID] };
    await applyFresh(project, OTHER_MEMBER_ID, "add");

    assert.strictEqual(calls.length, 1, "no seed write should happen once the project is already restricted");
    assert.deepStrictEqual(calls[0].update, { $addToSet: { members: OTHER_MEMBER_ID } });
  });

  // ------------------------------------------------------------------
  console.log("\nPOST/DELETE /api/projects/[id]/members — route-level authorization & validation");

  function setupMembersRouteMocks({ callerId = MANAGER_ID, applyImpl } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const projectDoc = { _id: PROJECT_ID, manager: MANAGER_ID, team: team(), createdAt: new Date() };
    mockModule("@/models/Project", {
      findById: () => ({
        populate: function () { return this; },
        lean: async () => projectDoc,
      }),
    });
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/models/Task", { find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }) });
    const applyCalls = [];
    mockModule("@/lib/authz", {
      applyProjectMembership: async (project, targetUserId, action) => {
        applyCalls.push({ targetUserId, action });
        if (applyImpl) await applyImpl(project, targetUserId, action);
      },
    });
    return { applyCalls };
  }

  await test("POST: 401 when there is no session", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => null });
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: MEMBER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("POST: 404 for a malformed project id — never reaches the database", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => { throw new Error("should not query with an invalid id"); },
    });
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: MEMBER_ID }), { params: Promise.resolve({ id: "not-a-valid-id" }) });
    assert.strictEqual(res.status, 404);
  });

  await test("POST: 403 when the caller is a team member but not the project manager", async () => {
    const { applyCalls } = setupMembersRouteMocks({ callerId: MEMBER_ID });
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: OTHER_MEMBER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(/manager/i.test(json.error));
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("POST: 400 when the target user isn't a member of this project's team", async () => {
    const { applyCalls } = setupMembersRouteMocks();
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: OUTSIDER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(applyCalls.length, 0, "an outsider must never be added, even indirectly");
  });

  await test("POST: 400 when adding the project manager (redundant — they already have access)", async () => {
    const { applyCalls } = setupMembersRouteMocks();
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: MANAGER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("POST: 400 for a missing/invalid userId", async () => {
    setupMembersRouteMocks();
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: "nope" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("POST: the manager can add a genuine team member, and the route applies the add", async () => {
    const { applyCalls } = setupMembersRouteMocks();
    const { POST } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await POST(fakeReq({ userId: OTHER_MEMBER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(applyCalls.length, 1);
    assert.deepStrictEqual(applyCalls[0], { targetUserId: OTHER_MEMBER_ID, action: "add" });
  });

  await test("DELETE: 400 when trying to remove the project manager", async () => {
    const { applyCalls } = setupMembersRouteMocks();
    const { DELETE } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await DELETE(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/members?userId=${MANAGER_ID}`), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("DELETE: 403 when the caller is not the project manager", async () => {
    const { applyCalls } = setupMembersRouteMocks({ callerId: MEMBER_ID });
    const { DELETE } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await DELETE(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/members?userId=${OTHER_MEMBER_ID}`), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("DELETE: the manager can remove a member, and the route applies the removal", async () => {
    const { applyCalls } = setupMembersRouteMocks();
    const { DELETE } = require("../src/app/api/projects/[id]/members/route.js");
    const res = await DELETE(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/members?userId=${MEMBER_ID}`), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(applyCalls[0], { targetUserId: MEMBER_ID, action: "remove" });
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/projects/[id] — end-to-end through the real (unmocked) authz.js");

  function setupProjectGetMocks(projectDoc) {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => ({
        populate: function () { return this; },
        lean: async () => projectDoc,
      }),
    });
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/models/Task", { find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }) });
  }

  const legacyProjectDoc = {
    _id: PROJECT_ID,
    name: "Legacy project",
    createdAt: new Date(),
    manager: { _id: MANAGER_ID, name: "Manager", email: "m@x.com" },
    team: { _id: TEAM_ID, name: "Team", manager: { _id: MANAGER_ID }, members: [{ _id: MANAGER_ID }, { _id: MEMBER_ID }, { _id: OTHER_MEMBER_ID }] },
    // no `members` field — a project created before this feature existed
  };

  const restrictedProjectDoc = {
    ...legacyProjectDoc,
    name: "Restricted project",
    members: [{ _id: MEMBER_ID, name: "Member", email: "b@x.com" }],
  };

  await test("a team member WITHOUT project access gets 403 opening a restricted project", async () => {
    setupProjectGetMocks(restrictedProjectDoc);
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OTHER_MEMBER_ID } }) });
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("a team member WITH project access can open the restricted project", async () => {
    setupProjectGetMocks(restrictedProjectDoc);
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MEMBER_ID } }) });
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 200);
  });

  await test("the project manager always has access, even to a restricted project they didn't add themselves to", async () => {
    setupProjectGetMocks(restrictedProjectDoc);
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 200);
  });

  await test("a legacy project (pre-existing, no members list) still opens for any team member — nothing broke", async () => {
    setupProjectGetMocks(legacyProjectDoc);
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OTHER_MEMBER_ID } }) });
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.members, null, "a legacy project's DTO reports no restricted member list");
  });

  await test("a total outsider (not on the team at all) gets 403 regardless of legacy/restricted", async () => {
    setupProjectGetMocks(legacyProjectDoc);
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OUTSIDER_ID } }) });
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("a restricted project's DTO includes the actual members list", async () => {
    setupProjectGetMocks(restrictedProjectDoc);
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    const { GET } = require("../src/app/api/projects/[id]/route.js");
    const res = await GET(fakeReq(), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.deepStrictEqual(json.members.map((m) => m.id), [MEMBER_ID]);
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/projects — the list is narrowed to actual access, not just team membership");

  await test("a project the user's team owns, but that they haven't been added to, is excluded from the list", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OTHER_MEMBER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      accessibleTeamIds: async () => [TEAM_ID],
      // Inlined rather than re-requiring the real authz.js, matching this
      // suite's convention elsewhere of mocking @/lib/authz wholesale in
      // route-level tests (the real function is already covered directly,
      // above) — this keeps the module-load order for this one test
      // independent of when @/models/Project gets mocked below.
      filterAccessibleProjects: (projects, userId) =>
        projects.filter((p) => {
          const isManager = String(p.manager?._id ?? p.manager) === userId;
          const hasList = Array.isArray(p.members);
          const rosterIds = hasList
            ? p.members.map((m) => String(m._id ?? m))
            : (p.team.members || []).map((m) => String(m._id ?? m));
          return isManager || rosterIds.includes(userId);
        }),
    });
    const accessibleProjectDoc = { ...legacyProjectDoc, _id: "p-accessible" };
    const deniedProjectDoc = { ...restrictedProjectDoc, _id: "p-denied" }; // OTHER_MEMBER_ID isn't in its members list
    mockModule("@/models/Project", {
      find: () => ({
        populate: function () { return this; },
        sort: function () { return this; },
        lean: async () => [accessibleProjectDoc, deniedProjectDoc],
      }),
    });
    mockModule("@/models/Column", { find: () => ({ lean: async () => [] }) });
    mockModule("@/models/Task", { find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }) });

    const { GET } = require("../src/app/api/projects/route.js");
    const res = await GET();
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(json.map((p) => p.id), ["p-accessible"], "only the project this user actually has access to should be listed");
  });

  summary();
})();
