require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Audit item C2: a user removed from a Team kept access to a restricted
// Project because projectAccessFor() trusted `Project.members` on its own,
// and DELETE /api/teams/[id]/members never cleaned `Project.members` up.
//
// Two layers are covered, and each is enough by itself to close the hole:
//   1. lib/authz.js — access requires CURRENT team membership on every
//      read, so a stale id in Project.members grants nothing.
//   2. DELETE /api/teams/[id]/members — removal also pulls the user from
//      members/editors of that team's projects and from its tasks.
//
// Route-level cases run the real, unmocked authz.js against a small
// in-memory store, so they prove direct URL/API access is denied, not just
// that a helper returns false.

const MANAGER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER_A = "bbbbbbbbbbbbbbbbbbbbbbbb";
const USER_B = "cccccccccccccccccccccccc"; // stays on the team throughout
const TEAM_A = "a1a1a1a1a1a1a1a1a1a1a1a1";
const TEAM_B = "b2b2b2b2b2b2b2b2b2b2b2b2";
const PROJ_A1 = "111111111111111111111111";
const PROJ_A2 = "111111111111111111111112";
const PROJ_B1 = "111111111111111111111113";
const TASK_A1 = "dddddddddddddddddddddd01";
const TASK_B1 = "dddddddddddddddddddddd02";

const clone = (v) => JSON.parse(JSON.stringify(v));
const has = (arr, id) => (arr || []).map(String).includes(id);

// --- tiny in-memory store + Mongoose-shaped fakes -------------------------
function makeStore() {
  const db = {
    teams: [
      { _id: TEAM_A, name: "Team A", manager: MANAGER, members: [MANAGER, USER_A, USER_B] },
      { _id: TEAM_B, name: "Team B", manager: MANAGER, members: [MANAGER, USER_A] },
    ],
    projects: [
      { _id: PROJ_A1, name: "A1", team: TEAM_A, manager: MANAGER, createdAt: new Date(), members: [USER_A, USER_B], editors: [USER_A], editingMode: "manager_approval" },
      { _id: PROJ_A2, name: "A2", team: TEAM_A, manager: MANAGER, createdAt: new Date(), members: [USER_A] },
      // Legacy: no `members` key at all.
      { _id: "111111111111111111111114", name: "A-legacy", team: TEAM_A, manager: MANAGER, createdAt: new Date() },
      { _id: PROJ_B1, name: "B1", team: TEAM_B, manager: MANAGER, createdAt: new Date(), members: [USER_A], editors: [USER_A] },
    ],
    tasks: [
      { _id: TASK_A1, project: PROJ_A1, column: "c1", title: "t", assignees: [USER_A, USER_B] },
      { _id: TASK_B1, project: PROJ_B1, column: "c2", title: "t", assignees: [USER_A] },
    ],
  };
  const user = (id) => ({ _id: id, name: `u-${id.slice(0, 2)}`, email: `${id.slice(0, 2)}@x.com` });
  const populateDoc = (doc, arg) => {
    const path = typeof arg === "string" ? arg : arg.path;
    if (path === "team") {
      const t = db.teams.find((x) => x._id === doc.team);
      doc.team = { ...clone(t), manager: user(t.manager), members: t.members.map(user) };
    } else if (path === "manager") doc.manager = user(doc.manager);
    else if ((path === "members" || path === "editors") && Array.isArray(doc[path])) doc[path] = doc[path].map(user);
  };
  const query = (get) => {
    let doc = get() ? clone(get()) : null;
    const q = {
      populate(arg) { if (doc) populateDoc(doc, arg); return q; },
      select() { return q; },
      sort() { return q; },
      session() { return q; },
      lean: async () => doc,
      then: (res, rej) => Promise.resolve(doc).then(res, rej),
    };
    return q;
  };
  const listQuery = (rows) => {
    const q = {
      populate: () => q,
      select: () => q,
      sort: () => q,
      lean: async () => rows,
    };
    return q;
  };
  const pull = (doc, spec) => {
    for (const [field, id] of Object.entries(spec)) {
      // Mongo semantics: $pull on a missing field is a no-op and does not create it.
      if (Array.isArray(doc[field])) doc[field] = doc[field].filter((x) => String(x) !== String(id));
    }
  };
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => (v && v.$in ? v.$in.map(String).includes(String(doc[k])) : String(doc[k]) === String(v)));
  const log = [];
  return {
    db,
    log,
    models: {
      Team: {
        findById: (id) => query(() => db.teams.find((t) => t._id === String(id))),
        updateOne: async (f, u) => { pull(db.teams.find((t) => t._id === String(f._id)), u.$pull); },
      },
      Project: {
        findById: (id) => query(() => db.projects.find((p) => p._id === String(id))),
        find: (filter) => {
          const out = db.projects.filter((p) => matches(p, filter)).map((p) => ({ _id: p._id }));
          const q = { session: () => q, lean: async () => out };
          return q;
        },
        updateMany: async (filter, u) => {
          log.push({ model: "Project", filter, update: u });
          db.projects.filter((p) => matches(p, filter)).forEach((p) => pull(p, u.$pull));
        },
        updateOne: async () => {},
      },
      Task: {
        findById: (id) => query(() => db.tasks.find((t) => t._id === String(id))),
        find: (filter) => listQuery(db.tasks.filter((t) => matches(t, filter)).map(clone)),
        updateMany: async (filter, u) => {
          log.push({ model: "Task", filter, update: u });
          db.tasks.filter((t) => matches(t, filter)).forEach((t) => pull(t, u.$pull));
        },
      },
      Column: { find: () => listQuery([]) },
    },
  };
}

