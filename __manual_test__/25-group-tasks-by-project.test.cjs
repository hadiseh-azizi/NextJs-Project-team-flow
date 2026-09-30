// Separate Open/Closed Tasks by Project — see CHANGELOG.md.
//
// `groupByProject` is a plain-JS helper (no React, no Mongoose), so unlike
// the OverviewStats component it lives in it can be exercised directly
// under Node without a DOM. It's the piece responsible for requirements 1,
// 2, 3, 6, 10 and 11 of that task: grouping the dashboard's "My open
// tasks" / "Tasks completed" lists by project, never letting a task from
// one project appear under another, and doing so for any number of
// projects with no hardcoded names.
require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

const { groupByProject } = require("../src/lib/groupByProject.js");

(async () => {
  await test("groups items by projectId, preserving each project's item order", () => {
    const items = [
      { id: "t1", projectId: "pA", projectName: "Alpha", title: "one" },
      { id: "t2", projectId: "pB", projectName: "Beta", title: "two" },
      { id: "t3", projectId: "pA", projectName: "Alpha", title: "three" },
    ];
    const groups = groupByProject(items);

    assert.strictEqual(groups.length, 2, "two distinct projects produce two groups");
    assert.strictEqual(groups[0].projectId, "pA");
    assert.strictEqual(groups[0].projectName, "Alpha");
    assert.deepStrictEqual(
      groups[0].items.map((i) => i.id),
      ["t1", "t3"],
      "Alpha's tasks keep their original relative order and never include Beta's"
    );
    assert.strictEqual(groups[1].projectId, "pB");
    assert.deepStrictEqual(groups[1].items.map((i) => i.id), ["t2"]);
  });

  await test("groups are ordered by each project's first appearance in the input", () => {
    // Simulates the "soonest due date first" sort already applied before
    // grouping: Beta's earliest-due task appears before any Alpha task.
    const items = [
      { id: "t1", projectId: "pB", projectName: "Beta" },
      { id: "t2", projectId: "pA", projectName: "Alpha" },
      { id: "t3", projectId: "pB", projectName: "Beta" },
    ];
    const groups = groupByProject(items);
    assert.deepStrictEqual(groups.map((g) => g.projectId), ["pB", "pA"]);
  });

  await test("a project with nothing in the list produces no group (not an empty one)", () => {
    // pC has open tasks elsewhere in the app, but none assigned to this
    // user right now — it must not show up as an empty section.
    const items = [{ id: "t1", projectId: "pA", projectName: "Alpha" }];
    const groups = groupByProject(items);
    assert.strictEqual(groups.length, 1);
    assert.ok(
      !groups.some((g) => g.projectId === "pC"),
      "a project absent from the input never appears as an empty group"
    );
  });

  await test("an empty task list produces no groups at all", () => {
    assert.deepStrictEqual(groupByProject([]), []);
  });

  await test("many projects each get their own group, with no cross-project leakage", () => {
    const projectIds = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const items = projectIds.flatMap((id, i) => [
      { id: `${id}-a`, projectId: id, projectName: `Project ${i}` },
      { id: `${id}-b`, projectId: id, projectName: `Project ${i}` },
    ]);
    const groups = groupByProject(items);
    assert.strictEqual(groups.length, 8, "works for an arbitrary number of projects, not just one or two");
    for (const group of groups) {
      assert.ok(
        group.items.every((it) => it.id.startsWith(group.projectId)),
        `group ${group.projectId} must only contain its own project's items`
      );
    }
  });

  summary();
})();
