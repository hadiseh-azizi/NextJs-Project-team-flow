require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers Project-Level Editing Permission (the change-request flow that
// originally shipped alongside it was removed — the project manager now
// grants edit access directly):
//
//   - lib/authz.js: canEditProject()/isManagerApprovalMode() (the new
//     second gate, on top of the existing view-access one from
//     26-project-membership.test.cjs), and applyProjectEditPermission().
//   - The new POST/DELETE /api/projects/[id]/editors route (grant/revoke,
//     manager-only, target must already have project access).
//   - PATCH /api/projects/[id] accepting the new `editingMode` field.
//   - A route-level spot check that tasks/[id]/route.js and
//     columns/route.js actually call canEditProject and 403 when it
//     returns false — proving the wiring, not re-testing the pure logic.

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const EDITOR_ID = "bbbbbbbbbbbbbbbbbbbbbbbb"; // has project access AND explicit edit permission
const MEMBER_ID = "cccccccccccccccccccccccc"; // has project access, no edit permission
const OUTSIDER_ID = "dddddddddddddddddddddddd"; // no project access at all
const PROJECT_ID = "111111111111111111111111";
const TEAM_ID = "222222222222222222222222";
const TASK_ID = "333333333333333333333333";
const COLUMN_ID = "444444444444444444444444";
const COLUMN2_ID = "555555555555555555555555";
const REQUEST_ID = "666666666666666666666666";

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
  return { _id: TEAM_ID, manager: MANAGER_ID, members: [MANAGER_ID, EDITOR_ID, MEMBER_ID] };
}

