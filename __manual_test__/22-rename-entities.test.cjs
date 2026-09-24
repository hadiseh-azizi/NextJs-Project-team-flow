require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers the new rename/edit-name feature: PATCH /api/projects/[id] and
// PATCH /api/teams/[id] (both added by this phase), plus a couple of
// route-level regression checks that the pre-existing task-title and
// column-name rename paths still enforce the same rules. Focus is on the
// three things the feature spec calls out explicitly: authorization
// (only the manager can rename a project/team), server-side validation
// (empty/whitespace-only names rejected), and that a successful rename
// actually persists (the right $set reaches the model).

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OUTSIDER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const MEMBER_ID = "cccccccccccccccccccccccc";
const PROJECT_ID = "111111111111111111111111";
const TEAM_ID = "222222222222222222222222";
const NOT_AN_OBJECT_ID = "not-a-valid-id";

function fakeReq(body) {
  return {
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
    headers: new Map(),
  };
}

// A stand-in for @/lib/serialize's DTO builders: these tests care that
// the route authorizes, validates, and writes correctly — not about the
// serialized response shape, which is already covered by the existing
// project/team GET-route tests.
const fakeSerialize = {
  toProjectDTO: (project) => ({ id: String(project._id), name: project.name }),
  toTeamDTO: (team) => ({ id: String(team._id), name: team.name }),
};

(async () => {
  console.log("PATCH /api/projects/[id] — rename authorization & validation");

  await test("401 when there is no session", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => null });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "New name" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("404 for a malformed project id — never reaches the database", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => {
        throw new Error("should not query with an invalid id");
      },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "New name" }), { params: Promise.resolve({ id: NOT_AN_OBJECT_ID }) });
    assert.strictEqual(res.status, 404);
  });

  await test("403 when the caller is not the project's manager — a team member cannot rename it", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MEMBER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    let updateCalled = false;
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }),
      updateOne: async () => {
        updateCalled = true;
      },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "New name" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(/manager/i.test(json.error));
    assert.strictEqual(updateCalled, false, "a denied rename must never reach the database write");
  });

  await test("403 for a total outsider, same as a non-manager team member", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OUTSIDER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }),
    });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "New name" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("400 for an empty name, even as the manager", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    let updateCalled = false;
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }),
      updateOne: async () => {
        updateCalled = true;
      },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(updateCalled, false);
  });

  await test("400 for a whitespace-only name", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    let updateCalled = false;
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }),
      updateOne: async () => {
        updateCalled = true;
      },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "   \n\t  " }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(updateCalled, false);
  });

  await test("400 when name is missing from the body entirely", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }),
    });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({}), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("the manager can rename it — the trimmed name is persisted and the response reflects it", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/serialize", fakeSerialize);
    let updateFilter = null;
    let updateOp = null;
    let currentName = "Old name";
    mockModule("@/models/Project", {
      findById: () => ({
        // Reflects the write below, so the post-update re-fetch the
        // route does returns the new name — same as a real database
        // would after updateOne().
        lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID, name: currentName }),
        populate() {
          return this;
        },
      }),
      updateOne: async (filter, op) => {
        updateFilter = filter;
        updateOp = op;
        currentName = op.$set.name;
      },
    });
    mockModule("@/models/Column", { find: () => ({ sort: () => ({ lean: async () => [] }) }) });
    mockModule("@/models/Task", {
      find: () => ({ select: () => ({ populate: () => ({ sort: () => ({ lean: async () => [] }) }) }) }),
    });

    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "  Renamed Project  " }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();

    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(updateFilter, { _id: PROJECT_ID });
    assert.deepStrictEqual(updateOp, { $set: { name: "Renamed Project" } }, "the name must be trimmed before being persisted");
    assert.strictEqual(json.name, "Renamed Project");
  });

  console.log("\nPATCH /api/teams/[id] — rename authorization & validation");

  await test("401 when there is no session", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => null });
    const { PATCH } = require("../src/app/api/teams/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "New name" }), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("403 when the caller is a team member but not the manager", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MEMBER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    let updateCalled = false;
    mockModule("@/models/Team", {
      findById: () => ({ lean: async () => ({ _id: TEAM_ID, manager: MANAGER_ID, members: [MEMBER_ID] }) }),
      updateOne: async () => {
        updateCalled = true;
      },
    });
    const { PATCH } = require("../src/app/api/teams/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "New name" }), { params: Promise.resolve({ id: TEAM_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(/manager/i.test(json.error));
    assert.strictEqual(updateCalled, false, "a denied rename must never reach the database write");
  });

  await test("400 for an empty name, even as the manager", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    let updateCalled = false;
    mockModule("@/models/Team", {
      findById: () => ({ lean: async () => ({ _id: TEAM_ID, manager: MANAGER_ID, members: [] }) }),
      updateOne: async () => {
        updateCalled = true;
      },
    });
    const { PATCH } = require("../src/app/api/teams/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "   " }), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(updateCalled, false);
  });

  await test("the manager can rename it — the trimmed name is persisted", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/serialize", fakeSerialize);
    mockModule("@/models/Invitation", { find: () => ({ sort: () => ({ lean: async () => [] }) }) });
    let updateFilter = null;
    let updateOp = null;
    let currentName = "Old name";
    mockModule("@/models/Team", {
      findById: () => ({
        lean: async () => ({ _id: TEAM_ID, manager: MANAGER_ID, members: [], name: currentName }),
        populate() {
          return this;
        },
      }),
      updateOne: async (filter, op) => {
        updateFilter = filter;
        updateOp = op;
        currentName = op.$set.name;
      },
    });

    const { PATCH } = require("../src/app/api/teams/[id]/route.js");
    const res = await PATCH(fakeReq({ name: "  Renamed Team  " }), { params: Promise.resolve({ id: TEAM_ID }) });
    const json = await res.json();

    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(updateFilter, { _id: TEAM_ID });
    assert.deepStrictEqual(updateOp, { $set: { name: "Renamed Team" } });
    assert.strictEqual(json.name, "Renamed Team");
  });

  console.log("\nPATCH /api/tasks/[id] — title rename validation still holds (pre-existing route, re-checked here)");

  await test("400 for a whitespace-only task title, task is not saved", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const fakeTask = { title: "Original title", save: async () => { throw new Error("must not save an invalid title"); } };
    mockModule("@/models/Task", {
      findById: () => ({ select: () => Promise.resolve(fakeTask) }),
    });
    mockModule("@/models/Project", {
      findById: () => ({ populate: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID, team: { members: [] } }) }) }),
    });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ title: "   " }), { params: Promise.resolve({ id: "333333333333333333333333" }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(fakeTask.title, "Original title", "the in-memory task must not be mutated by a rejected update");
  });

  console.log("\nPATCH /api/projects/[id]/columns/[columnId] — rename authorization still holds (pre-existing route, re-checked here)");

  await test("400 for a whitespace-only column name", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", {
      findById: () => ({ populate: () => ({ lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID, team: { members: [] } }) }) }),
    });
    let updateCalled = false;
    mockModule("@/models/Column", {
      findOne: () => ({
        lean: async () => ({ _id: "555555555555555555555555", project: PROJECT_ID, name: "Original column", isDoneColumn: false }),
      }),
      findOneAndUpdate: async () => {
        updateCalled = true;
      },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await PATCH(fakeReq({ name: "\t\n" }), {
      params: Promise.resolve({ id: PROJECT_ID, columnId: "555555555555555555555555" }),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(updateCalled, false, "a rejected rename must never be saved");
  });

  summary();
})();
