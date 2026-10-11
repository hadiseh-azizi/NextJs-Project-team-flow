// Team-name initial + project tab gradients (UI only).
// Pure checks on lib/entityColor.js and lib/brand.js, and source checks on
// components/TeamName.jsx and the cards: the circular team-initial elements
// are gone from TeamCard and the project tab.
// (lib/splitName.js - a first-letter/rest splitter - no longer exists:
// TeamName renders the name as a single span, so its tests were removed
// along with the module rather than restoring it.)
require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

const { projectTabForId } = require("../src/lib/entityColor.js");
const { contrastRatio, readableInk, BRAND } = require("../src/lib/brand.js");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const ids = Array.from({ length: 400 }, (_, i) => `project-${i}`);

async function run() {
  await test("projectTabForId is deterministic", () => {
    assert.deepStrictEqual(projectTabForId("p-1", "light"), projectTabForId("p-1", "light"));
  });

  await test("all 8 palette slots give 8 different gradient combinations", () => {
    for (const mode of ["light", "dark"]) {
      const combos = new Set(ids.map((id) => projectTabForId(id, mode).rest.join(">")));
      assert.strictEqual(combos.size, 8, `${mode}: expected 8 combos, got ${combos.size}`);
    }
  });

  await test("each gradient has two different colors (a real gradient, not a flat fill)", () => {
    for (const id of ids.slice(0, 40)) {
      const t = projectTabForId(id, "light");
      assert.notStrictEqual(t.rest[0], t.rest[1]);
      assert.notStrictEqual(t.hover[0], t.hover[1]);
    }
  });

  await test("text stays AA-readable (>= 4.5:1) on both ends of every tab, resting and hover, light and dark", () => {
    for (const mode of ["light", "dark"]) {
      for (const id of ids) {
        const t = projectTabForId(id, mode);
        for (const bg of [...t.rest, ...t.hover]) {
          const c = contrastRatio(t.ink, bg);
          assert.ok(c >= 4.5, `${mode} ${id}: ${t.ink} on ${bg} is ${c.toFixed(2)}`);
        }
      }
    }
  });

  await test("ink follows the background: dark text on light tabs, light text on dark tabs", () => {
    assert.strictEqual(projectTabForId("p-1", "light").ink, BRAND.light.text);
    assert.strictEqual(projectTabForId("p-1", "dark").ink, BRAND.dark.text);
    assert.strictEqual(readableInk(["#FFFFFF", "#F0F0F0"]), BRAND.light.text);
    assert.strictEqual(readableInk(["#0A1019", "#111A28"]), BRAND.dark.text);
  });

  await test("hover is a visible step stronger than rest", () => {
    const t = projectTabForId("p-3", "light");
    assert.notStrictEqual(t.rest[0], t.hover[0]);
    assert.notStrictEqual(t.rest[1], t.hover[1]);
  });

  await test("TeamName: one inline span carrying the name, sized via `scale`, gradient text only when an accent is given", () => {
    const src = read("src/components/TeamName.jsx");
    assert.match(src, /component="span"/);
    assert.match(src, /fontSize: `\$\{scale\}em`/);
    assert.match(src, /\{name\}/);
    assert.ok(!/splitFirstChar|splitName/.test(src), "TeamName must not depend on the removed splitName module");
    assert.match(src, /backgroundClip: "text"/);
    assert.ok(!/#[0-9A-Fa-f]{6}/.test(src), "no hex literals in TeamName; colors come from lib/brand");
  });

  await test("TeamCard: the circular initial badge is gone; the name carries the larger initial", () => {
    const src = read("src/components/TeamCard.jsx");
    assert.ok(!src.includes("avatarInitial(team.name)"), "team-name initial badge still rendered");
    assert.ok(!src.includes("clamp(32px, 15cqw, 44px)"), "badge sizing still present");
    assert.match(src, /<TeamName name=\{team\.name\}/);
    assert.match(src, /borderRadius: "50%"/, "the team card itself stays circular (locked decision)");
  });

  await test("ProjectCard: no team-initial element; tab is a gradient fill at top-left showing the team name as plain text", () => {
    const src = read("src/components/ProjectCard.jsx");
    assert.ok(!src.includes("avatarInitial(project.team"), "team initial badge present");
    assert.match(src, /\{project\.team\.name\}/);
    assert.match(src, /projectTabForId\(project\.id/);
    assert.match(src, /backgroundImage: tabGradient\(tab\.rest\)/);
    assert.ok(!src.includes("inset 0 2px 0"), "old top-line-only tab accent still present");
    assert.ok(!src.includes("teamColorForId"), "tab no longer keyed by team color");
    assert.match(src, /top: 0,\s*\n\s*left: 0,/);
  });

  await test("no other component renders a team name's initial in a circle", () => {
    const dir = path.join(__dirname, "..", "src");
    const hits = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.jsx?$/.test(f.name) && /avatarInitial\([^)]*team(\?)?\.name/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    })(dir);
    assert.deepStrictEqual(hits, []);
  });

  summary();
}
run();
