// Pure-function checks for lib/entityColor.js and lib/appearanceThemes.js —
// no Mongoose/Next.js involved, so these load directly, same pattern as
// 01-pure-ordering.test.cjs.
require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

const { projectColorForId, teamColorForId } = require("../src/lib/entityColor.js");
const { APPEARANCE_THEMES, DEFAULT_APPEARANCE_THEME, getAppearanceTheme } = require("../src/lib/appearanceThemes.js");
const { buildTheme } = require("../src/lib/theme.js");

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

  await test("appearance themes: default theme id matches theme.js's original ochre constants", () => {
    const def = getAppearanceTheme(DEFAULT_APPEARANCE_THEME);
    assert.strictEqual(def.id, "default");
    assert.strictEqual(def.light.accent, "#96652A");
    assert.strictEqual(def.light.canvas, "#FAFAF6");
    assert.strictEqual(def.dark.accent, "#C99A4A");
    assert.strictEqual(def.dark.canvas, "#1A1814");
  });

  await test("getAppearanceTheme falls back to default for an unknown id", () => {
    const fallback = getAppearanceTheme("does-not-exist");
    assert.strictEqual(fallback.id, DEFAULT_APPEARANCE_THEME);
  });

  await test("every appearance theme has a unique id and complete light/dark swatches", () => {
    const ids = new Set();
    for (const t of APPEARANCE_THEMES) {
      assert.ok(!ids.has(t.id), `duplicate theme id ${t.id}`);
      ids.add(t.id);
      for (const scheme of ["light", "dark"]) {
        const swatch = t[scheme];
        for (const key of ["canvas", "paper", "accent", "accentHover", "accentSoft"]) {
          assert.ok(typeof swatch[key] === "string" && /^#[0-9A-Fa-f]{6}$/.test(swatch[key]), `${t.id}.${scheme}.${key} is not a hex color`);
        }
      }
    }
  });

  await test("buildTheme with the default appearance id reproduces the exact original palette", () => {
    const theme = buildTheme("light", "default");
    assert.strictEqual(theme.palette.primary.main, "#96652A");
    assert.strictEqual(theme.palette.background.default, "#FAFAF6");
    assert.strictEqual(theme.palette.background.paper, "#FFFFFF");
  });

  await test("buildTheme with no appearance id argument behaves the same as \"default\" (backward compatible)", () => {
    const withDefault = buildTheme("dark", "default");
    const withNoArg = buildTheme("dark");
    assert.strictEqual(withNoArg.palette.primary.main, withDefault.palette.primary.main);
    assert.strictEqual(withNoArg.palette.background.default, withDefault.palette.background.default);
  });

  await test("buildTheme swaps the accent/canvas for a non-default appearance, in both modes", () => {
    const lightSlate = buildTheme("light", "slate");
    const darkSlate = buildTheme("dark", "slate");
    assert.strictEqual(lightSlate.palette.primary.main, "#3D6C8F");
    assert.strictEqual(lightSlate.palette.background.default, "#F7F8F9");
    assert.strictEqual(darkSlate.palette.primary.main, "#7FA9C4");
    assert.strictEqual(darkSlate.palette.background.default, "#181B1E");
  });

  await test("buildTheme keeps status colors (error/success/warning) unchanged across appearances", () => {
    const def = buildTheme("light", "default");
    const clay = buildTheme("light", "clay");
    assert.strictEqual(def.palette.error.main, clay.palette.error.main);
    assert.strictEqual(def.palette.success.main, clay.palette.success.main);
    assert.strictEqual(def.palette.warning.main, clay.palette.warning.main);
  });

  summary();
}

run();