(async () => {
  console.log("authz.js — canEditProject / isManagerApprovalMode");

  const { canEditProject, isManagerApprovalMode } = require("../src/lib/authz.js");

  await test("a project with no editingMode field at all (legacy .lean() read) behaves as \"everyone\"", async () => {
    const project = { manager: MANAGER_ID };
    assert.strictEqual(isManagerApprovalMode(project), false);
    assert.strictEqual(canEditProject(project, MEMBER_ID), true);
  });

  await test('"everyone" mode: any user can edit', async () => {
    const project = { manager: MANAGER_ID, editingMode: "everyone" };
    assert.strictEqual(canEditProject(project, MEMBER_ID), true);
    assert.strictEqual(canEditProject(project, OUTSIDER_ID), true);
  });

  await test('"manager_approval" mode: the manager can always edit', async () => {
    const project = { manager: MANAGER_ID, editingMode: "manager_approval", editors: [] };
    assert.strictEqual(canEditProject(project, MANAGER_ID), true);
  });

  await test('"manager_approval" mode: a user not in `editors` cannot edit', async () => {
    const project = { manager: MANAGER_ID, editingMode: "manager_approval", editors: [EDITOR_ID] };
    assert.strictEqual(canEditProject(project, MEMBER_ID), false);
  });

  await test('"manager_approval" mode: a user listed in `editors` can edit', async () => {
    const project = { manager: MANAGER_ID, editingMode: "manager_approval", editors: [EDITOR_ID] };
    assert.strictEqual(canEditProject(project, EDITOR_ID), true);
  });

  await test('"manager_approval" mode with `editors` absent (nobody granted yet): only the manager can edit', async () => {
    const project = { manager: MANAGER_ID, editingMode: "manager_approval" };
    assert.strictEqual(canEditProject(project, MANAGER_ID), true);
    assert.strictEqual(canEditProject(project, EDITOR_ID), false);
  });

  await test("works with a populated manager object (._id), not just a raw id", async () => {
    const project = { manager: { _id: MANAGER_ID }, editingMode: "manager_approval", editors: [{ _id: EDITOR_ID }] };
    assert.strictEqual(canEditProject(project, MANAGER_ID), true);
    assert.strictEqual(canEditProject(project, EDITOR_ID), true);
    assert.strictEqual(canEditProject(project, MEMBER_ID), false);
  });

  // ------------------------------------------------------------------
  console.log("\nauthz.js — isEligibleEditor (team membership AND project access, never the manager)");

  {
    resetModuleCache();
    const { isEligibleEditor } = require("../src/lib/authz.js");
    const project = { manager: MANAGER_ID, team: team(), members: [EDITOR_ID] };
    await test("a team member with project access is eligible", async () => {
      assert.strictEqual(isEligibleEditor(project, EDITOR_ID), true);
    });
    await test("a team member WITHOUT project access is not eligible (team membership alone isn't enough)", async () => {
      assert.strictEqual(isEligibleEditor(project, MEMBER_ID), false);
    });
    await test("a user outside the team is not eligible even if listed in project.members", async () => {
      const p2 = { manager: MANAGER_ID, team: team(), members: [EDITOR_ID, OUTSIDER_ID] };
      assert.strictEqual(isEligibleEditor(p2, OUTSIDER_ID), false);
    });
    await test("the manager is not 'eligible' (they always can edit, never listed)", async () => {
      assert.strictEqual(isEligibleEditor(project, MANAGER_ID), false);
    });
    await test("team membership alone never grants edit in manager_approval mode", async () => {
      const { canEditProject } = require("../src/lib/authz.js");
      const p3 = { manager: MANAGER_ID, team: team(), members: [EDITOR_ID, MEMBER_ID], editingMode: "manager_approval", editors: [EDITOR_ID] };
      assert.strictEqual(canEditProject(p3, MEMBER_ID), false);
      assert.strictEqual(canEditProject(p3, EDITOR_ID), true);
      assert.strictEqual(canEditProject(p3, MANAGER_ID), true);
    });
    await test("revoking project access also clears the user's edit grant", async () => {
      resetModuleCache();
      const calls = [];
      mockModule("@/models/Project", { updateOne: async (f, u) => { calls.push(u); } });
      const { applyProjectMembership } = require("../src/lib/authz.js");
      await applyProjectMembership({ _id: PROJECT_ID, members: [EDITOR_ID], team: team() }, EDITOR_ID, "remove");
      assert.deepStrictEqual(calls[calls.length - 1], { $pull: { members: EDITOR_ID, editors: EDITOR_ID } });
    });
  }

  console.log("\nauthz.js — applyProjectEditPermission");

  await test("adding an editor is a plain $addToSet, with no seeding step (unlike applyProjectMembership)", async () => {
    resetModuleCache();
    const calls = [];
    mockModule("@/models/Project", { updateOne: async (filter, update) => calls.push({ filter, update }) });
    const { applyProjectEditPermission } = require("../src/lib/authz.js");
    await applyProjectEditPermission({ _id: PROJECT_ID }, EDITOR_ID, "add");
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].filter, { _id: PROJECT_ID });
    assert.deepStrictEqual(calls[0].update, { $addToSet: { editors: EDITOR_ID } });
  });

  await test("removing an editor is a plain $pull", async () => {
    resetModuleCache();
    const calls = [];
    mockModule("@/models/Project", { updateOne: async (filter, update) => calls.push({ filter, update }) });
    const { applyProjectEditPermission } = require("../src/lib/authz.js");
    await applyProjectEditPermission({ _id: PROJECT_ID }, EDITOR_ID, "remove");
    assert.deepStrictEqual(calls[0].update, { $pull: { editors: EDITOR_ID } });
  });

  // ------------------------------------------------------------------
  console.log("\nPOST/DELETE /api/projects/[id]/editors — route-level authorization & validation");

  function setupEditorsRouteMocks({ callerId = MANAGER_ID, isProjectMemberFor = () => true } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const projectDoc = { _id: PROJECT_ID, manager: MANAGER_ID, team: team(), members: [EDITOR_ID, MEMBER_ID], createdAt: new Date() };
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
      applyProjectEditPermission: async (project, targetUserId, action) => {
        applyCalls.push({ targetUserId, action });
      },
      isEligibleEditor: (project, userId) => isProjectMemberFor(userId),
    });
    return { applyCalls };
  }

  await test("POST: 401 when there is no session", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => null });
    const { POST } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await POST(fakeReq({ userId: EDITOR_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("POST: 403 when the caller is not the project manager", async () => {
    const { applyCalls } = setupEditorsRouteMocks({ callerId: EDITOR_ID });
    const { POST } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await POST(fakeReq({ userId: MEMBER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("POST: 400 when granting edit permission to the manager themselves", async () => {
    const { applyCalls } = setupEditorsRouteMocks();
    const { POST } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await POST(fakeReq({ userId: MANAGER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("POST: 400 when the target isn't eligible (not on the team / no project access)", async () => {
    const { applyCalls } = setupEditorsRouteMocks({ isProjectMemberFor: () => false });
    const { POST } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await POST(fakeReq({ userId: OUTSIDER_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(applyCalls.length, 0, "granting edit rights to someone who can't even view the project must never happen");
  });

  await test("POST: the manager can grant edit permission to a project member", async () => {
    const { applyCalls } = setupEditorsRouteMocks();
    const { POST } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await POST(fakeReq({ userId: EDITOR_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(applyCalls[0], { targetUserId: EDITOR_ID, action: "add" });
  });

  await test("DELETE: 400 when trying to revoke the project manager's own edit permission", async () => {
    const { applyCalls } = setupEditorsRouteMocks();
    const { DELETE } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await DELETE(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/editors?userId=${MANAGER_ID}`), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(applyCalls.length, 0);
  });

  await test("DELETE: the manager can revoke a member's edit permission", async () => {
    const { applyCalls } = setupEditorsRouteMocks();
    const { DELETE } = require("../src/app/api/projects/[id]/editors/route.js");
    const res = await DELETE(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/editors?userId=${EDITOR_ID}`), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(applyCalls[0], { targetUserId: EDITOR_ID, action: "remove" });
  });

  // ------------------------------------------------------------------
  console.log("\nPATCH /api/projects/[id] — the new `editingMode` field");

  function setupProjectPatchMocks({ callerId = MANAGER_ID } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const projectDoc = { _id: PROJECT_ID, manager: MANAGER_ID, name: "Original", team: team(), createdAt: new Date() };
    const updateCalls = [];
    mockModule("@/models/Project", {
      findById: () => ({
        lean: async () => projectDoc,
        populate: function () { return this; },
      }),
      updateOne: async (filter, update) => updateCalls.push({ filter, update }),
    });
    mockModule("@/models/Column", { find: () => ({ sort: function () { return this; }, lean: async () => [] }) });
    mockModule("@/models/Task", { find: () => ({ select: function () { return this; }, populate: function () { return this; }, sort: function () { return this; }, lean: async () => [] }) });
    return { updateCalls };
  }

  await test("PATCH: only the manager can change editingMode", async () => {
    setupProjectPatchMocks({ callerId: MEMBER_ID });
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ editingMode: "manager_approval" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("PATCH: rejects an invalid editingMode value", async () => {
    setupProjectPatchMocks();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ editingMode: "nonsense" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("PATCH: the manager can switch the project to manager_approval", async () => {
    const { updateCalls } = setupProjectPatchMocks();
    const { PATCH } = require("../src/app/api/projects/[id]/route.js");
    const res = await PATCH(fakeReq({ editingMode: "manager_approval" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.deepStrictEqual(updateCalls[0].update, { $set: { editingMode: "manager_approval" } });
  });

  // ------------------------------------------------------------------
  console.log("\nRoute-level spot check: canEditProject actually gates mutation routes (wiring, not logic)");

  await test("PATCH /api/tasks/[id] returns 403 when canEditProject says no", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MEMBER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      canEditProject: () => false,
      getTaskAccess: async () => ({ task: { _id: TASK_ID }, project: { _id: PROJECT_ID, manager: MANAGER_ID, editingMode: "manager_approval" } }),
    });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ title: "New title" }), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("PATCH /api/tasks/[id] proceeds when canEditProject says yes (wiring doesn't over-block)", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: EDITOR_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      canEditProject: () => true,
      getTaskAccess: async () => ({
        task: { _id: TASK_ID, column: COLUMN_ID, project: PROJECT_ID, save: async function () {} },
        project: { _id: PROJECT_ID, manager: MANAGER_ID, editingMode: "manager_approval", editors: [EDITOR_ID] },
      }),
    });
    mockModule("@/models/Task", {
      findById: () => ({
        select: function () { return this; },
        populate: function () { return this; },
        lean: async () => ({ _id: TASK_ID, title: "New title", column: COLUMN_ID, project: PROJECT_ID, attachments: [], assignees: [] }),
      }),
      updateOne: async () => {},
    });
    const { PATCH } = require("../src/app/api/tasks/[id]/route.js");
    const res = await PATCH(fakeReq({ title: "New title" }), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
  });

  await test("POST /api/projects/[id]/columns returns 403 when canEditProject says no", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MEMBER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      canEditProject: () => false,
      getAccessibleProject: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID, editingMode: "manager_approval" }),
    });
    const { POST } = require("../src/app/api/projects/[id]/columns/route.js");
    const res = await POST(fakeReq({ name: "New column" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  console.log("\nEvery task/column/attachment mutation route is gated by canEditProject");
  {
    const fs = require("fs");
    const path = require("path");
    const routes = [
      ["tasks/route.js", ["POST"]],
      ["tasks/[id]/route.js", ["PATCH", "DELETE"]],
      ["tasks/[id]/attachments/route.js", ["POST"]],
      ["tasks/[id]/attachments/[attachmentId]/route.js", ["DELETE"]],
      ["projects/[id]/columns/route.js", ["POST"]],
      ["projects/[id]/columns/[columnId]/route.js", ["PATCH", "DELETE"]],
      ["projects/[id]/columns/order/route.js", ["PATCH"]],
    ];
    for (const [file, methods] of routes) {
      const src = fs.readFileSync(path.join(__dirname, "../src/app/api", file), "utf8");
      for (const m of methods) {
        await test(`${file} ${m} checks canEditProject`, async () => {
          const start = src.indexOf(`export async function ${m}(`);
          assert.ok(start >= 0, "handler not found");
          const next = src.indexOf("export async function", start + 10);
          const body = src.slice(start, next === -1 ? undefined : next);
          assert.ok(/canEditProject\(/.test(body), "no canEditProject call in handler");
        });
      }
    }
    await test("the removed change-request flow is gone (no routes, model or components)", async () => {
      for (const f of ["models/ChangeRequest.js", "components/RequestChangeDialog.jsx", "components/ChangeRequestsPanel.jsx", "app/api/projects/[id]/change-requests"]) {
        assert.ok(!fs.existsSync(path.join(__dirname, "../src", f)), f + " should not exist");
      }
    });
  }

  summary();
})();
