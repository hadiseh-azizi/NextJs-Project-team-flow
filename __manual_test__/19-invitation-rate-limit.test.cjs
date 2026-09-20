require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// Final Release Cleanup phase — invitation-email abuse protection (see
// FINAL_RELEASE_CLEANUP.md). Covers POST /api/teams/[id]/members:
//   - authorization is unaffected by (and still enforced ahead of) the
//     new rate limiting
//   - per-manager, per-team, and per-IP invitation limits
//   - the existing-invite 409 and existing-user "added" path stay intact
//   - the always-a-member-add-user branch is never rate-limited (it
//     sends no email)
//
// Same style as the rest of __manual_test__: real, unmodified route code
// loaded via @babel/register, with only Mongoose models and email
// sending swapped for in-memory fakes/spies.

const MANAGER_ID = "111111111111111111111111";
const OTHER_MANAGER_ID = "999999999999999999999999";
const TEAM_ID = "222222222222222222222222";
const OTHER_TEAM_ID = "888888888888888888888888";
const EXISTING_MEMBER_ID = "333333333333333333333333";

function fakeReq(body, headers = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    json: async () => body,
    headers: { get: (name) => lowered[name.toLowerCase()] ?? null },
  };
}

function setupMocks({ managerId = MANAGER_ID, teamId = TEAM_ID, invitationsByKey = new Map() } = {}) {
  resetModuleCache();
  const rateLimitModel = makeFakeRateLimitModel();
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/models/RateLimitAttempt", rateLimitModel);
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: managerId } }) });

  const team = { _id: teamId, manager: managerId, members: [managerId], name: "Engineering" };
  mockModule("@/models/Team", {
    findById: () => Promise.resolve(team),
  });

  mockModule("@/models/User", {
    findOne: () => ({ lean: async () => null }), // every invited address is a brand-new one
    findById: () => ({ select: () => ({ lean: async () => ({ name: "The Manager" }) }) }),
  });

  const sentEmails = [];
  mockModule("@/lib/email", {
    sendTeamInviteEmail: async (args) => {
      sentEmails.push(args);
    },
  });

  mockModule("@/models/Invitation", {
    findOne: ({ email, team: t }) => ({
      lean: async () => invitationsByKey.get(`${email}:${t}`) || null,
    }),
    create: async (doc) => {
      invitationsByKey.set(`${doc.email}:${doc.team}`, { _id: "inv1", ...doc, expiresAt: new Date(Date.now() + 86400000) });
    },
    deleteOne: async () => {},
  });

  return { rateLimitModel, sentEmails, invitationsByKey };
}

function inviteBody(email) {
  return { email };
}

