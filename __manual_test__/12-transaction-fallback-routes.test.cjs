require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// This audit found four routes creating a real MongoDB transaction with a
// raw mongoose.startSession()/session.withTransaction() pair instead of
// the shared withOptionalTransaction() helper (lib/mongoTransaction.js):
//
//   - POST   /api/projects                     (project + default columns —
//                                                 see note below: this route
//                                                 no longer uses a
//                                                 transaction at all)
//   - DELETE /api/projects/[id]                 (cascading project delete)
//   - DELETE /api/teams/[id]/members            (member removal + unassign)
//   - POST   /api/auth/register                 (already covered by its own
//                                                 fallback case below, since
//                                                 09-registration-transaction
//                                                 only exercises the
//                                                 succeeding-transaction path)
//
// README.md promises all of these fall back to an unsessioned sequence of
// writes on a standalone (non-replica-set) MongoDB instead of failing. The
// raw session.withTransaction() form does NOT do this — it throws
// immediately, which would have 500'd every one of these requests against
// a standalone `mongod`. Each test below simulates exactly that server
// response and asserts the route still completes successfully via the
// fallback path, with the correct writes applied without any session.
//
// Project creation no longer creates any columns (see the "Boards,
// Completed columns & task completion" changelog entry) — a project starts
// with no board at all, and the user adds one explicitly. POST
// /api/projects is now a single Project.create() with no transaction to
// fall back from, so its test below no longer needs the no-transaction-
// support mongoose fake; it's kept in this file because it's the same
// route the rest of this audit is about.

const TRANSACTIONS_UNSUPPORTED_ERROR = new Error(
  "Transaction numbers are only allowed on a replica set member or mongos"
);

function fakeMongooseNoTransactionSupport() {
  const realMongoose = require("mongoose");
  return {
    ...realMongoose,
    startSession: async () => ({
      withTransaction: async () => {
        throw TRANSACTIONS_UNSUPPORTED_ERROR;
      },
      endSession: async () => {},
    }),
  };
}

function fakeReq(body) {
  return { json: async () => body, url: "http://localhost/api/x" };
}