function install(store, sessionUserId) {
  resetModuleCache();
  const realMongoose = require("mongoose");
  // Standalone-mongod behaviour: transactions unsupported -> unsessioned fallback.
  mockModule("mongoose", {
    ...realMongoose,
    startSession: async () => ({
      withTransaction: async () => { throw new Error("Transaction numbers are only allowed on a replica set member or mongos"); },
      endSession: async () => {},
    }),
  });
  mockModule("next-auth", { getServerSession: async () => (sessionUserId ? { user: { id: sessionUserId } } : null) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/models/Team", store.models.Team);
  mockModule("@/models/Project", store.models.Project);
  mockModule("@/models/Task", store.models.Task);
  mockModule("@/models/Column", store.models.Column);
  mockModule("@/models/User", {});
  mockModule("@/models/Invitation", {});
}

const ctx = (id) => ({ params: Promise.resolve({ id }) });
const getReq = () => ({ headers: new Map(), json: async () => ({}) });
const delReq = (teamId, userId) => ({ url: `http://x/api/teams/${teamId}/members?userId=${userId}`, headers: new Map() });

async function removeFromTeamA(store, userId) {
  install(store, MANAGER);
  const { DELETE } = require("../src/app/api/teams/[id]/members/route.js");
  const res = await DELETE(delReq(TEAM_A, userId), ctx(TEAM_A));
  assert.strictEqual(res.status, 200, `team removal should succeed, got ${res.status}`);
}

async function getProjectStatus(store, projectId, userId) {
  install(store, userId);
  const { GET } = require("../src/app/api/projects/[id]/route.js");
  return (await GET(getReq(), ctx(projectId))).status;
}

(async () => {
  const projectFor = (members, teamMembers, extra = {}) => ({
    manager: MANAGER,
    team: { _id: TEAM_A, manager: MANAGER, members: teamMembers },
    members,
    ...extra,
  });

  console.log("authz.js — projectAccessFor / helpers");
  resetModuleCache();
  const authz = require("../src/lib/authz.js");

  await test("Test 3: current team member + project member is allowed", () => {
    const a = authz.projectAccessFor(projectFor([USER_A], [MANAGER, USER_A]), USER_A);
    assert.strictEqual(a.allowed, true);
    assert.strictEqual(a.isTeamMember, true);
  });

  await test("Test 2: project membership alone is insufficient (Team.members = [manager], Project.members = [userA])", () => {
    const a = authz.projectAccessFor(projectFor([USER_A], [MANAGER]), USER_A);
    assert.strictEqual(a.allowed, false);
    assert.strictEqual(a.isTeamMember, false);
  });

  await test("audit repro: members [removed, stay], team [mgr, stay] -> removed is denied, stay is allowed", () => {
    const p = projectFor(["removed", "stay"], [MANAGER, "stay"]);
    const r = authz.projectAccessFor(p, "removed");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.isTeamMember, false);
    assert.strictEqual(authz.projectAccessFor(p, "stay").allowed, true);
  });

  await test("Test 4: the project manager keeps access, even when absent from Project.members", () => {
    const p = projectFor([], [MANAGER, USER_A]);
    assert.strictEqual(authz.projectAccessFor(p, MANAGER).allowed, true);
    assert.strictEqual(authz.canEditProject({ ...p, editingMode: "manager_approval", editors: [] }, MANAGER), true);
  });

  await test("manager access does not depend on the team roster (existing manager privileges unchanged)", () => {
    const p = projectFor([], [USER_A]); // manager not listed in team.members
    assert.strictEqual(authz.projectAccessFor(p, MANAGER).allowed, true);
  });

  await test("populated team members ({_id}) and raw ids behave the same", () => {
    const p = projectFor([{ _id: USER_A }], [{ _id: MANAGER }, { _id: USER_A }]);
    assert.strictEqual(authz.projectAccessFor(p, USER_A).allowed, true);
    assert.strictEqual(authz.projectAccessFor(projectFor([{ _id: USER_A }], [{ _id: MANAGER }]), USER_A).allowed, false);
  });

  await test("an unpopulated team fails closed for non-managers", () => {
    const p = { manager: MANAGER, team: TEAM_A, members: [USER_A] };
    assert.strictEqual(authz.projectAccessFor(p, USER_A).allowed, false);
    assert.strictEqual(authz.projectAccessFor(p, MANAGER).allowed, true);
  });

  await test("legacy project (no `members` key) keeps its semantics: current team members yes, ex-members no", () => {
    const p = { manager: MANAGER, team: { _id: TEAM_A, members: [MANAGER, USER_B] } };
    assert.strictEqual(authz.projectAccessFor(p, USER_B).allowed, true);
    assert.strictEqual(authz.projectAccessFor(p, USER_A).allowed, false);
    assert.strictEqual(authz.projectAccessFor(p, USER_A).hasProjectMembersList, false);
  });

  await test("restricted project still denies a current team member who isn't listed (no new permission model)", () => {
    const p = projectFor([USER_A], [MANAGER, USER_A, USER_B]);
    assert.strictEqual(authz.projectAccessFor(p, USER_B).allowed, false);
  });

  await test("validateAssignees rejects a stale ex-member id and accepts current members", () => {
    const p = projectFor(["removed", "stay"], [MANAGER, "stay"]);
    assert.ok(authz.validateAssignees(p, ["000000000000000000000001"]).error);
    const stale = projectFor([USER_A, USER_B], [MANAGER, USER_B]);
    assert.ok(authz.validateAssignees(stale, [USER_A]).error, "ex-member must not be assignable");
    assert.deepStrictEqual(authz.validateAssignees(stale, [USER_B, MANAGER]).assignees.sort(), [USER_B, MANAGER].sort());
  });

  await test("filterAccessibleProjects drops projects where the user is only a stale project member", () => {
    const stale = { _id: "p1", ...projectFor([USER_A], [MANAGER]) };
    const ok = { _id: "p2", ...projectFor([USER_A], [MANAGER, USER_A]) };
    assert.deepStrictEqual(authz.filterAccessibleProjects([stale, ok], USER_A).map((p) => p._id), ["p2"]);
  });

  await test("isEligibleEditor requires current team membership", () => {
    assert.strictEqual(authz.isEligibleEditor(projectFor([USER_A], [MANAGER]), USER_A), false);
    assert.strictEqual(authz.isEligibleEditor(projectFor([USER_A], [MANAGER, USER_A]), USER_A), true);
  });

  console.log("\nAPI — stale Project.members entry (data left by a pre-fix removal) cannot be used directly");

  await test("GET /api/projects/:id -> 403 for a user in Project.members but not on the Team", async () => {
    const store = makeStore();
    store.db.teams[0].members = [MANAGER, USER_B]; // USER_A gone, project lists untouched
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, USER_A), 403);
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, USER_B), 200, "current member still allowed");
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, MANAGER), 200, "manager still allowed");
  });

  await test("shared layer: getAccessibleProject / getTaskAccess deny the stale member", async () => {
    const store = makeStore();
    store.db.teams[0].members = [MANAGER, USER_B];
    install(store, USER_A);
    const { getAccessibleProject, getTaskAccess } = require("../src/lib/authz.js");
    assert.strictEqual(await getAccessibleProject(PROJ_A1, USER_A), null);
    assert.strictEqual(await getTaskAccess(TASK_A1, USER_A), null);
    assert.ok(await getAccessibleProject(PROJ_A1, USER_B));
    assert.ok(await getTaskAccess(TASK_A1, USER_B));
    assert.ok(await getAccessibleProject(PROJ_A1, MANAGER));
  });

  await test("PATCH /api/tasks/:id and POST /api/projects/:id/columns -> 403 for the stale member (even in 'everyone' edit mode)", async () => {
    const store = makeStore();
    store.db.teams[0].members = [MANAGER, USER_B];
    store.db.projects[0].editingMode = "everyone"; // the canEditProject=true case from the audit
    install(store, USER_A);
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res1 = await PATCH({ json: async () => ({ title: "hijack" }), headers: new Map() }, ctx(TASK_A1));
    assert.strictEqual(res1.status, 403);
    const { POST } = require("../src/app/api/projects/[id]/columns/route.js");
    const res2 = await POST({ json: async () => ({ name: "x" }), headers: new Map() }, ctx(PROJ_A1));
    assert.strictEqual(res2.status, 403);
  });

  console.log("\nDELETE /api/teams/[id]/members — removal + cleanup, end to end");

  await test("Test 1: after removal, the removed member is denied the restricted project via the API", async () => {
    const store = makeStore();
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, USER_A), 200, "precondition: allowed before removal");
    await removeFromTeamA(store, USER_A);
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, USER_A), 403);
    assert.strictEqual(await getProjectStatus(store, PROJ_A2, USER_A), 403);
    assert.strictEqual(await getProjectStatus(store, "111111111111111111111114", USER_A), 403, "legacy project too");
  });

  await test("Test 5: cleanup — gone from Team.members, Project.members, Project.editors and Task.assignees of that team", async () => {
    const store = makeStore();
    await removeFromTeamA(store, USER_A);
    const { teams, projects, tasks } = store.db;
    assert.ok(!has(teams[0].members, USER_A));
    for (const p of projects.filter((p) => p.team === TEAM_A)) {
      assert.ok(!has(p.members, USER_A), `${p.name}.members`);
      assert.ok(!has(p.editors, USER_A), `${p.name}.editors`);
    }
    assert.ok(!has(tasks[0].assignees, USER_A));
  });

  await test("cleanup keeps everyone else, and leaves a legacy project legacy (no `members` field created)", async () => {
    const store = makeStore();
    await removeFromTeamA(store, USER_A);
    const { projects, tasks } = store.db;
    assert.deepStrictEqual(projects[0].members, [USER_B]);
    assert.deepStrictEqual(projects[1].members, []);
    assert.strictEqual("members" in projects[2], false, "legacy project must not gain a members array");
    assert.deepStrictEqual(tasks[0].assignees, [USER_B]);
  });

  await test("Test 6: Team B is untouched — membership, Project.members, editors and assignees survive", async () => {
    const store = makeStore();
    await removeFromTeamA(store, USER_A);
    const { teams, projects, tasks } = store.db;
    assert.ok(has(teams[1].members, USER_A));
    assert.deepStrictEqual(projects[3].members, [USER_A]);
    assert.deepStrictEqual(projects[3].editors, [USER_A]);
    assert.deepStrictEqual(tasks[1].assignees, [USER_A]);
    assert.strictEqual(await getProjectStatus(store, PROJ_B1, USER_A), 200, "still has access to Team B's project");
  });

  await test("cleanup is scoped by team in the actual write filters (bulk, no per-project load)", async () => {
    const store = makeStore();
    await removeFromTeamA(store, USER_A);
    const projWrites = store.log.filter((l) => l.model === "Project");
    assert.strictEqual(projWrites.length, 1, "one bulk Project.updateMany");
    assert.deepStrictEqual(projWrites[0].filter, { team: TEAM_A });
    assert.deepStrictEqual(projWrites[0].update, { $pull: { members: USER_A, editors: USER_A } });
    const taskWrite = store.log.find((l) => l.model === "Task");
    assert.deepStrictEqual(taskWrite.filter.project.$in.sort(), [PROJ_A1, PROJ_A2, "111111111111111111111114"].sort());
  });

  await test("Test 4: after removing a normal member, Team manager and Project manager keep access and edit rights", async () => {
    const store = makeStore();
    await removeFromTeamA(store, USER_A);
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, MANAGER), 200);
    assert.strictEqual(await getProjectStatus(store, PROJ_A2, MANAGER), 200);
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, USER_B), 200, "remaining member still allowed");
    install(store, MANAGER);
    const { getAccessibleProject, canEditProject } = require("../src/lib/authz.js");
    const proj = await getAccessibleProject(PROJ_A1, MANAGER);
    assert.ok(proj && canEditProject(proj, MANAGER));
  });

  await test("a removed member who is re-added to the team does not silently regain old project access", async () => {
    const store = makeStore();
    await removeFromTeamA(store, USER_A);
    store.db.teams[0].members.push(USER_A); // simulate re-invite
    assert.strictEqual(await getProjectStatus(store, PROJ_A1, USER_A), 403);
    assert.strictEqual(await getProjectStatus(store, PROJ_A2, USER_A), 403);
  });

  await test("only the team manager can remove a member; the manager cannot be removed", async () => {
    const store = makeStore();
    install(store, USER_B);
    let { DELETE } = require("../src/app/api/teams/[id]/members/route.js");
    assert.strictEqual((await DELETE(delReq(TEAM_A, USER_A), ctx(TEAM_A))).status, 403);
    assert.ok(has(store.db.projects[0].members, USER_A), "nothing cleaned up on a rejected request");
    install(store, MANAGER);
    ({ DELETE } = require("../src/app/api/teams/[id]/members/route.js"));
    assert.strictEqual((await DELETE(delReq(TEAM_A, MANAGER), ctx(TEAM_A))).status, 400);
  });

  summary();
})();
