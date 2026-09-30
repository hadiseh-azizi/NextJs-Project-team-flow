// Pure-function checks for lib/entityColor.js —
// no Mongoose/Next.js involved, so these load directly, same pattern as
// 01-pure-ordering.test.cjs.
require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

const { projectColorForId, teamColorForId } = require("../src/lib/entityColor.js");

async function run() {
  await test("projectColorForId is deterministic across repeated calls", () => {
    const a1 = projectColorForId("project-123", "light");
    const a2 = projectColorForId("project-123", "light");
    assert.deepStrictEqual(a1, a2);
  });

  await test("projectColorForId returns both a strong and a muted tone", () => {
    const c = projectColorForId("project-abc", "light");
    assert.ok(typeof c.strong === "string" && /^#/.test(c.strong));
    assert.ok(typeof c.muted === "string" && /^#/.test(c.muted));
    assert.notStrictEqual(c.strong, c.muted);
  });

  await test("projectColorForId differs by color scheme", () => {
    const light = projectColorForId("project-xyz", "light");
    const dark = projectColorForId("project-xyz", "dark");
    assert.notStrictEqual(light.strong, dark.strong);
  });

  await test("projectColorForId spreads distinct ids across the palette", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `proj-${i}`);
    const colors = new Set(ids.map((id) => projectColorForId(id, "light").strong));
    // 20 ids over an 8-color palette can't all be unique, but they should
    // not all collapse onto one or two colors either.
    assert.ok(colors.size >= 4, `expected some spread, got ${colors.size} distinct colors`);
  });

  await test("teamColorForId is deterministic and distinct from the project palette", () => {
    const t1 = teamColorForId("team-1", "light");
    const t2 = teamColorForId("team-1", "light");
    assert.strictEqual(t1, t2);

    const projectHues = new Set(Array.from({ length: 8 }, (_, i) => projectColorForId(`p${i}`, "light").strong));
    const teamHues = new Set(Array.from({ length: 8 }, (_, i) => teamColorForId(`t${i}`, "light").strong));
    let overlap = 0;
    for (const hue of teamHues) if (projectHues.has(hue)) overlap++;
    assert.strictEqual(overlap, 0, "team palette should not reuse project palette colors");
  });

  await test("a project id and a team id with the same string still get their own palette's color", () => {
    // Same raw id, two different "namespaces" (project vs team) — this
    // only makes sense if the two functions never leak into each other's
    // palette, which the previous test already covers structurally; this
    // just checks the call sites don't accidentally cross-call.
    const asProject = projectColorForId("shared-id", "light").strong;
    const asTeam = teamColorForId("shared-id", "light");
    assert.notStrictEqual(asProject, asTeam);
  });

  summary();
}

run();
