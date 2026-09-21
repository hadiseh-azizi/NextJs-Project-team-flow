require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Regression for: GET /api/teams threw
//   TypeError: pendingInvitations.map is not a function
// for any user in two or more teams. The route called
// `teams.map(toTeamDTO)`, so Array.map's index argument was received as
// toTeamDTO's `pendingInvitations` parameter (0 is falsy, 1+ is not).

const USER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

function makeTeam(n) {
  const id = String(n).repeat(24).slice(0, 24);
  return {
    _id: id,
    name: `Team ${n}`,
    manager: { _id: USER_ID, name: "Manager", email: "manager@example.com" },
    members: [{ _id: USER_ID, name: "Manager", email: "manager@example.com" }],
  };
}

function mockTeams(teams) {
  resetModuleCache();
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  const query = {
    populate: () => query,
    sort: () => query,
    lean: async () => teams,
  };
  mockModule("@/models/Team", { find: () => query });
}

(async () => {
  console.log("GET /api/teams — list serialization");

  await test("a user with several teams gets all of them back with status 200", async () => {
    mockTeams([makeTeam(1), makeTeam(2), makeTeam(3), makeTeam(4)]);
    const { GET } = require("../src/app/api/teams/route.js");
    const res = await GET();
    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.length, 4);
    assert.deepStrictEqual(
      json.map((t) => t.name),
      ["Team 1", "Team 2", "Team 3", "Team 4"]
    );
  });

  await test("list items never include pendingInvitations (only the single-team route does)", async () => {
    mockTeams([makeTeam(1), makeTeam(2), makeTeam(3)]);
    const { GET } = require("../src/app/api/teams/route.js");
    const json = await (await GET()).json();
    for (const team of json) {
      assert.ok(!("pendingInvitations" in team), `${team.name} must not carry pendingInvitations`);
    }
  });

  await test("an empty list returns 200 and []", async () => {
    mockTeams([]);
    const { GET } = require("../src/app/api/teams/route.js");
    const res = await GET();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), []);
  });

  console.log("\ntoTeamDTO — pendingInvitations handling");

  await test("a non-array second argument is ignored instead of throwing", () => {
    resetModuleCache();
    const { toTeamDTO } = require("../src/lib/serialize.js");
    const dto = toTeamDTO(makeTeam(1), 1);
    assert.ok(!("pendingInvitations" in dto));
  });

  await test("an array of invitations is still serialized (single-team route behavior)", () => {
    resetModuleCache();
    const { toTeamDTO } = require("../src/lib/serialize.js");
    const dto = toTeamDTO(makeTeam(1), [
      { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", email: "new@example.com", createdAt: "2024-01-01T00:00:00.000Z" },
    ]);
    assert.strictEqual(dto.pendingInvitations.length, 1);
    assert.strictEqual(dto.pendingInvitations[0].email, "new@example.com");
  });

  summary();
})();