(async () => {
  console.log("Transaction fallback behavior for standalone MongoDB (the audit's headline finding)");

  // ---- POST /api/projects -------------------------------------------
  await test("project creation succeeds and creates no board/columns", async () => {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "111111111111111111111111" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      isTeamManager: () => true,
      accessibleTeamIds: async () => [],
    });

    let createdProject = null;
    mockModule("@/models/Team", { findById: () => ({ lean: async () => ({ _id: "222222222222222222222222", manager: "111111111111111111111111" }) }) });
    mockModule("@/models/Project", {
      create: async (doc) => {
        createdProject = { _id: "333333333333333333333333", ...doc };
        return createdProject;
      },
      findById: () => ({
        populate: function () { return this; },
        lean: async () => ({ ...createdProject, createdAt: new Date(), manager: { _id: "111111111111111111111111" }, team: { _id: "222222222222222222222222", members: [] } }),
      }),
    });
    let columnInsertCalled = false;
    mockModule("@/models/Column", {
      insertMany: async () => {
        columnInsertCalled = true;
        return [];
      },
      create: async () => {
        columnInsertCalled = true;
        return {};
      },
      find: () => ({ lean: async () => [] }),
    });

    const { POST } = require("../src/app/api/projects/route.js");
    const res = await POST(fakeReq({ name: "New Project", teamId: "222222222222222222222222" }));
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(createdProject, "project should have been created");
    assert.strictEqual(columnInsertCalled, false, "project creation must not create any columns — a project starts with no board");
    assert.deepStrictEqual(json.columns, [], "a freshly created project has no columns/board yet");
  });

  // ---- DELETE /api/projects/[id] -------------------------------------
  await test("project deletion cascades tasks and columns without a session when transactions aren't supported", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseNoTransactionSupport());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "111111111111111111111111" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });

    let deletedProjectId = null;
    let deletedTasksFilter = null;
    let deletedColumnsFilter = null;
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ _id: "333333333333333333333333", manager: "111111111111111111111111" }) }),
      findByIdAndDelete: async (id, opts) => {
        assert.strictEqual(opts.session, undefined);
        deletedProjectId = id;
      },
    });
    mockModule("@/models/Task", {
      deleteMany: async (filter, opts) => {
        assert.strictEqual(opts.session, undefined);
        deletedTasksFilter = filter;
      },
    });
    mockModule("@/models/Column", {
      deleteMany: async (filter, opts) => {
        assert.strictEqual(opts.session, undefined);
        deletedColumnsFilter = filter;
      },
    });

    const { DELETE } = require("../src/app/api/projects/[id]/route.js");
    const res = await DELETE(fakeReq(), { params: Promise.resolve({ id: "333333333333333333333333" }) });
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(deletedProjectId, "333333333333333333333333");
    assert.deepStrictEqual(deletedTasksFilter, { project: "333333333333333333333333" });
    assert.deepStrictEqual(deletedColumnsFilter, { project: "333333333333333333333333" });
  });

  // ---- DELETE /api/teams/[id]/members ---------------------------------
  await test("member removal unassigns their tasks without a session when transactions aren't supported", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseNoTransactionSupport());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: "111111111111111111111111" } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", { isTeamManager: () => true });

    let pulledMember = null;
    let unassignedFilter = null;
    const team = { _id: "222222222222222222222222", manager: "111111111111111111111111", members: ["111111111111111111111111", "444444444444444444444444"] };
    mockModule("@/models/Team", {
      // DELETE first loads the team as a plain (non-lean) doc to check
      // manager/membership, then later re-fetches it populated for the
      // response — both calls go through findById here.
      findById: () => ({
        then: (resolve) => resolve(team), // await team = team (thenable)
        populate: function () { return this; },
        lean: async () => team,
      }),
      updateOne: async (filter, update, opts) => {
        assert.strictEqual(opts.session, undefined);
        pulledMember = update.$pull.members;
      },
    });
    mockModule("@/models/User", {});
    mockModule("@/models/Invitation", {});
    let editorsPull = null;
    mockModule("@/models/Project", {
      find: () => ({
        session: () => ({ lean: async () => [{ _id: "333333333333333333333333" }] }),
      }),
      // Removed members also lose any individually granted edit access.
      updateMany: async (filter, update, opts) => {
        assert.strictEqual(opts.session, undefined);
        editorsPull = update.$pull.editors;
      },
    });
    mockModule("@/models/Task", {
      updateMany: async (filter, update, opts) => {
        assert.strictEqual(opts.session, undefined);
        unassignedFilter = filter;
      },
    });

    const { DELETE } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await DELETE(
      { url: "http://localhost/api/teams/222222222222222222222222/members?userId=444444444444444444444444" },
      { params: Promise.resolve({ id: "222222222222222222222222" }) }
    );
    const json = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(pulledMember, "444444444444444444444444");
    assert.deepStrictEqual(unassignedFilter, { project: { $in: ["333333333333333333333333"] } });
    assert.strictEqual(editorsPull, "444444444444444444444444");
  });

  // ---- POST /api/auth/register (fallback path specifically) ----------
  await test("registration + invitation consumption succeeds without a session when transactions aren't supported", async () => {
    resetModuleCache();
    mockModule("mongoose", fakeMongooseNoTransactionSupport());
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/verificationToken", { createVerificationToken: () => "fake.jwt.token" });
    mockModule("@/lib/email", { sendVerificationEmail: async () => {} });

    let createdUser = null;
    let teamPatched = null;
    let invitationsDeletedFor = null;
    mockModule("@/models/User", {
      findOne: () => ({ lean: async () => null }),
      create: async (docsArray, opts) => {
        assert.strictEqual(opts.session, undefined);
        createdUser = { _id: "555555555555555555555555", tokenVersion: 0, ...docsArray[0] };
        return [createdUser];
      },
    });
    mockModule("@/models/Invitation", {
      find: () => ({ session: () => ({ lean: async () => [{ email: "ada@example.com", team: "222222222222222222222222", expiresAt: new Date(Date.now() + 86400000) }] }) }),
      deleteMany: async (filter, opts) => {
        assert.strictEqual(opts.session, undefined);
        invitationsDeletedFor = filter.email;
      },
    });
    mockModule("@/models/Team", {
      updateMany: async (filter, update, opts) => {
        assert.strictEqual(opts.session, undefined);
        teamPatched = { filter, update };
      },
    });

    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq({ name: "Ada Lovelace", email: "ada@example.com", password: "correct-horse" }));
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.ok(createdUser, "user should have been created via the fallback path");
    assert.ok(teamPatched, "invitation should still grant team membership via the fallback path");
    assert.strictEqual(invitationsDeletedFor, "ada@example.com");
  });

  summary();
})();
