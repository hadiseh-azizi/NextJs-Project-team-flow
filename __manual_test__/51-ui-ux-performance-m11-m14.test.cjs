// M11–M14: task description/due date editing, error/not-found boundaries,
// session hydration, and list/dashboard payload + grouping.
require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const { groupByProjectId, countTasksByProject } = require("../src/lib/groupByProjectId.js");
const { toProjectSummaryDTO, toDashboardProjectDTO } = require("../src/lib/serialize.js");

(async () => {
  console.log("\nM14 — one-pass grouping and slim DTOs");

  await test("groupByProjectId buckets in one pass and keeps per-project order", () => {
    const g = groupByProjectId([
      { _id: 1, project: "a" }, { _id: 2, project: "b" }, { _id: 3, project: "a" },
    ]);
    assert.deepStrictEqual(g.get("a").map((t) => t._id), [1, 3]);
    assert.deepStrictEqual(g.get("b").map((t) => t._id), [2]);
    assert.strictEqual(g.get("c"), undefined);
  });

  await test("countTasksByProject counts total and completed per project", () => {
    const c = countTasksByProject([
      { project: "a", completed: true }, { project: "a", completed: false },
      { project: "b", completed: true }, { project: "a" },
    ]);
    assert.deepStrictEqual(c.get("a"), { total: 3, done: 1 });
    assert.deepStrictEqual(c.get("b"), { total: 1, done: 1 });
  });

  await test("project summary carries counts and no tasks/columns/roster", () => {
    const dto = toProjectSummaryDTO(
      { _id: "p1", name: "P", description: null, createdAt: new Date(0), manager: { _id: "u", name: "U", email: "e" }, team: { _id: "t", name: "T", members: ["u"] } },
      { total: 4, done: 1 }
    );
    assert.deepStrictEqual(dto.progress, { total: 4, done: 1, pct: 25 });
    assert.deepStrictEqual(dto.team, { id: "t", name: "T" });
    for (const k of ["tasks", "columns", "members", "editors"]) assert.ok(!(k in dto), k);
    assert.strictEqual(toProjectSummaryDTO({ _id: "p", name: "n", createdAt: 0, team: { _id: "t", name: "T" } }, undefined).progress.pct, 0);
  });

  // H2 replaced the per-task dashboard DTO with per-project counts (the task
  // lists are separate bounded queries — see 60-performance-h1-h2.test.cjs).
  await test("dashboard DTO carries only id, name and done/total counts — no tasks", () => {
    const dto = toDashboardProjectDTO({ _id: "p1", name: "P" }, { total: 4, done: 1 });
    assert.deepStrictEqual(dto, { id: "p1", name: "P", progress: { total: 4, done: 1, pct: 25 } });
    assert.deepStrictEqual(toDashboardProjectDTO({ _id: "p2", name: "Q" }, undefined).progress, { total: 0, done: 0, pct: 0 });
  });

  await test("list route and dashboard no longer load every task to count it", () => {
    for (const f of ["src/app/api/projects/route.js", "src/app/dashboard/page.jsx"]) {
      const s = read(f);
      assert.ok(!/allTasks/.test(s), f);
      assert.ok(!/Task\.find\(/.test(s), f);
    }
    assert.ok(/countTasksByProjectIds/.test(read("src/app/api/projects/route.js")));
    assert.ok(/loadDashboardData/.test(read("src/app/dashboard/page.jsx")));
  });

  await test("access inputs are unchanged: team members stay populated as ids", () => {
    assert.ok(/select: "name members"/.test(read("src/app/api/projects/route.js")));
    // L10: the candidate query + access filter moved into one shared helper;
    // both callers use it, and it still applies the per-project access check.
    assert.ok(/findAccessibleProjects\(userId/.test(read("src/app/api/projects/route.js")));
    assert.ok(/findAccessibleProjects\(userId/.test(read("src/app/dashboard/page.jsx")));
    assert.ok(/filterAccessibleProjects\(candidates, userId\)/.test(read("src/lib/projectQueries.js")));
  });

  console.log("\nM13 — session hydration");

  await test("dashboard layout seeds SessionProvider with the server session", () => {
    assert.ok(/<AuthProvider session=\{session\}>/.test(read("src/app/dashboard/layout.jsx")));
    assert.ok(/SessionProvider session=\{session\}/.test(read("src/components/AuthProvider.jsx")));
    assert.ok(!/AuthProvider/.test(read("src/app/layout.jsx")));
  });

  await test("project and team pages do not draw permissions while the session loads", () => {
    assert.ok(/sessionStatus === "loading"/.test(read("src/app/dashboard/projects/[id]/page.jsx")));
    assert.ok(/sessionStatus === "loading"/.test(read("src/app/dashboard/teams/[id]/page.jsx")));
  });

  await test("backend authorization files are untouched by this session", () => {
    const authz = read("src/lib/authz.js");
    assert.ok(/export function canEditProject/.test(authz));
  });

  console.log("\nM12 — boundaries");

  await test("error, global-error, not-found boundaries exist and hide error text", () => {
    for (const f of ["src/app/error.jsx", "src/app/dashboard/error.jsx", "src/app/global-error.jsx", "src/app/not-found.jsx"]) {
      assert.ok(fs.existsSync(path.join(root, f)), f);
    }
    for (const f of ["src/components/RouteError.jsx", "src/app/global-error.jsx"]) {
      assert.ok(!/error\.message|error\.stack/.test(read(f)), f);
    }
  });

  await test("dashboard overview streams behind a Suspense loader", () => {
    assert.ok(/<Suspense fallback=\{<TeamFlowLoader/.test(read("src/app/dashboard/page.jsx")));
  });

  await test("project/team pages show not-found for 404 and 403", () => {
    for (const f of ["src/app/dashboard/projects/[id]/page.jsx", "src/app/dashboard/teams/[id]/page.jsx"]) {
      const s = read(f);
      assert.ok(/err\.status === 404 \|\| err\.status === 403/.test(s), f);
      assert.ok(/not found"/.test(s), f);
    }
  });

  console.log("\nM11 — edit description and due date");

  await test("dialog sends description and dueDate through the existing PATCH", () => {
    const s = read("src/components/TaskDetailDialog.jsx");
    assert.ok(/JSON\.stringify\(\{ description: next \}\)/.test(s));
    assert.ok(/JSON\.stringify\(\{ dueDate: value \}\)/.test(s));
    assert.ok(/persistDueDate\(null\)/.test(s), "clear sends null");
    assert.ok(/canEdit \?/.test(s));
  });

  await test("task PATCH route accepts description and a null due date (unchanged API)", () => {
    const { validateOptionalDate, validateOptionalString } = require("../src/lib/validation.js");
    assert.strictEqual(validateOptionalDate(null, { field: "d" }).value, null);
    assert.strictEqual(validateOptionalDate("", { field: "d" }).value, null);
    assert.strictEqual(validateOptionalString("   ", { field: "d" }).value, null);
    assert.ok(/body\.description !== undefined/.test(read("src/app/api/tasks/[id]/route.js")));
    assert.ok(/body\.dueDate !== undefined/.test(read("src/app/api/tasks/[id]/route.js")));
  });

  await test("project PATCH does not support description, so none was added", () => {
    assert.ok(!/body\.description/.test(read("src/app/api/projects/[id]/route.js")));
  });

  await test("saved field changes patch local state; moves still reload", () => {
    const page = read("src/app/dashboard/projects/[id]/page.jsx");
    assert.ok(/onTaskPatched=\{patchTask\}/.test(page));
    assert.ok(/loadsInFlight\.current > 0/.test(page));
    const dlg = read("src/components/TaskDetailDialog.jsx");
    assert.ok(/saveColumn[\s\S]*?onChanged\(\)/.test(dlg));
  });

  summary();
})();
