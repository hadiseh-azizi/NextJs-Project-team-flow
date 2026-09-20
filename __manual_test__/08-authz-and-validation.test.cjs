require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

// authz.js and validation.js are almost entirely pure functions (no DB,
// no session) — the boundary logic they encode (who can see/edit what,
// what shapes of input are accepted) is exactly the kind of thing that's
// cheap to pin down with direct unit tests, no route mocking required.
const {
  projectAccessFor,
  teamAccessFor,
  isTeamManager,
  validateAssignees,
} = require("../src/lib/authz.js");

const {
  validateRequiredString,
  validateOptionalString,
  validateEmailInput,
  validateObjectIdField,
  validateObjectIdArray,
  validateOptionalDate,
  validateInteger,
  validateBooleanField,
  validateEnumValue,
  validateOptionalEnumValue,
} = require("../src/lib/validation.js");

const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const OID_C = "cccccccccccccccccccccccc";

(async () => {
  console.log("authz.js — project/team access boundaries");

  await test("project manager has access even if not in team.members", async () => {
    const project = { manager: OID_A, team: { members: [] } };
    const access = projectAccessFor(project, OID_A);
    assert.strictEqual(access.allowed, true);
    assert.strictEqual(access.isManager, true);
  });

  await test("a team member (not the manager) has access", async () => {
    const project = { manager: OID_A, team: { members: [{ _id: OID_B }] } };
    const access = projectAccessFor(project, OID_B);
    assert.strictEqual(access.allowed, true);
    assert.strictEqual(access.isManager, false);
    assert.strictEqual(access.isTeamMember, true);
  });

  await test("an outsider (neither manager nor member) is denied — this is the cross-team-access boundary", async () => {
    const project = { manager: OID_A, team: { members: [{ _id: OID_B }] } };
    const access = projectAccessFor(project, OID_C);
    assert.strictEqual(access.allowed, false);
  });

  await test("teamAccessFor treats the manager as implicitly a member", async () => {
    const team = { manager: OID_A, members: [] };
    const access = teamAccessFor(team, OID_A);
    assert.strictEqual(access.isManager, true);
    assert.strictEqual(access.allowed, true);
  });

  await test("isTeamManager works with both a populated and a bare ObjectId manager field", async () => {
    assert.strictEqual(isTeamManager({ manager: { _id: OID_A } }, OID_A), true);
    assert.strictEqual(isTeamManager({ manager: OID_A }, OID_A), true);
    assert.strictEqual(isTeamManager({ manager: OID_A }, OID_B), false);
  });

  console.log("\nauthz.js — validateAssignees (manager-only / cross-team assignment boundary)");

  await test("rejects a non-array assigneeIds instead of coercing it", async () => {
    const project = { manager: OID_A, team: { members: [] } };
    const result = validateAssignees(project, "not-an-array");
    assert.ok(result.error);
  });

  await test("rejects a malformed id before it ever reaches Mongoose", async () => {
    const project = { manager: OID_A, team: { members: [] } };
    const result = validateAssignees(project, ["not-an-object-id"]);
    assert.ok(result.error);
  });

  await test("rejects an id that isn't the manager or a team member — the cross-team-assignee boundary", async () => {
    const project = { manager: OID_A, team: { members: [{ _id: OID_B }] } };
    const result = validateAssignees(project, [OID_C]);
    assert.ok(result.error);
  });

  await test("accepts the manager and every team member, deduplicated", async () => {
    const project = { manager: OID_A, team: { members: [{ _id: OID_B }] } };
    const result = validateAssignees(project, [OID_A, OID_B, OID_B]);
    assert.deepStrictEqual(result.assignees.sort(), [OID_A, OID_B].sort());
  });

  console.log("\nvalidation.js — shared request-body validators");

  await test("validateRequiredString rejects empty/whitespace-only input", async () => {
    assert.ok(validateRequiredString("   ", { field: "Title" }).error);
    assert.ok(validateRequiredString("", { field: "Title" }).error);
    assert.ok(validateRequiredString(42, { field: "Title" }).error);
  });

  await test("validateRequiredString trims and enforces maxLength", async () => {
    assert.strictEqual(validateRequiredString("  hi  ", { field: "Title" }).value, "hi");
    assert.ok(validateRequiredString("x".repeat(10), { field: "Title", maxLength: 5 }).error);
  });

  await test("validateOptionalString distinguishes 'not provided' from 'explicitly cleared'", async () => {
    assert.strictEqual(validateOptionalString(undefined, { field: "Description" }).value, undefined);
    assert.strictEqual(validateOptionalString(null, { field: "Description" }).value, null);
    assert.strictEqual(validateOptionalString("", { field: "Description" }).value, null);
    assert.strictEqual(validateOptionalString("  notes  ", { field: "Description" }).value, "notes");
  });

  await test("validateEmailInput normalizes case/whitespace and rejects malformed addresses", async () => {
    assert.strictEqual(validateEmailInput(" Foo@Bar.com ").value, "foo@bar.com");
    assert.ok(validateEmailInput("not-an-email").error);
    assert.ok(validateEmailInput("").error);
  });

  await test("validateObjectIdField / validateObjectIdArray reject malformed ids", async () => {
    assert.ok(validateObjectIdField("nope").error);
    assert.strictEqual(validateObjectIdField(OID_A).value, OID_A);
    assert.ok(validateObjectIdArray("not-an-array").error);
    assert.ok(validateObjectIdArray([OID_A, "nope"]).error);
    const deduped = validateObjectIdArray([OID_A, OID_A, OID_B]).value;
    assert.deepStrictEqual(deduped, [OID_A, OID_B]);
  });

  await test("validateOptionalDate rejects unparseable input but allows clearing", async () => {
    assert.strictEqual(validateOptionalDate(undefined).value, undefined);
    assert.strictEqual(validateOptionalDate(null).value, null);
    assert.strictEqual(validateOptionalDate("").value, null);
    assert.ok(validateOptionalDate("not-a-date").error);
    assert.ok(validateOptionalDate("2025-01-01").value instanceof Date);
  });

  await test("validateInteger rejects non-integers, NaN, Infinity, and out-of-range values", async () => {
    assert.ok(validateInteger(1.5).error);
    assert.ok(validateInteger(NaN).error);
    assert.ok(validateInteger(Infinity).error);
    assert.ok(validateInteger("3").error);
    assert.ok(validateInteger(5, { min: 0, max: 3 }).error);
    assert.strictEqual(validateInteger(3, { min: 0, max: 3 }).value, 3);
  });

  await test("validateBooleanField and enum validators reject smuggled arbitrary values", async () => {
    assert.ok(validateBooleanField("true").error); // string, not boolean
    assert.strictEqual(validateBooleanField(true).value, true);
    assert.ok(validateEnumValue("purple", { allowed: ["rose", "sky"] }).error);
    assert.strictEqual(validateEnumValue("rose", { allowed: ["rose", "sky"] }).value, "rose");
    assert.strictEqual(validateOptionalEnumValue(undefined, { allowed: ["rose"] }).value, undefined);
    assert.strictEqual(validateOptionalEnumValue(null, { allowed: ["rose"] }).value, null);
  });

  summary();
})();
