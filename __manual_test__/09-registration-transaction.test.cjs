require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Exercises src/app/api/auth/register/route.js: the User-create +
// Invitation-consumption transaction, duplicate-email handling, and the
// "email sending is best-effort, doesn't fail an already-committed
// registration" behavior. Same style of in-memory transaction simulation
// as 04/05 — buffers session-scoped writes, only applies them if the
// transaction callback resolves.

function makeFakeWorld({ existingUsers = [], invitations = [] }) {
  const users = new Map(existingUsers.map((u) => [u.email, { ...u }]));
  const teams = new Map(); // teamId -> { members: Set }
  let liveInvitations = invitations.map((i) => ({ ...i }));
  let userCounter = 0;

  const mongooseMock = {
    startSession: async () => {
      const session = { userBuffer: null, teamPatches: [], deletedInvitationEmails: null };
      session.withTransaction = async (fn) => {
        await fn(); // throwing here means nothing below is committed
        if (session.userBuffer) users.set(session.userBuffer.email, session.userBuffer);
        for (const { teamId, memberId } of session.teamPatches) {
          const team = teams.get(teamId) || { members: new Set() };
          team.members.add(memberId);
          teams.set(teamId, team);
        }
        if (session.deletedInvitationEmails) {
          liveInvitations = liveInvitations.filter((i) => i.email !== session.deletedInvitationEmails);
        }
      };
      session.endSession = async () => {};
      return session;
    },
  };

  const UserModel = {
    findOne: ({ email }) => ({ lean: async () => (users.has(email) ? { ...users.get(email) } : null) }),
    create: async (docsArray, opts = {}) => {
      const [doc] = docsArray;
      if (users.has(doc.email)) {
        // Mirrors the real unique index: a duplicate-key race surfaces as
        // a thrown error with code 11000, aborting the transaction.
        throw Object.assign(new Error("duplicate key"), { code: 11000 });
      }
      const created = { _id: `user_${++userCounter}`, tokenVersion: 0, ...doc };
      if (opts.session) opts.session.userBuffer = created;
      else users.set(created.email, created);
      return [created];
    },
  };

  const InvitationModel = {
    find: ({ email, expiresAt }) => ({
      session: () => ({
        lean: async () =>
          liveInvitations.filter((i) => i.email === email && (!expiresAt || i.expiresAt > expiresAt.$gt)),
      }),
    }),
    deleteMany: async ({ email }, opts = {}) => {
      if (opts.session) opts.session.deletedInvitationEmails = email;
      else liveInvitations = liveInvitations.filter((i) => i.email !== email);
    },
  };

  const TeamModel = {
    updateMany: async ({ _id: { $in: teamIds } }, { $addToSet: { members: memberId } }, opts = {}) => {
      for (const teamId of teamIds) {
        if (opts.session) opts.session.teamPatches.push({ teamId, memberId });
        else {
          const team = teams.get(teamId) || { members: new Set() };
          team.members.add(memberId);
          teams.set(teamId, team);
        }
      }
    },
  };

  return { mongooseMock, UserModel, InvitationModel, TeamModel, users, teams, getLiveInvitations: () => liveInvitations };
}

function fakeReq(body) {
  return { json: async () => body };
}

let sentEmails;

function setupMocks({ existingUsers = [], invitations = [], sendEmailShouldFail = false } = {}) {
  resetModuleCache();
  sentEmails = [];
  const world = makeFakeWorld({ existingUsers, invitations });
  const realMongoose = require("mongoose");
  mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/models/User", world.UserModel);
  mockModule("@/models/Team", world.TeamModel);
  mockModule("@/models/Invitation", world.InvitationModel);
  mockModule("@/lib/verificationToken", { createVerificationToken: () => "fake.jwt.token" });
  mockModule("@/lib/email", {
    sendVerificationEmail: async (args) => {
      if (sendEmailShouldFail) throw new Error("simulated SMTP outage");
      sentEmails.push(args);
      return { sent: true };
    },
  });
  return world;
}

