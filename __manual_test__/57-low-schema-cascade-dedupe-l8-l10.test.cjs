require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// L8-L10 (Low-priority schema constraints, cascade cleanup, duplication).
// Real models and route files are loaded; only the DB access is faked.

const SRC = path.resolve(__dirname, "../src");
const MANAGER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PID = "111111111111111111111111";
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const req = (body) => ({ json: async () => body, url: "http://localhost/api/x", headers: new Headers() });
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");

(async () => {
  // ------------------------------------------------------------- L8
  console.log("L8 - schema maxlength + updatedAt");
  resetModuleCache();
  const limits = require("../src/lib/fieldLimits.js");
  const Project = require("../src/models/Project.js").default;
  const Team = require("../src/models/Team.js").default;
  const Task = require("../src/models/Task.js").default;
  const Column = require("../src/models/Column.js").default;
  const oid = () => new (require("mongoose").Types.ObjectId)();
  const s = (n) => "x".repeat(n);

  const cases = [
    ["Project.name", () => new Project({ name: s(limits.MAX_PROJECT_NAME_LENGTH), manager: oid(), team: oid() }), (n) => new Project({ name: s(n), manager: oid(), team: oid() }), limits.MAX_PROJECT_NAME_LENGTH],
    ["Project.description", null, (n) => new Project({ name: "p", description: s(n), manager: oid(), team: oid() }), limits.MAX_PROJECT_DESCRIPTION_LENGTH],
    ["Team.name", null, (n) => new Team({ name: s(n), manager: oid() }), limits.MAX_TEAM_NAME_LENGTH],
    ["Column.name", null, (n) => new Column({ name: s(n), project: oid() }), limits.MAX_COLUMN_NAME_LENGTH],
    ["Task.title", null, (n) => new Task({ title: s(n), column: oid(), project: oid() }), limits.MAX_TASK_TITLE_LENGTH],
    ["Task.description", null, (n) => new Task({ title: "t", description: s(n), column: oid(), project: oid() }), limits.MAX_TASK_DESCRIPTION_LENGTH],
  ];
  for (const [name, , make, max] of cases) {
    await test(`${name}: accepts exactly ${max}, rejects ${max + 1}`, () => {
      assert.strictEqual(make(max).validateSync(), undefined);
      assert.ok(make(max + 1).validateSync(), "should be rejected");
    });
  }
  await test("limits match what the routes already enforced", () => {
    assert.deepStrictEqual(
      [limits.MAX_TEAM_NAME_LENGTH, limits.MAX_PROJECT_NAME_LENGTH, limits.MAX_PROJECT_DESCRIPTION_LENGTH, limits.MAX_COLUMN_NAME_LENGTH, limits.MAX_TASK_TITLE_LENGTH, limits.MAX_TASK_DESCRIPTION_LENGTH],
      [100, 150, 2000, 60, 200, 5000]
    );
  });
  await test("legacy over-length value stays readable and doesn't block saving another field", () => {
    const legacy = Task.hydrate({ _id: oid(), title: "ok", description: s(6000), column: oid(), project: oid() });
    assert.strictEqual(legacy.description.length, 6000);
    legacy.completed = true;
    assert.strictEqual(legacy.validateSync(), undefined, "unrelated edit must still validate");
    legacy.description = s(6000) + "y";
    assert.ok(legacy.validateSync(), "editing the over-length field itself is held to the limit");
  });
  await test("timestamps: updatedAt added, createdAt unchanged (still the explicit default)", () => {
    for (const M of [Project, Team, Task, Column]) {
      assert.ok(M.schema.path("updatedAt"), `${M.modelName} has updatedAt`);
      assert.strictEqual(M.schema.path("createdAt").options.default, Date.now, `${M.modelName} createdAt default intact`);
    }
  });
  await test("DTOs do not expose updatedAt", () => {
    const { toTaskDTO, toColumnDTO, toProjectDTO, toTeamDTO } = require("../src/lib/serialize.js");
    const now = new Date();
    const base = { _id: oid(), createdAt: now, updatedAt: now };
    const json = JSON.stringify([
      toTaskDTO({ ...base, title: "t", column: oid(), project: oid(), order: 0 }),
      toColumnDTO({ ...base, name: "c", order: 0 }),
      toTeamDTO({ ...base, name: "t", manager: null, members: [] }),
      toProjectDTO({ ...base, name: "p", manager: null, team: { ...base, name: "t", members: [] } }, [], []),
    ]);
    assert.ok(!json.includes("updatedAt"));
  });

  // ------------------------------------------------------------- L9
  console.log("L9 - cascade cleanup");
  await test("ChangeRequest stays removed: no model, no routes", () => {
    assert.ok(!fs.existsSync(path.join(SRC, "models/ChangeRequest.js")));
    assert.ok(!fs.existsSync(path.join(SRC, "app/api/projects/[id]/change-requests")));
  });

  function setupProjectDelete(userId) {
    resetModuleCache();
    const calls = { project: [], tasks: [], columns: [] };
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: userId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: PID, manager: MANAGER, shareEnabled: true, shareToken: "tok" }) }),
      findByIdAndDelete: async (id) => calls.project.push(id),
    });
    mockModule("@/models/Task", { deleteMany: async (f) => calls.tasks.push(f) });
    mockModule("@/models/Column", { deleteMany: async (f) => calls.columns.push(f) });
    const mongoose = require("mongoose");
    mockModule("mongoose", { ...mongoose, startSession: async () => ({ withTransaction: async () => { throw new Error("Transaction numbers are only allowed on a replica set member or mongos"); }, endSession: async () => {} }) });
    return { calls, route: require("../src/app/api/projects/[id]/route.js") };
  }
  await test("project delete by manager removes the project (incl. its embedded share state), its tasks and columns - only for that project", async () => {
    const { calls, route } = setupProjectDelete(MANAGER);
    const res = await route.DELETE(req(), ctx(PID));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
    assert.deepStrictEqual(calls.project, [PID]);
    assert.deepStrictEqual(calls.tasks, [{ project: PID }]);
    assert.deepStrictEqual(calls.columns, [{ project: PID }]);
  });
  await test("project delete by a non-manager is 403 and deletes nothing", async () => {
    const { calls, route } = setupProjectDelete(OTHER);
    const res = await route.DELETE(req(), ctx(PID));
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual([calls.project, calls.tasks, calls.columns], [[], [], []]);
  });
  await test("task delete touches only the task (attachments are embedded; no other collection references a task)", () => {
    const src = read("app/api/tasks/[id]/route.js");
    const del = src.slice(src.indexOf("export async function DELETE"));
    assert.ok(/Task\.findByIdAndDelete\(id\)/.test(del));
    assert.ok(!/deleteMany|updateMany|Column\./.test(del));
  });

  // ------------------------------------------------------------- L10
  console.log("L10 - duplication");
  await test("duplicated helpers/constants no longer defined outside their shared home", () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(SRC).filter((f) => /\.jsx?$/.test(f));
    const find = (re) => files.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
    assert.deepStrictEqual(find(/^const TEAM_POPULATE\b|^export const TEAM_POPULATE\b/m), ["lib/projectQueries.js"]);
    assert.deepStrictEqual(find(/function respondWithUpdatedProject/), ["lib/projectQueries.js"]);
    assert.deepStrictEqual(find(/function loadProjectAsManager/), ["lib/projectQueries.js"]);
    assert.deepStrictEqual(find(/function formatSize/), ["lib/formatSize.js"]);
    assert.deepStrictEqual(find(/^const MAX_(TEAM_NAME|PROJECT_NAME|PROJECT_DESCRIPTION|COLUMN_NAME|TASK_TITLE|TASK_DESCRIPTION)_LENGTH = \d+/m), []);
  });
  await test("formatSize output unchanged", () => {
    resetModuleCache();
    const { formatSize } = require("../src/lib/formatSize.js");
    assert.deepStrictEqual([formatSize(500), formatSize(2048), formatSize(5 * 1024 * 1024)], ["500 B", "2.0 KB", "5.0 MB"]);
  });
  await test("password min length comes from the policy (register page + strength meter)", () => {
    assert.ok(!/minLength: 6|At least 6/.test(read("app/register/page.jsx")));
    resetModuleCache();
    const { scorePasswordStrength } = require("../src/lib/passwordStrength.js");
    assert.strictEqual(scorePasswordStrength("abcde").label, "Too short");
    assert.notStrictEqual(scorePasswordStrength("abcdef").label, "Too short");
  });

  function chain(result, log) {
    const q = { populate: (p) => (log.push(p), q), sort: (s) => (log.push({ sort: s }), q), lean: async () => result };
    return q;
  }
  const managerFixture = { _id: PID, manager: MANAGER, team: { members: [] } };
  async function callManagerRoute(file, method, user, id, urlSuffix = "") {
    resetModuleCache();
    const populates = [];
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: user } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", { findById: () => chain(managerFixture, populates) });
    mockModule("@/models/Column", {});
    mockModule("@/models/Task", {});
    const route = require(`../src/app/api/projects/[id]/${file}/route.js`);
    const r = req({ userId: OTHER });
    r.url = "http://localhost/api/x" + urlSuffix;
    const res = await route[method](r, ctx(id));
    return { res, populates, body: await res.json() };
  }
  for (const [file, msg, expectPopulate] of [
    ["members", "Only the project manager can manage project access", ["team"]],
    ["editors", "Only the project manager can manage editing permissions", ["team", { path: "members", select: "name email" }]],
    ["share", "Only the project manager can manage sharing", []],
  ]) {
    await test(`${file}: non-manager 403 with its own message; bad id 404; populate steps preserved`, async () => {
      const denied = await callManagerRoute(file, file === "share" ? "POST" : "POST", OTHER, PID);
      assert.strictEqual(denied.res.status, 403);
      assert.strictEqual(denied.body.error, msg);
      assert.deepStrictEqual(denied.populates, expectPopulate);
      const bad = await callManagerRoute(file, "POST", MANAGER, "not-an-id");
      assert.strictEqual(bad.res.status, 404);
      assert.strictEqual(bad.body.error, "Project not found");
    });
  }
  await test("findAccessibleProjects: same $or query, newest-first, access-filtered; callers choose populate", async () => {
    resetModuleCache();
    const finds = [];
    const log = [];
    mockModule("@/lib/authz", {
      accessibleTeamIds: async () => ["t1"],
      filterAccessibleProjects: (list, uid) => list.filter((p) => p.ok && uid === MANAGER),
    });
    mockModule("@/models/Project", { find: (f) => (finds.push(f), chain([{ _id: 1, ok: true }, { _id: 2, ok: false }], log)) });
    mockModule("@/models/Column", {});
    mockModule("@/models/Task", {});
    const { findAccessibleProjects } = require("../src/lib/projectQueries.js");
    const out = await findAccessibleProjects(MANAGER, [{ path: "team", select: "members" }]);
    assert.deepStrictEqual(finds, [{ $or: [{ manager: MANAGER }, { team: { $in: ["t1"] } }] }]);
    assert.deepStrictEqual(log, [{ path: "team", select: "members" }, { sort: { createdAt: -1 } }]);
    assert.deepStrictEqual(out, [{ _id: 1, ok: true }]);
  });

  summary();
})();