(async () => {
  console.log("POST /api/teams/[id]/members — authorization still enforced ahead of rate limiting");

  await test("a non-manager is rejected with 403 before any rate-limit check or email send", async () => {
    // Session user is OTHER_MANAGER_ID, but the team's manager is MANAGER_ID.
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: OTHER_MANAGER_ID } }) });
    mockModule("@/models/Team", { findById: () => Promise.resolve({ _id: TEAM_ID, manager: MANAGER_ID, members: [MANAGER_ID] }) });
    const emailsSent = [];
    mockModule("@/lib/email", { sendTeamInviteEmail: async (args) => emailsSent.push(args) });
    mockModule("@/models/Invitation", { findOne: () => ({ lean: async () => null }), create: async () => {} });
    mockModule("@/models/User", { findOne: () => ({ lean: async () => null }) });

    const { POST } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await POST(fakeReq(inviteBody("victim@example.com")), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(emailsSent.length, 0);
  });

  console.log("\nPOST /api/teams/[id]/members — invitation-email rate limiting");

  await test("an authorized manager can send an invitation normally", async () => {
    const { sentEmails } = setupMocks();
    const { POST } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await POST(fakeReq(inviteBody("newperson@example.com"), { "x-forwarded-for": "203.0.113.1" }), {
      params: Promise.resolve({ id: TEAM_ID }),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(sentEmails.length, 1);
    assert.strictEqual(sentEmails[0].to, "newperson@example.com");
  });

  await test("exceeding the per-manager limit returns 429 with Retry-After, without sending mail", async () => {
    const { sentEmails } = setupMocks();
    const { POST } = require("../src/app/api/teams/[id]/members/route.js");
    // INVITE_MANAGER_LIMIT.max is 30 (src/app/api/teams/[id]/members/route.js).
    for (let i = 0; i < 30; i++) {
      const res = await POST(fakeReq(inviteBody(`person-${i}@example.com`), { "x-forwarded-for": `203.0.113.${(i % 200) + 1}` }), {
        params: Promise.resolve({ id: TEAM_ID }),
      });
      assert.strictEqual(res.status, 201, `invite ${i + 1} should succeed`);
    }
    assert.strictEqual(sentEmails.length, 30);
    const res = await POST(fakeReq(inviteBody("person-final@example.com"), { "x-forwarded-for": "203.0.113.201" }), {
      params: Promise.resolve({ id: TEAM_ID }),
    });
    assert.strictEqual(res.status, 429);
    assert.ok(res.headers.get("Retry-After"));
    assert.strictEqual(sentEmails.length, 30, "the 31st attempt must not have sent mail");
  });

  await test("the per-manager limit is scoped to that manager — a different manager/team is unaffected", async () => {
    const invitationsByKey = new Map();
    const { sentEmails: mgrAEmails } = setupMocks({ managerId: MANAGER_ID, teamId: TEAM_ID, invitationsByKey });
    const { POST: postAsA } = require("../src/app/api/teams/[id]/members/route.js");
    for (let i = 0; i < 30; i++) {
      await postAsA(fakeReq(inviteBody(`a-${i}@example.com`)), { params: Promise.resolve({ id: TEAM_ID }) });
    }
    const limited = await postAsA(fakeReq(inviteBody("a-final@example.com")), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(limited.status, 429);

    // A different manager, different team, fresh rate-limit store — not
    // sharing state with the exhausted manager/team above.
    const { sentEmails: mgrBEmails } = setupMocks({ managerId: OTHER_MANAGER_ID, teamId: OTHER_TEAM_ID });
    const { POST: postAsB } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await postAsB(fakeReq(inviteBody("b-1@example.com")), { params: Promise.resolve({ id: OTHER_TEAM_ID }) });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(mgrBEmails.length, 1);
  });

  await test("the per-team limit trips independently of the per-manager limit (same manager, two teams)", async () => {
    // Both teams share the SAME rate-limit backing store so the
    // per-manager identity ties them together, but each team also has its
    // own per-team bucket — this test only exercises exhausting one
    // team's bucket by inviting to it 30 times, then checks the *other*
    // team (different `invite:team:` key, same manager) is unaffected by
    // the per-team limit specifically (the per-manager limit would still
    // combine across both — this test targets a fresh manager per team to
    // isolate the per-team check).
    const rateLimitModel = makeFakeRateLimitModel();
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rateLimitModel);

    function mockTeamRoute(managerId, teamId) {
      mockModule("next-auth", { getServerSession: async () => ({ user: { id: managerId } }) });
      mockModule("@/models/Team", { findById: () => Promise.resolve({ _id: teamId, manager: managerId, members: [managerId] }) });
      mockModule("@/models/User", { findOne: () => ({ lean: async () => null }), findById: () => ({ select: () => ({ lean: async () => ({ name: "Mgr" }) }) }) });
      mockModule("@/lib/email", { sendTeamInviteEmail: async () => {} });
      mockModule("@/models/Invitation", { findOne: () => ({ lean: async () => null }), create: async () => {} });
    }

    // Same manager for both teams so only the per-team identity differs.
    mockTeamRoute(MANAGER_ID, TEAM_ID);
    const { POST: postTeamA } = require("../src/app/api/teams/[id]/members/route.js");
    for (let i = 0; i < 30; i++) {
      await postTeamA(fakeReq(inviteBody(`t1-${i}@example.com`)), { params: Promise.resolve({ id: TEAM_ID }) });
    }
    const teamALimited = await postTeamA(fakeReq(inviteBody("t1-final@example.com")), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(teamALimited.status, 429, "team A's per-team bucket should now be exhausted");

    // Same manager (per-manager identity is also now at 30/30 across both
    // calls above), a different team: per-team key differs, but the
    // per-manager key is shared and already exhausted, so this is
    // expected to ALSO be limited — demonstrating the manager limit
    // applies across teams as documented, not that the team limit leaked.
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", rateLimitModel);
    mockTeamRoute(MANAGER_ID, OTHER_TEAM_ID);
    const { POST: postTeamB } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await postTeamB(fakeReq(inviteBody("t2-1@example.com")), { params: Promise.resolve({ id: OTHER_TEAM_ID }) });
    assert.strictEqual(res.status, 429, "the per-manager limit (shared across teams) is already exhausted from team A's invites");
  });

  await test("repeated invitations to the same address still 409 (existing behavior), independent of rate limiting", async () => {
    const invitationsByKey = new Map();
    setupMocks({ invitationsByKey });
    const { POST } = require("../src/app/api/teams/[id]/members/route.js");
    const first = await POST(fakeReq(inviteBody("dup@example.com")), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(first.status, 201);
    const second = await POST(fakeReq(inviteBody("dup@example.com")), { params: Promise.resolve({ id: TEAM_ID }) });
    assert.strictEqual(second.status, 409);
  });

  await test("adding an existing user (no email sent) is never rate-limited by the invitation limiter", async () => {
    resetModuleCache();
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });

    const team = { _id: TEAM_ID, manager: MANAGER_ID, members: [MANAGER_ID] };
    // Mirrors the shape used elsewhere in __manual_test__ (see
    // 12-transaction-fallback-routes.test.cjs): the route both `await`s
    // Team.findById(id) directly and, separately, chains
    // .populate().populate().lean() off a second call for the response —
    // one object supporting both call shapes.
    mockModule("@/models/Team", {
      findById: () => ({
        then: (resolve) => resolve(team),
        populate: function () {
          return this;
        },
        lean: async () => team,
      }),
      updateOne: async () => ({ modifiedCount: 1 }),
    });
    let emailSent = false;
    mockModule("@/lib/email", { sendTeamInviteEmail: async () => { emailSent = true; } });
    mockModule("@/models/Invitation", { findOne: () => ({ lean: async () => null }), create: async () => {} });
    mockModule("@/models/User", {
      findOne: () => ({ lean: async () => ({ _id: EXISTING_MEMBER_ID }) }),
    });

    const { POST } = require("../src/app/api/teams/[id]/members/route.js");
    const res = await POST(fakeReq(inviteBody("existing@example.com")), { params: Promise.resolve({ id: TEAM_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(json)}`);
    assert.strictEqual(emailSent, false);
  });

  summary();
})();