const VALID_BODY = { name: "Ada Lovelace", email: "ada@example.com", password: "correct-horse" };

(async () => {
  console.log("Registration transaction / invitation-consumption behavior");

  await test("registers a new account with no pending invitations", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    const json = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(json.requiresVerification, true);
    assert.ok(world.users.has("ada@example.com"));
    assert.strictEqual(world.users.get("ada@example.com").emailVerified, false);
    assert.strictEqual(sentEmails.length, 1);
  });

  await test("duplicate registration is rejected with 409 and no second account is created", async () => {
    const world = setupMocks({ existingUsers: [{ email: "ada@example.com", name: "Ada", passwordHash: "x" }] });
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    assert.strictEqual(res.status, 409);
    assert.strictEqual(sentEmails.length, 0);
  });

  await test("malformed input (missing fields, bad email, short password) is rejected before touching the database", async () => {
    setupMocks();
    const { POST } = require("../src/app/api/auth/register/route.js");
    const cases = [
      { name: "", email: "ada@example.com", password: "correct-horse" },
      { name: "Ada", email: "not-an-email", password: "correct-horse" },
      { name: "Ada", email: "ada@example.com", password: "short" },
      { name: "Ada", email: "ada@example.com" }, // password missing entirely
    ];
    for (const body of cases) {
      const res = await POST(fakeReq(body));
      assert.strictEqual(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
    assert.strictEqual(sentEmails.length, 0);
  });

  await test("a matching non-expired invitation grants team membership at registration", async () => {
    const world = setupMocks({
      invitations: [{ email: "ada@example.com", team: "team1", expiresAt: new Date(Date.now() + 86400000) }],
    });
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    assert.strictEqual(res.status, 201);
    assert.ok(world.teams.get("team1")?.members.has(world.users.get("ada@example.com")._id));
    assert.strictEqual(world.getLiveInvitations().length, 0); // consumed
  });

  await test("multiple invitations across different teams are all honored in one registration", async () => {
    const world = setupMocks({
      invitations: [
        { email: "ada@example.com", team: "team1", expiresAt: new Date(Date.now() + 86400000) },
        { email: "ada@example.com", team: "team2", expiresAt: new Date(Date.now() + 86400000) },
      ],
    });
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    assert.strictEqual(res.status, 201);
    const userId = world.users.get("ada@example.com")._id;
    assert.ok(world.teams.get("team1")?.members.has(userId));
    assert.ok(world.teams.get("team2")?.members.has(userId));
  });

  await test("an expired invitation does not grant membership, but is still cleared out", async () => {
    const world = setupMocks({
      invitations: [{ email: "ada@example.com", team: "team1", expiresAt: new Date(Date.now() - 1000) }],
    });
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    assert.strictEqual(res.status, 201);
    assert.strictEqual(world.teams.get("team1"), undefined); // never granted
  });

  await test("a failure mid-transaction leaves no user account behind (rollback)", async () => {
    const world = setupMocks({
      invitations: [{ email: "ada@example.com", team: "team1", expiresAt: new Date(Date.now() + 86400000) }],
    });
    world.TeamModel.updateMany = async () => {
      throw new Error("simulated write failure");
    };
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    assert.strictEqual(res.status, 500);
    assert.strictEqual(world.users.has("ada@example.com"), false); // rolled back, not half-created
    assert.strictEqual(sentEmails.length, 0); // verification email never sent for a rolled-back account
  });

  await test("an SMTP failure sending the verification email does not fail an already-committed registration", async () => {
    const world = setupMocks({ sendEmailShouldFail: true });
    const { POST } = require("../src/app/api/auth/register/route.js");
    const res = await POST(fakeReq(VALID_BODY));
    const json = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(json.requiresVerification, true);
    assert.ok(world.users.has("ada@example.com")); // account still exists despite the email failing
  });

  summary();
})();
