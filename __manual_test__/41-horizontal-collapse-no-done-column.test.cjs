require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

// Two scoped changes, checked at source level (no browser is available —
// layout and animation are in the manual matrix in CHANGELOG.md):
//   1. Collapsed columns shrink horizontally; the title stays horizontal.
//   2. No column is a special "Completed/Done" column; completion is the
//      task's own flag and moving/collapsing never touches it.

const root = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
// Code only: drop // and /* */ comments so explanations don't trip the scans.
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

(async () => {
  console.log("Horizontal collapse");

  await test("collapsed title is never vertical, rotated or stacked (rail + board)", () => {
    for (const f of ["components/CollapsedColumnRail.jsx", "components/KanbanBoard.jsx", "lib/collapsedColumns.js"]) {
      const src = code(f);
      assert.ok(!/writing-?mode|vertical-rl|vertical-lr|rotate|text-orientation|wordBreak|word-break|letterSpacing/i.test(src), `${f}: no vertical/rotated/stacked text`);
    }
  });

  await test("collapsed title is a single horizontal line (noWrap + ellipsis) with the full name in title and aria-label", () => {
    const src = read("components/CollapsedColumnRail.jsx");
    assert.ok(/noWrap/.test(src));
    assert.ok(/title=\{column\.name\}/.test(src));
    assert.ok(/aria-label=\{`Expand column \$\{column\.name\}, \$\{taskLabel\}`\}/.test(src));
    assert.ok(/aria-expanded=\{false\}/.test(src));
  });

  await test("the whole collapsed panel is one real button (click, Enter and Space expand it)", () => {
    const src = code("components/CollapsedColumnRail.jsx");
    assert.ok(/<ButtonBase[\s\S]*type="button"[\s\S]*onClick=\{onExpand\}/.test(src));
  });

  await test("width animates via flex-basis; the collapsed width is narrower than expanded", () => {
    const board = code("components/KanbanBoard.jsx");
    assert.ok(/flex: collapsed \? `0 0 \$\{COLLAPSED_COLUMN_WIDTH\}px`/.test(board));
    assert.ok(/transition: `flex-basis \$\{COLLAPSE_MS\}ms \$\{COLLAPSE_EASE\}`/.test(board));
    const { COLLAPSED_COLUMN_WIDTH } = require("../src/lib/collapsedColumns.js");
    assert.ok(COLLAPSED_COLUMN_WIDTH < 288);
  });

  await test("collapsing does not stretch or resize sibling columns, and the board keeps its horizontal scroll", () => {
    const board = code("components/KanbanBoard.jsx");
    assert.ok(/overflowX: "auto"/.test(board));
    // every expanded column keeps a fixed basis; none grows
    assert.ok(/"0 0 84%"/.test(board) && /"0 0 288px"/.test(board));
    assert.ok(!/flexGrow: 1[^\n]*collapsed|collapsed[^\n]*flexGrow/.test(board));
  });

  await test("the collapsed panel has the same 48px header height as the expanded header (no vertical jump)", () => {
    assert.ok(/height: 48/.test(read("components/CollapsedColumnRail.jsx")));
  });

  console.log("No special Completed/Done column");

  await test("no isDoneColumn anywhere in src, other than the note in the Column model", () => {
    const hits = walk(root)
      .filter((f) => /\.(js|jsx)$/.test(f))
      .filter((f) => /isDoneColumn/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f).split(path.sep).join("/"));
    assert.deepStrictEqual(hits, ["models/Column.js"]);
    // and in that file it only appears in a comment
    assert.ok(!/isDoneColumn/.test(code("models/Column.js")));
  });

  await test("no Completed-column UI or flow remains in the board", () => {
    const src = read("components/KanbanBoard.jsx");
    for (const needle of ["Move to Completed", "Create Completed Column", "No Completed column", "NEW_DONE_COLUMN_NAME", "ChoiceDialog", "final column", "Final column", "handleToggleDoneColumn", "existingDoneColumn"]) {
      assert.ok(!src.includes(needle), `KanbanBoard must not contain "${needle}"`);
    }
    assert.ok(!fs.existsSync(path.join(root, "components/ChoiceDialog.jsx")));
  });

  await test("completing a task keeps its confirmation dialog and sends exactly one request: completed:true", () => {
    const src = code("components/KanbanBoard.jsx");
    assert.ok(/title="Complete task"/.test(src) && /Are you sure you want to mark/.test(src));
    const start = src.indexOf("async function confirmCompleteTask");
    const end = src.indexOf("async function confirmColumnDelete");
    assert.ok(start > -1 && end > start);
    const body = src.slice(start, end);
    assert.strictEqual((body.match(/apiFetch\(/g) || []).length, 1);
    assert.ok(/body: JSON\.stringify\(\{ completed: true \}\)/.test(body));
    assert.ok(!/columnId|\/columns/.test(body), "completing must not move a task or create/look up a column");
  });

  await test("reopening a task is still a plain completed:false toggle", () => {
    assert.ok(/JSON\.stringify\(\{ completed: false \}\)/.test(read("components/KanbanBoard.jsx")));
  });

  await test("dragging a task sends only column + position — never `completed`", () => {
    const src = code("components/KanbanBoard.jsx");
    const start = src.indexOf("async function handleDrop");
    const end = src.indexOf("async function confirmTaskDelete");
    const body = src.slice(start, end);
    assert.ok(/JSON\.stringify\(\{ columnId, targetIndex \}\)/.test(body));
    assert.ok(!/completed/.test(body));
  });

  await test("column reorder and collapse code never mention task completion", () => {
    for (const f of ["lib/columnReorder.js", "lib/useColumnDragReorder.js", "lib/collapsedColumns.js", "lib/useCollapsedColumns.js", "components/CollapsedColumnRail.jsx", "app/api/projects/[id]/columns/order/route.js"]) {
      assert.ok(!/completed/i.test(code(f)), `${f} must not touch completion`);
    }
  });

  await test("progress is still computed from each task's own completed flag only", () => {
    const { projectProgress } = require("../src/lib/taskCompletion.js");
    const tasks = [
      { id: "1", columnId: "x", completed: true },
      { id: "2", columnId: "x", completed: false },
      { id: "3", columnId: "y", completed: true },
    ];
    assert.deepStrictEqual(projectProgress(tasks), { total: 3, done: 2, pct: 67 });
    // same tasks, different columns -> same result
    assert.deepStrictEqual(projectProgress(tasks.map((t) => ({ ...t, columnId: "z" }))), { total: 3, done: 2, pct: 67 });
  });

  await test("shared read-only board and task dialog show no special-column marker", () => {
    assert.ok(!/Final column|\(final\)/.test(read("components/SharedBoardView.jsx")));
    assert.ok(!/Final column|\(final\)/.test(read("components/TaskDetailDialog.jsx")));
  });

  summary();
})();
