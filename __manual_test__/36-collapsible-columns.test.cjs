require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

// Collapsible Kanban columns: the pure persistence helpers in
// src/lib/collapsedColumns.js, checked against an in-memory Storage fake,
// plus source-level guards that the feature stays client-only. No browser
// is involved — layout, animation and focus behaviour are covered by the
// manual matrix in CHANGELOG.md.

const {
  collapsedColumnsKey,
  parseCollapsedIds,
  idsToPersist,
  readCollapsedColumns,
  writeCollapsedColumns,
  COLLAPSED_COLUMN_WIDTH,
} = require("../src/lib/collapsedColumns.js");

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}
const throwingStorage = {
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("denied"); },
  removeItem: () => { throw new Error("denied"); },
};

(async () => {
  await test("key is scoped per project", () => {
    assert.notStrictEqual(collapsedColumnsKey("a"), collapsedColumnsKey("b"));
  });

  await test("parse: valid array round-trips, de-duplicated", () => {
    assert.deepStrictEqual(parseCollapsedIds('["a","b","a"]'), ["a", "b"]);
  });

  await test("parse: corrupt / wrong-shaped / non-string input yields []", () => {
    for (const bad of [null, undefined, "", "{", "{}", "42", '"x"', "null", 5]) {
      assert.deepStrictEqual(parseCollapsedIds(bad), []);
    }
  });

  await test("parse: drops non-string and empty entries, caps the length", () => {
    assert.deepStrictEqual(parseCollapsedIds('["a",1,null,"",{"x":1},"b"]'), ["a", "b"]);
    const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => `id${i}`));
    assert.strictEqual(parseCollapsedIds(many).length, 200);
  });

  await test("write then read returns the same ids; each project is independent", () => {
    const s = fakeStorage();
    writeCollapsedColumns("p1", ["c1", "c2"], s);
    writeCollapsedColumns("p2", ["c9"], s);
    assert.deepStrictEqual(readCollapsedColumns("p1", s), ["c1", "c2"]);
    assert.deepStrictEqual(readCollapsedColumns("p2", s), ["c9"]);
  });

  await test("writing an empty set removes the key instead of storing []", () => {
    const s = fakeStorage();
    writeCollapsedColumns("p1", ["c1"], s);
    assert.strictEqual(writeCollapsedColumns("p1", [], s), true);
    assert.strictEqual(collapsedColumnsKey("p1") in s.data, false);
    assert.deepStrictEqual(readCollapsedColumns("p1", s), []);
  });

  await test("persisted ids exclude columns that no longer exist", () => {
    assert.deepStrictEqual(idsToPersist(new Set(["a", "gone", "b"]), ["a", "b", "c"]), ["a", "b"]);
  });

  await test("unknown column list (board between loads) keeps everything rather than wiping", () => {
    assert.deepStrictEqual(idsToPersist(new Set(["a", "b"]), []), ["a", "b"]);
    assert.deepStrictEqual(idsToPersist(new Set(["a", "b"]), undefined), ["a", "b"]);
  });

  await test("disabled or throwing storage never throws; reads as empty, writes report false", () => {
    assert.deepStrictEqual(readCollapsedColumns("p1", throwingStorage), []);
    assert.strictEqual(writeCollapsedColumns("p1", ["c1"], throwingStorage), false);
  });

  await test("missing project id is a no-op", () => {
    const s = fakeStorage();
    assert.deepStrictEqual(readCollapsedColumns(undefined, s), []);
    assert.strictEqual(writeCollapsedColumns(undefined, ["c1"], s), false);
    assert.deepStrictEqual(s.data, {});
  });

  await test("collapsed width is a fixed panel: narrower than expanded (288) but wide enough for a one-line title", () => {
    assert.ok(COLLAPSED_COLUMN_WIDTH >= 144 && COLLAPSED_COLUMN_WIDTH < 288);
  });

  const root = path.join(__dirname, "..", "src");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

  await test("feature is client-only: collapse files never touch the API, models or auth", () => {
    for (const f of ["lib/collapsedColumns.js", "lib/useCollapsedColumns.js", "components/CollapsedColumnRail.jsx"]) {
      const src = read(f);
      assert.ok(!/apiFetch|fetch\(|mongoose|@\/models|@\/lib\/auth|@\/lib\/authz/.test(src), `${f} must stay client-only`);
    }
  });

  await test("the toggle handler in KanbanBoard makes no request and does not touch tasks", () => {
    const src = read("components/KanbanBoard.jsx");
    const start = src.indexOf("function handleToggleCollapsed");
    const end = src.indexOf("// The control that was just used", start);
    assert.ok(start > -1 && end > start, "handler found");
    const body = src.slice(start, end);
    assert.ok(!/apiFetch|onChanged|setTasks|movingTaskIds/.test(body));
  });

  await test("collapsed columns are not drop targets (no hidden task moves)", () => {
    const src = read("components/KanbanBoard.jsx");
    assert.ok(/onDragOver=\{collapsed \? undefined/.test(src));
    assert.ok(/onDrop=\{collapsed \? undefined/.test(src));
  });

  await test("both toggle controls carry state-specific accessible labels", () => {
    assert.ok(/aria-label=\{`Collapse column \$\{column\.name\}`\}/.test(read("components/KanbanBoard.jsx")));
    assert.ok(/aria-label=\{`Expand column \$\{column\.name\}/.test(read("components/CollapsedColumnRail.jsx")));
  });

  summary();
})();
