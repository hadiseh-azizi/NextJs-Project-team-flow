require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers the new Project-Level Editing Permission + Change Request
// feature:
//
//   - lib/authz.js: canEditProject()/isManagerApprovalMode() (the new
//     second gate, on top of the existing view-access one from
//     26-project-membership.test.cjs), and applyProjectEditPermission().
//   - The new POST/DELETE /api/projects/[id]/editors route (grant/revoke,
//     manager-only, target must already have project access).
//   - PATCH /api/projects/[id] accepting the new `editingMode` field.
//   - The new POST/GET /api/projects/[id]/change-requests routes.
//   - The new PATCH /api/projects/[id]/change-requests/[requestId] route —
//     in particular, that an approved moveTask/toggleComplete request is
//     only auto-applied after re-checking the target still exists, and
//     that editTask/other are never auto-applied.
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
      projectAccessFor: (project, userId) => ({ isProjectMember: isProjectMemberFor(userId) }),
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

  await test("POST: 400 when the target doesn't already have access to the project", async () => {
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
  console.log("\nPOST /api/projects/[id]/change-requests — creation & validation");

  function setupCreateRequestMocks({ callerId = MEMBER_ID, taskExists = true, columnExists = true } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", { getAccessibleProject: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) });
    mockModule("@/models/Task", {
      findOne: () => ({ select: function () { return this; }, lean: async () => (taskExists ? { _id: TASK_ID } : null) }),
    });
    mockModule("@/models/Column", {
      findOne: () => ({ select: function () { return this; }, lean: async () => (columnExists ? { _id: COLUMN_ID } : null) }),
    });
    let created = null;
    mockModule("@/models/ChangeRequest", {
      CHANGE_REQUEST_ACTION_TYPES: ["moveTask", "toggleComplete", "editTask", "other"],
      create: async (doc) => {
        created = { _id: REQUEST_ID, status: "pending", createdAt: new Date(), respondedAt: null, respondedBy: null, applyError: null, ...doc };
        return created;
      },
      findById: () => ({
        populate: function () { return this; },
        lean: async () => ({
          ...created,
          requester: { _id: created.requester, name: "Member" },
          targetTask: created.targetTask ? { _id: created.targetTask, title: "A task" } : null,
          targetColumn: created.targetColumn ? { _id: created.targetColumn, name: "A column" } : null,
        }),
      }),
    });
    return () => created;
  }

  await test("rejects an invalid actionType", async () => {
    setupCreateRequestMocks();
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(fakeReq({ actionType: "deleteEverything", description: "x" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("rejects a missing/empty description", async () => {
    setupCreateRequestMocks();
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(fakeReq({ actionType: "other", description: "   " }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("moveTask without a targetTaskId is rejected", async () => {
    setupCreateRequestMocks();
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(fakeReq({ actionType: "moveTask", description: "move it", targetColumnId: COLUMN_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("moveTask without a targetColumnId is rejected", async () => {
    setupCreateRequestMocks();
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(fakeReq({ actionType: "moveTask", description: "move it", targetTaskId: TASK_ID }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("a targetTaskId that isn't actually in this project is rejected", async () => {
    setupCreateRequestMocks({ taskExists: false });
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(
      fakeReq({ actionType: "toggleComplete", description: "mark it done", targetTaskId: TASK_ID }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    assert.strictEqual(res.status, 404);
  });

  await test("a targetColumnId that isn't actually in this project is rejected", async () => {
    setupCreateRequestMocks({ columnExists: false });
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(
      fakeReq({ actionType: "moveTask", description: "move it", targetTaskId: TASK_ID, targetColumnId: COLUMN_ID }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    assert.strictEqual(res.status, 404);
  });

  await test("a well-formed moveTask request is created as pending", async () => {
    setupCreateRequestMocks();
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(
      fakeReq({ actionType: "moveTask", description: "please move this to Done", targetTaskId: TASK_ID, targetColumnId: COLUMN_ID }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.status, "pending");
    assert.strictEqual(json.actionType, "moveTask");
  });

  await test("an 'other' request needs no target at all", async () => {
    setupCreateRequestMocks();
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(fakeReq({ actionType: "other", description: "please add a Blocked column" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 201);
  });

  await test("access is denied (403) for someone with no view access to the project at all", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OUTSIDER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", { getAccessibleProject: async () => null });
    const { POST } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await POST(fakeReq({ actionType: "other", description: "x" }), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  // ------------------------------------------------------------------
  console.log("\nGET /api/projects/[id]/change-requests — manager sees all, everyone else sees only their own");

  function setupListRequestMocks({ callerId, managerId = MANAGER_ID, findResult }) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", { getAccessibleProject: async () => ({ _id: PROJECT_ID, manager: managerId }) });
    let capturedFilter = null;
    mockModule("@/models/ChangeRequest", {
      find: (filter) => {
        capturedFilter = filter;
        return {
          sort: function () { return this; },
          populate: function () { return this; },
          lean: async () => findResult,
        };
      },
    });
    return () => capturedFilter;
  }

  await test("the manager's query is not scoped to `requester` — they see every request", async () => {
    const getFilter = setupListRequestMocks({ callerId: MANAGER_ID, findResult: [] });
    const { GET } = require("../src/app/api/projects/[id]/change-requests/route.js");
    await GET(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/change-requests`), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(getFilter(), "requester"), false);
  });

  await test("a non-manager's query is scoped to their own requests only", async () => {
    const getFilter = setupListRequestMocks({ callerId: MEMBER_ID, findResult: [] });
    const { GET } = require("../src/app/api/projects/[id]/change-requests/route.js");
    await GET(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/change-requests`), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(getFilter().requester, MEMBER_ID);
  });

  await test("an invalid ?status= filter is rejected with 400", async () => {
    setupListRequestMocks({ callerId: MANAGER_ID, findResult: [] });
    const { GET } = require("../src/app/api/projects/[id]/change-requests/route.js");
    const res = await GET(fakeReqWithUrl(`http://x/api/projects/${PROJECT_ID}/change-requests?status=bogus`), { params: Promise.resolve({ id: PROJECT_ID }) });
    assert.strictEqual(res.status, 400);
  });

  // ------------------------------------------------------------------
  console.log("\nPATCH /api/projects/[id]/change-requests/[requestId] — approve/reject, with safe re-validation");

  function baseChangeRequestDoc(overrides = {}) {
    return {
      _id: REQUEST_ID,
      project: PROJECT_ID,
      requester: MEMBER_ID,
      actionType: "other",
      targetTask: null,
      targetColumn: null,
      description: "please do something",
      status: "pending",
      createdAt: new Date(),
      respondedAt: null,
      respondedBy: null,
      applyError: null,
      save: async function () { this.saved = true; },
      ...overrides,
    };
  }

  function setupDecideMocks({ callerId = MANAGER_ID, requestDoc, taskDoc = undefined, columnDoc = undefined } = {}) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: callerId } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", { findById: () => ({ select: function () { return this; }, lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }) });
    mockModule("@/models/ChangeRequest", {
      findOne: () => requestDoc,
      findById: () => ({
        populate: function () { return this; },
        lean: async () => ({
          ...requestDoc,
          requester: { _id: requestDoc.requester, name: "Member" },
          targetTask: requestDoc.targetTask ? { _id: requestDoc.targetTask, title: "A task" } : null,
          targetColumn: requestDoc.targetColumn ? { _id: requestDoc.targetColumn, name: "A column" } : null,
          respondedBy: requestDoc.respondedBy ? { _id: requestDoc.respondedBy, name: "Manager" } : null,
        }),
      }),
    });
    const taskSaveCalls = [];
    mockModule("@/models/Task", {
      findOne: (filter) => {
        if (taskDoc === null) return null;
        if (taskDoc === undefined) return null;
        return { ...taskDoc, save: async function () { taskSaveCalls.push({ ...this }); } };
      },
    });
    mockModule("@/models/Column", {
      findOne: () => ({ lean: async () => columnDoc ?? null }),
    });
    return { taskSaveCalls };
  }

  await test("403 when the caller is not the project manager", async () => {
    setupDecideMocks({ callerId: MEMBER_ID, requestDoc: baseChangeRequestDoc() });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("409 when the request has already been decided", async () => {
    setupDecideMocks({ requestDoc: baseChangeRequestDoc({ status: "approved" }) });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "rejected" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    assert.strictEqual(res.status, 409);
  });

  await test("rejecting never touches any task, regardless of actionType", async () => {
    const { taskSaveCalls } = setupDecideMocks({
      requestDoc: baseChangeRequestDoc({ actionType: "toggleComplete", targetTask: TASK_ID }),
      taskDoc: { _id: TASK_ID, project: PROJECT_ID, completed: false },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "rejected" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(json.status, "rejected");
    assert.strictEqual(taskSaveCalls.length, 0);
  });

  await test("approving toggleComplete marks the task completed", async () => {
    const { taskSaveCalls } = setupDecideMocks({
      requestDoc: baseChangeRequestDoc({ actionType: "toggleComplete", targetTask: TASK_ID }),
      taskDoc: { _id: TASK_ID, project: PROJECT_ID, completed: false },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.status, "approved");
    assert.strictEqual(json.applyError, null);
    assert.strictEqual(taskSaveCalls.length, 1);
    assert.strictEqual(taskSaveCalls[0].completed, true);
  });

  await test("approving toggleComplete on an already-completed task is a safe no-op, not an error", async () => {
    const { taskSaveCalls } = setupDecideMocks({
      requestDoc: baseChangeRequestDoc({ actionType: "toggleComplete", targetTask: TASK_ID }),
      taskDoc: { _id: TASK_ID, project: PROJECT_ID, completed: true },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(json.applyError, null);
    assert.strictEqual(taskSaveCalls.length, 0, "already completed — nothing to save");
  });

  await test("approving toggleComplete records applyError instead of throwing when the task was deleted meanwhile", async () => {
    setupDecideMocks({
      requestDoc: baseChangeRequestDoc({ actionType: "toggleComplete", targetTask: TASK_ID }),
      taskDoc: null,
    });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, "the decision itself still succeeds");
    assert.strictEqual(json.status, "approved");
    assert.ok(json.applyError, "should explain that the automatic follow-through couldn't happen");
  });

  await test("approving moveTask re-validates and moves the task to the destination column", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Project", { findById: () => ({ select: function () { return this; }, lean: async () => ({ _id: PROJECT_ID, manager: MANAGER_ID }) }) });
    const requestDoc = baseChangeRequestDoc({ actionType: "moveTask", targetTask: TASK_ID, targetColumn: COLUMN2_ID });
    mockModule("@/models/ChangeRequest", {
      findOne: () => requestDoc,
      findById: () => ({
        populate: function () { return this; },
        lean: async () => ({ ...requestDoc, requester: { _id: MEMBER_ID }, targetTask: { _id: TASK_ID, title: "A task" }, targetColumn: { _id: COLUMN2_ID, name: "Done" }, respondedBy: { _id: MANAGER_ID } }),
      }),
    });
    let savedTask = null;
    const taskDoc = { _id: TASK_ID, project: PROJECT_ID, column: COLUMN_ID, order: 500, save: async function () { savedTask = { ...this }; } };
    mockModule("@/models/Task", { findOne: () => taskDoc });
    mockModule("@/models/Column", { findOne: () => ({ lean: async () => ({ _id: COLUMN2_ID, project: PROJECT_ID }) }) });
    mockModule("@/lib/taskOrdering", {
      planTaskMove: async ({ task, destColumnId }) => {
        task.column = destColumnId;
      },
      withOptionalTransaction: async (fn) => fn(null),
    });

    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.applyError, null);
    assert.strictEqual(savedTask.column, COLUMN2_ID);
  });

  await test("approving moveTask records applyError when the destination column was deleted meanwhile", async () => {
    setupDecideMocks({
      requestDoc: baseChangeRequestDoc({ actionType: "moveTask", targetTask: TASK_ID, targetColumn: COLUMN2_ID }),
      taskDoc: { _id: TASK_ID, project: PROJECT_ID, column: COLUMN_ID },
      columnDoc: null, // deleted
    });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.status, "approved");
    assert.ok(json.applyError);
  });

  await test("approving an editTask/other request never touches a task — it's just a recorded decision", async () => {
    const { taskSaveCalls } = setupDecideMocks({
      requestDoc: baseChangeRequestDoc({ actionType: "editTask", targetTask: TASK_ID }),
      taskDoc: { _id: TASK_ID, project: PROJECT_ID, completed: false },
    });
    const { PATCH } = require("../src/app/api/projects/[id]/change-requests/[requestId]/route.js");
    const res = await PATCH(fakeReq({ status: "approved" }), { params: Promise.resolve({ id: PROJECT_ID, requestId: REQUEST_ID }) });
    const json = await res.json();
    assert.strictEqual(json.status, "approved");
    assert.strictEqual(json.applyError, null);
    assert.strictEqual(taskSaveCalls.length, 0, "editTask is a description for the manager, never auto-applied");
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

  summary();
})();
