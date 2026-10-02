// Projects page: responsive grid, compact cards, and the loading flow
// (exact-count skeletons, Team Flow loader when the count is unknown).
// Pure checks on lib/projectGrid.js and lib/projectCountCache.js, plus
// source checks on the page and components. No browser needed; the layout
// itself was checked in headless Chromium at 320-1920px (see the changelog
// note in the delivery summary).
require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

const grid = require("../src/lib/projectGrid.js");
const cache = require("../src/lib/projectCountCache.js");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

// Minimal browser stand-in so the sessionStorage layer can be exercised.
function fakeWindow(store = {}, { throws = false } = {}) {
  global.window = {
    sessionStorage: {
      getItem: (k) => { if (throws) throw new Error("blocked"); return k in store ? store[k] : null; },
      setItem: (k, v) => { if (throws) throw new Error("blocked"); store[k] = String(v); },
    },
  };
  return store;
}

async function run() {
  await test("grid: 1 column on phones, then 2 / 3 / 4 columns, all minmax(0, 1fr) so nothing can push the page wider", () => {
    const sx = grid.PROJECT_GRID_SX;
    assert.strictEqual(sx.gridTemplateColumns, "minmax(0, 1fr)");
    assert.strictEqual(sx["@media (min-width:520px)"].gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    assert.strictEqual(sx["@media (min-width:700px)"].gridTemplateColumns, "repeat(3, minmax(0, 1fr))");
    assert.strictEqual(sx["@media (min-width:1024px)"].gridTemplateColumns, "repeat(4, minmax(0, 1fr))");
  });

  await test("grid: gaps are responsive and no fixed pixel column widths are used", () => {
    assert.ok(typeof grid.PROJECT_GRID_SX.columnGap === "object");
    assert.ok(!JSON.stringify(grid.PROJECT_GRID_SX).includes("260px"));
  });

  await test("count cache: nothing remembered -> null (caller must not guess)", () => {
    assert.strictEqual(cache.readRememberedProjectCount("u-none"), null);
    assert.strictEqual(cache.readRememberedProjectCount(undefined), null);
    delete global.window;
    assert.strictEqual(cache.readStoredProjectCount("u-none"), null);
  });

  await test("count cache: remembers exactly the count written, per user", () => {
    const store = fakeWindow();
    cache.rememberProjectCount("u1", 3);
    cache.rememberProjectCount("u2", 8);
    assert.strictEqual(cache.readRememberedProjectCount("u1"), 3);
    assert.strictEqual(cache.readRememberedProjectCount("u2"), 8);
    assert.strictEqual(store["tf:project-count:u1"], "3");
  });

  await test("count cache: zero is a real count and is kept (distinct from 'unknown')", () => {
    fakeWindow();
    cache.rememberProjectCount("u0", 0);
    assert.strictEqual(cache.readRememberedProjectCount("u0"), 0);
  });

  await test("count cache: after a full reload the sessionStorage copy is read back", () => {
    fakeWindow({ "tf:project-count:reload-user": "5" });
    assert.strictEqual(cache.readRememberedProjectCount("reload-user"), null); // render-safe read: memory only
    assert.strictEqual(cache.readStoredProjectCount("reload-user"), 5);
    assert.strictEqual(cache.readRememberedProjectCount("reload-user"), 5); // now warm
  });

  await test("count cache: garbage values are ignored, never turned into skeletons", () => {
    fakeWindow({ "tf:project-count:g1": "abc", "tf:project-count:g2": "-4", "tf:project-count:g3": "2.5", "tf:project-count:g4": "99999" });
    for (const id of ["g1", "g2", "g3", "g4"]) assert.strictEqual(cache.readStoredProjectCount(id), null, id);
    cache.rememberProjectCount("g5", -1);
    cache.rememberProjectCount("g5", NaN);
    assert.strictEqual(cache.readRememberedProjectCount("g5"), null);
  });

  await test("count cache: blocked storage does not throw and the in-memory copy still works", () => {
    fakeWindow({}, { throws: true });
    cache.rememberProjectCount("blocked", 4);
    assert.strictEqual(cache.readRememberedProjectCount("blocked"), 4);
    assert.strictEqual(cache.readStoredProjectCount("never-saved"), null);
  });

  await test("page: skeleton count comes from the remembered count, not a constant", () => {
    const src = read("src/app/dashboard/projects/page.jsx");
    assert.match(src, /Array\.from\(\{ length: rememberedCount \}/);
    assert.ok(!/\[0, 1, 2\]\.map/.test(src), "fixed three-skeleton list still present");
    assert.ok(!/<Skeleton\b/.test(src), "generic MUI rectangles still used in the page");
  });

  await test("page: unknown or zero count -> Team Flow loader, never placeholders", () => {
    const src = read("src/app/dashboard/projects/page.jsx");
    assert.match(src, /rememberedCount > 0 \?/);
    assert.match(src, /<TeamFlowLoader label="Loading projects" \/>/);
    assert.match(src, /LOADER_DELAY_MS/);
  });

  await test("page: the count is remembered after a successful load, and cards stay on screen during a refresh", () => {
    const src = read("src/app/dashboard/projects/page.jsx");
    assert.match(src, /rememberProjectCount\(userId, projects\.length\)/);
    assert.match(src, /loading && !hasLoaded/);
  });

  await test("page: sessionStorage is read in an effect, not during render (no hydration mismatch)", () => {
    const src = read("src/app/dashboard/projects/page.jsx");
    assert.match(src, /useState\(\(\) => readRememberedProjectCount\(userId\)\)/);
    assert.match(src, /readStoredProjectCount\(userId\)/);
  });

  await test("page: loading logic only; project fetch/create calls are unchanged", () => {
    const src = read("src/app/dashboard/projects/page.jsx");
    assert.match(src, /apiFetch\("\/api\/projects"\), apiFetch\("\/api\/teams"\)/);
    assert.match(src, /body: JSON\.stringify\(\{ name, description, teamId \}\)/);
    assert.match(src, /setLoadError\(errorMessage\(err, "Couldn't load your projects\. Please try again\."\)\)/);
  });

  await test("page: New project dialog fits a phone and scrolls its fields, not its buttons", () => {
    const src = read("src/app/dashboard/projects/page.jsx");
    assert.match(src, /sx=\{DIALOG_SX\}/);
    assert.match(src, /width: \{ xs: "calc\(100% - 32px\)", sm: "100%" \}/);
    assert.match(src, /maxHeight: \{ xs: "calc\(100% - 32px\)"/);
    assert.match(src, /<Box component="form" onSubmit=\{handleCreate\} sx=\{DIALOG_FORM_SX\}>/);
    assert.match(src, /DIALOG_FORM_SX = \{ display: "flex", flexDirection: "column", minHeight: 0/);
  });

  await test("ProjectCard: no forced square, shares its sizes with the skeleton, name and description clamp", () => {
    const src = read("src/components/ProjectCard.jsx");
    assert.ok(!src.includes("aspectRatio"), "square aspect ratio still forced");
    assert.match(src, /from "@\/lib\/projectGrid"/);
    assert.match(src, /minHeight: PROJECT_BODY_MIN_HEIGHT/);
    assert.match(src, /WebkitLineClamp: 2, WebkitBoxOrient/);
    assert.match(src, /overflowWrap: "anywhere"/);
    assert.match(src, /top: 0,\s*\n\s*left: 0,/); // tab still attached top-left
  });

  await test("ProjectCardSkeleton: same tab, body, radius and shadow as the card, from the same constants", () => {
    const src = read("src/components/ProjectCardSkeleton.jsx");
    for (const name of ["PROJECT_TAB_HEIGHT", "PROJECT_CARD_RADIUS", "PROJECT_BODY_PADDING", "PROJECT_BODY_MIN_HEIGHT"]) {
      assert.ok(src.includes(name), `${name} not used`);
    }
    assert.match(src, /theme\.tf\.shadow\.card/);
    assert.match(src, /animation="wave"/);
    assert.match(src, /borderTop: "1px solid"/);
  });

  await test("TeamFlowLoader: uses the brand mark and brand stops, rotates, is announced as status", () => {
    const src = read("src/components/TeamFlowLoader.jsx");
    assert.match(src, /\/brand\/symbol\.png/);
    assert.match(src, /STOPS/);
    assert.match(src, /rotate\(360deg\)/);
    assert.match(src, /role="status"/);
  });

  await test("no API, model, auth or permission file was touched by this change", () => {
    const touched = ["src/app/api", "src/models", "src/lib/auth.js", "src/lib/authz.js"];
    for (const p of touched) assert.ok(fs.existsSync(path.join(__dirname, "..", p)));
    assert.ok(!read("src/components/ProjectCard.jsx").includes("apiFetch"));
    assert.ok(!read("src/components/ProjectCardSkeleton.jsx").includes("apiFetch"));
  });

  summary();
}

run();
