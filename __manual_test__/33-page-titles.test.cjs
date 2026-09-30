// Dynamic browser tab titles — see CHANGELOG.md.
//
// Covers lib/pageTitle.js (pure JS). The Next.js metadata wiring and the
// client hook need a browser/DOM, which this Node-only harness doesn't have;
// the route -> title mapping is instead checked statically against the
// layout/page source files.
require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const { createPageTitle, cleanTitleName, MAX_TITLE_NAME_LENGTH } = require("../src/lib/pageTitle.js");

const app = path.join(__dirname, "..", "src", "app");
const read = (p) => fs.readFileSync(path.join(app, p), "utf8");

(async () => {
  await test("static and dynamic titles follow 'Name | Team Flow'", () => {
    assert.strictEqual(createPageTitle("Dashboard"), "Dashboard | Team Flow");
    assert.strictEqual(createPageTitle("Website Redesign"), "Website Redesign | Team Flow");
  });

  await test("no name and no fallback yields the bare app name", () => {
    assert.strictEqual(createPageTitle(), "Team Flow");
  });

  await test("missing/invalid names fall back instead of leaking undefined/null/object/id", () => {
    for (const bad of [undefined, null, "", "   ", {}, [], 42, "undefined", "null", "[object Object]", "64b7f0c2a1d3e4f5a6b7c8d9"]) {
      assert.strictEqual(createPageTitle(bad, "Project"), "Project | Team Flow", String(bad));
    }
  });

  await test("'Team Flow' can never appear twice", () => {
    assert.strictEqual(createPageTitle("Dashboard | Team Flow"), "Dashboard | Team Flow");
    assert.strictEqual(createPageTitle("Alpha | Team Flow | Team Flow"), "Alpha | Team Flow");
    assert.strictEqual(createPageTitle("Team Flow"), "Team Flow");
    assert.strictEqual(createPageTitle("Team Flow | Team Flow"), "Team Flow");
  });

  await test("Persian, numbers and punctuation pass through unchanged", () => {
    assert.strictEqual(createPageTitle("پروژه مدیریت کارها"), "پروژه مدیریت کارها | Team Flow");
    assert.strictEqual(createPageTitle("Team #1"), "Team #1 | Team Flow");
    assert.strictEqual(createPageTitle("Website V2"), "Website V2 | Team Flow");
  });

  await test("whitespace and control characters are normalised", () => {
    assert.strictEqual(cleanTitleName("  A \n\t B  "), "A B");
  });

  await test("very long names are truncated for the title only, without splitting code points", () => {
    const long = "x".repeat(300);
    const out = cleanTitleName(long);
    assert.strictEqual(Array.from(out).length, MAX_TITLE_NAME_LENGTH);
    assert.ok(out.endsWith("…"));
    const emoji = "😀".repeat(200);
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(cleanTitleName(emoji)));
    assert.strictEqual(long.length, 300); // input untouched
  });

  await test("root layout defines default + template and keeps the description", () => {
    const src = read("layout.jsx");
    assert.ok(/default:\s*"Team Flow"/.test(src));
    assert.ok(/template:\s*"%s \| Team Flow"/.test(src));
    assert.ok(/description:\s*"Kanban boards/.test(src));
  });

  await test("each static route exports the expected metadata title", () => {
    const expected = {
      "login/layout.jsx": "Sign In",
      "register/layout.jsx": "Sign Up",
      "verify-email/layout.jsx": "Verify Email",
      "forgot-password/layout.jsx": "Forgot Password",
      "reset-password/layout.jsx": "Reset Password",
      "dashboard/page.jsx": "Dashboard",
      "dashboard/projects/layout.jsx": "Projects",
      "dashboard/teams/layout.jsx": "Teams",
    };
    for (const [file, title] of Object.entries(expected)) {
      assert.ok(read(file).includes(`title: "${title}"`), file);
    }
  });

  await test("detail routes have a metadata fallback and the client hook", () => {
    assert.ok(read("dashboard/projects/[id]/layout.jsx").includes('title: "Project"'));
    assert.ok(read("dashboard/teams/[id]/layout.jsx").includes('title: "Team"'));
    assert.ok(read("dashboard/projects/[id]/page.jsx").includes('useDocumentTitle(project?.name, "Project")'));
    assert.ok(read("dashboard/teams/[id]/page.jsx").includes('useDocumentTitle(team?.name, "Team")'));
  });

  summary();
})();
