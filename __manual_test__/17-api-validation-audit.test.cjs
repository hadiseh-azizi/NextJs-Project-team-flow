require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Covers this phase's audit (API_VALIDATION_AUDIT.md): input validation,
// error handling, and data-shape robustness across every route handler.
// Almost everything the audit's 20-point checklist calls for was already
// in place from prior phases (see CHANGELOG.md) — this file targets the
// three confirmed gaps this pass actually found and fixed, plus a few
// route-level spot checks for edge cases not already exercised by
// 08-authz-and-validation.test.cjs (which covers the pure validators in
// isolation, not these routes).

const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PROJECT_ID = "111111111111111111111111";
const TEAM_ID = "222222222222222222222222";
const TASK_ID = "333333333333333333333333";
const INVITATION_ID = "444444444444444444444444";

function fakeReq(body) {
  return {
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
    headers: new Map(),
  };
}

(async () => {
  console.log("authz.js — validateAssignees array-size ceiling (Issue: unbounded huge array)");

  const { validateAssignees } = require("../src/lib/authz.js");

  await test("rejects an oversized assigneeIds array instead of processing it", async () => {
    const project = { manager: OID_A, team: { members: [] } };
    // Larger than any real team could legitimately submit; the whole
    // point is that this is rejected on length alone, before any
    // per-element ObjectId validation runs.
    const huge = new Array(50_000).fill(OID_A);
    const result = validateAssignees(project, huge);
    assert.ok(result.error, "an oversized array must be rejected");
    assert.ok(/too many/i.test(result.error));
  });

  await test("still accepts a normal, real-world-sized assigneeIds array", async () => {
    const project = { manager: OID_A, team: { members: [{ _id: OID_B }] } };
    const result = validateAssignees(project, [OID_A, OID_B]);
    assert.deepStrictEqual(result.assignees.sort(), [OID_A, OID_B].sort());
  });

  await test("the ceiling itself is generous enough not to affect a large-but-real team", async () => {
    const members = Array.from({ length: 150 }, (_, i) => ({
      _id: i.toString(16).padStart(24, "0"),
    }));
    const project = { manager: OID_A, team: { members } };
    const ids = members.map((m) => m._id);
    const result = validateAssignees(project, ids);
    assert.ok(!result.error, `150 legitimate members should not hit the ceiling: ${result.error}`);
    assert.strictEqual(result.assignees.length, 150);
  });

  console.log("\nDELETE /api/teams/[id]/invitations/[invitationId] — unexpected-error handling");

  await test("an unexpected DB error returns a clean JSON 500, not an uncaught throw", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Team", {
      findById: () => ({ lean: async () => ({ _id: TEAM_ID, manager: OID_A }) }),
    });
    mockModule("@/models/Invitation", {
      deleteOne: async () => {
        throw new Error("connection reset by peer");
      },
    });

    const { DELETE } = require("../src/app/api/teams/[id]/invitations/[invitationId]/route.js");
    const res = await DELETE(fakeReq({}), {
      params: Promise.resolve({ id: TEAM_ID, invitationId: INVITATION_ID }),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 500, `expected a controlled 500, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(json.error, "response must still be well-formed JSON with an error message");
    assert.ok(
      !/connection reset/i.test(json.error),
      "the raw driver error message must never reach the client"
    );
  });

  await test("the happy path (no error) still works after wrapping the route", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Team", {
      findById: () => ({ lean: async () => ({ _id: TEAM_ID, manager: OID_A }) }),
    });
    let deletedFilter = null;
    mockModule("@/models/Invitation", {
      deleteOne: async (filter) => {
        deletedFilter = filter;
      },
    });

    const { DELETE } = require("../src/app/api/teams/[id]/invitations/[invitationId]/route.js");
    const res = await DELETE(fakeReq({}), {
      params: Promise.resolve({ id: TEAM_ID, invitationId: INVITATION_ID }),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.ok, true);
    assert.deepStrictEqual(deletedFilter, { _id: INVITATION_ID, team: TEAM_ID });
  });

  await test("a non-manager is still rejected with 403 before any DB write is attempted", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_B } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Team", {
      findById: () => ({ lean: async () => ({ _id: TEAM_ID, manager: OID_A, members: [OID_B] }) }),
    });
    let deleteCalled = false;
    mockModule("@/models/Invitation", {
      deleteOne: async () => {
        deleteCalled = true;
      },
    });

    const { DELETE } = require("../src/app/api/teams/[id]/invitations/[invitationId]/route.js");
    const res = await DELETE(fakeReq({}), {
      params: Promise.resolve({ id: TEAM_ID, invitationId: INVITATION_ID }),
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(deleteCalled, false);
  });

  console.log("\nDELETE /api/tasks/[id] — unexpected-error handling");

  function taskAccessMock() {
    return {
      getTaskAccess: async () => ({
        task: { _id: TASK_ID, project: PROJECT_ID },
        project: { _id: PROJECT_ID, manager: OID_A, team: { members: [] } },
      }),
    };
  }

  await test("an unexpected DB error deleting a task returns a clean JSON 500, not an uncaught throw", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", taskAccessMock());
    mockModule("@/models/Column", {});
    mockModule("@/models/Task", {
      findByIdAndDelete: () => ({
        select: () => {
          throw new Error("topology was destroyed");
        },
      }),
    });

    const { DELETE } = require("../src/app/api/tasks/[id]/route.js");
    const res = await DELETE(fakeReq({}), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 500, `expected a controlled 500, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(json.error);
    assert.ok(!/topology/i.test(json.error), "the raw driver error message must never reach the client");
  });

  await test("the happy path still deletes and responds {ok:true} after wrapping the route", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", taskAccessMock());
    mockModule("@/models/Column", {});
    let deletedId = null;
    mockModule("@/models/Task", {
      findByIdAndDelete: (id) => {
        deletedId = id;
        return { select: () => Promise.resolve({ _id: id }) };
      },
    });

    const { DELETE } = require("../src/app/api/tasks/[id]/route.js");
    const res = await DELETE(fakeReq({}), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(deletedId, TASK_ID);
  });

  console.log("\nRoute-level spot checks: malformed body / wrong types not already covered elsewhere");

  await test("POST /api/teams rejects a genuinely malformed (unparseable) JSON body with 400, not 500", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/Team", {});

    const { POST } = require("../src/app/api/teams/route.js");
    const res = await POST(fakeReq(undefined)); // fakeReq(undefined) => req.json() throws
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(json.error);
  });

  await test("POST /api/tasks rejects a non-array assigneeIds (e.g. a single string) with 400", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      getAccessibleProject: async () => ({ _id: PROJECT_ID, manager: OID_A, team: { members: [] } }),
      validateAssignees: (project, assigneeIds) => {
        if (!Array.isArray(assigneeIds)) return { error: "assigneeIds must be an array" };
        return { assignees: assigneeIds };
      },
    });
    mockModule("@/models/Column", { findOne: () => ({ session: () => ({ lean: async () => null }) }) });
    mockModule("@/models/Task", {});

    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(
      fakeReq({ projectId: PROJECT_ID, columnId: OID_B, title: "Task", assigneeIds: OID_A })
    );
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(json.error);
  });

  await test("PATCH /api/projects/[id]/columns/[columnId] rejects a non-integer order (NaN/fraction) with 400", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OID_A } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", { getAccessibleProject: async () => ({ _id: PROJECT_ID }) });
    mockModule("@/models/Column", {
      findOne: () => ({ lean: async () => ({ _id: OID_B, project: PROJECT_ID, name: "To Do" }) }),
    });
    mockModule("@/models/Task", {});

    const { PATCH } = require("../src/app/api/projects/[id]/columns/[columnId]/route.js");
    const res = await PATCH(fakeReq({ order: 1.5 }), {
      params: Promise.resolve({ id: PROJECT_ID, columnId: OID_B }),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(json.error);
  });

  summary();
})();
