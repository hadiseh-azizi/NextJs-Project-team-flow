require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Audit items M15-M18. No browser is available here, so M16-M18 are checked
// at the source/logic level (see the final report for what that cannot show).
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const SAVED = { uri: process.env.MONGODB_URI, secret: process.env.NEXTAUTH_SECRET };
function withoutEnv(fn) {
  delete process.env.MONGODB_URI;
  delete process.env.NEXTAUTH_SECRET;
  try {
    return fn();
  } finally {
    process.env.MONGODB_URI = SAVED.uri;
    process.env.NEXTAUTH_SECRET = SAVED.secret;
  }
}

(async () => {
  console.log("M15 import-time validation / DB timeouts");

  await test("importing mongodb.js, verificationToken.js and auth.js needs no secrets", async () => {
    withoutEnv(() => {
      resetModuleCache();
      delete global._mongoose;
      require("../src/lib/mongodb.js");
      require("../src/lib/verificationToken.js");
      const { authOptions } = require("../src/lib/auth.js");
      assert.ok(authOptions.providers.length > 0);
    });
  });

  await test("runtime stays strict: connectDB without MONGODB_URI rejects with the same message", async () => {
    let connectCalls = 0;
    const fake = { connect: () => (connectCalls++, Promise.resolve({})) };
    fake.default = fake;
    fake.__esModule = true;
    resetModuleCache();
    delete global._mongoose;
    mockModule("mongoose", fake);
    const { connectDB } = require("../src/lib/mongodb.js");
    delete process.env.MONGODB_URI;
    try {
      await assert.rejects(connectDB(), /MONGODB_URI is not set/);
      assert.strictEqual(connectCalls, 0);
      assert.strictEqual(global._mongoose.promise, null, "a failed check must not cache anything");
    } finally {
      process.env.MONGODB_URI = SAVED.uri;
    }
  });

  await test("runtime stays strict: signing/verifying a token and reading authOptions.secret throw without NEXTAUTH_SECRET", async () => {
    resetModuleCache();
    const { createVerificationToken, verifyVerificationToken } = require("../src/lib/verificationToken.js");
    const { authOptions } = require("../src/lib/auth.js");
    const ok = createVerificationToken("u1", "a@b.co", 0);
    assert.strictEqual(verifyVerificationToken(ok).userId, "u1");
    assert.strictEqual(authOptions.secret, process.env.NEXTAUTH_SECRET);
    withoutEnv(() => {
      assert.throws(() => createVerificationToken("u1", "a@b.co", 0), /NEXTAUTH_SECRET is not set/);
      assert.throws(() => verifyVerificationToken(ok), /NEXTAUTH_SECRET is not set/);
      assert.throws(() => authOptions.secret, /NEXTAUTH_SECRET is not set/);
    });
  });

  await test("connect options carry explicit timeouts, and H1 retry logic is untouched", async () => {
    let seen;
    const fake = { connect: async (uri, opts) => ((seen = { uri, opts }), {}) };
    fake.default = fake;
    fake.__esModule = true;
    resetModuleCache();
    delete global._mongoose;
    mockModule("mongoose", fake);
    await require("../src/lib/mongodb.js").connectDB();
    assert.strictEqual(seen.uri, process.env.MONGODB_URI);
    for (const k of ["serverSelectionTimeoutMS", "connectTimeoutMS", "socketTimeoutMS", "waitQueueTimeoutMS", "bufferTimeoutMS"]) {
      assert.ok(Number.isInteger(seen.opts[k]) && seen.opts[k] > 0 && seen.opts[k] <= 30000, k);
    }
    const src = read("src/lib/mongodb.js");
    assert.ok(/if \(cached\.promise === pending\) cached\.promise = null;/.test(src));
  });

  console.log("M16 drag indicators");
  const board = read("src/components/KanbanBoard.jsx");
  const card = read("src/components/TaskCard.jsx");

  await test("board clears indicators on dragend/drop/leaving the window and removes its listeners", async () => {
    for (const ev of ["dragend", "drop", "dragleave"]) {
      assert.ok(board.includes(`document.addEventListener("${ev}"`), ev);
      assert.ok(board.includes(`document.removeEventListener("${ev}"`), ev);
    }
  });

  await test("column dragleave ignores moves between children and only clears its own column", async () => {
    assert.ok(/onDragLeave=\{\(e\) => handleColumnDragLeave\(e, column\.id\)\}/.test(board));
    assert.ok(!/onDragLeave=\{\(\) => setDragOverCol\(null\)\}/.test(board));
    assert.ok(board.includes("column.contains(next)"));
    assert.ok(board.includes("prev === columnId ? null : prev"));
  });

  await test("handleDrop still reads the target before clearing; card dragover skips identical targets", async () => {
    const drop = board.slice(board.indexOf("async function handleDrop"));
    assert.ok(drop.indexOf("const target =") < drop.indexOf("clearDragIndicators()"));
    assert.ok(board.includes("prev.position === position"));
    assert.ok(card.includes('document.addEventListener("dragend", stop)'));
  });

  console.log("M17 touch");
  const { touchHitAreaSx, touchMinSizeSx, TOUCH_TARGET_MIN } = require("../src/lib/touchTarget.js");

  await test("hit-area helper reaches 44px, only under (pointer: coarse), and honours per-side limits", async () => {
    const sx = touchHitAreaSx(26);
    assert.deepStrictEqual(Object.keys(sx), ["@media (pointer: coarse)"]);
    const box = sx["@media (pointer: coarse)"]["&::after"];
    assert.strictEqual(-box.left + 26 + -box.right, TOUCH_TARGET_MIN);
    const limited = touchHitAreaSx(30, { left: 3, right: 11 })["@media (pointer: coarse)"]["&::after"];
    assert.strictEqual(limited.left, -3);
    assert.strictEqual(limited.right, -11);
    assert.deepStrictEqual(touchMinSizeSx["@media (pointer: coarse)"], { minWidth: 44, minHeight: 44 });
  });

  await test("column header neighbours do not claim the same pixels", async () => {
    // collapse (right 3) and options (left 3) sit 6px apart: they meet, never overlap.
    assert.ok(board.includes("touchHitAreaSx(30, { left: 11, right: 3 })"));
    assert.ok(board.includes("touchHitAreaSx(30, { left: 3, right: 11 })"));
  });

  await test("task move without dragging stays available: dialog Column select is enabled for editors", async () => {
    const dlg = read("src/components/TaskDetailDialog.jsx");
    assert.ok(/labelId="edit-column-label"[\s\S]*?disabled=\{!canEdit\}/.test(dlg));
    assert.ok(read("src/lib/theme.js").includes('"@media (pointer: coarse)": { minHeight: 44 }'));
  });

  console.log("M18 accessibility");

  await test("TaskCard is no longer a button containing buttons", async () => {
    const cardTag = card.slice(card.indexOf("<Card"), card.indexOf("<CardContent"));
    assert.ok(!/role="button"/.test(cardTag) && !/tabIndex/.test(cardTag) && !/aria-label/.test(cardTag));
    assert.ok(/className="task-open"\s+role="button"\s+tabIndex=\{0\}/.test(card));
    assert.ok(card.includes("onClick={() => onOpen(task)}"), "mouse/touch click on the card still opens the task");
    assert.ok(!card.includes("<ButtonBase") && !/component="button"/.test(card), "no native button in the draggable title (Firefox can't drag from one)");
  });

  await test("title opens with Enter and Space, like the old card", async () => {
    assert.ok(/handleOpenKeyDown[\s\S]{0,200}e\.key === "Enter" \|\| e\.key === " "/.test(card));
  });

  await test("control outlines meet 3:1 in both modes; decorative borders unchanged", async () => {
    const { BRAND } = require("../src/lib/brand.js");
    assert.strictEqual(BRAND.light.border, "#DCE3EE");
    assert.strictEqual(BRAND.light.borderStrong, "#C2CCDC");
    assert.strictEqual(BRAND.dark.border, "#24324A");
    assert.strictEqual(BRAND.dark.borderStrong, "#34455F");
    for (const mode of ["light", "dark"]) {
      const t = BRAND[mode];
      const surfaces = [t.surface, t.surfaceElevated, t.surfaceInput];
      if (mode === "light") surfaces.push(t.background);
      for (const bg of surfaces) assert.ok(contrast(t.controlBorder, bg) >= 3, `${mode} ${bg}: ${contrast(t.controlBorder, bg).toFixed(2)}`);
    }
    const theme = read("src/lib/theme.js");
    assert.ok((theme.match(/controlLine/g) || []).length >= 5);
  });

  await test("error snackbars have no timeout and ignore click-away; notice keeps its timeout", async () => {
    assert.ok(!/<Snackbar open=\{!!error\}/.test(board));
    const fn = board.slice(board.indexOf("function ErrorSnackbar"), board.indexOf("export default function KanbanBoard"));
    assert.ok(!fn.includes("autoHideDuration"));
    assert.ok(fn.includes('reason !== "clickaway"'));
    assert.strictEqual((board.match(/<ErrorSnackbar /g) || []).length, 2);
    assert.ok(board.includes("autoHideDuration={3000}"));
  });

  await test("labels that sat on plain <div>/<span> elements are now real text or a role", async () => {
    assert.ok(!/<Box[^>]*aria-label=\{`\$\{task\.attachments/.test(card));
    assert.ok(card.includes("attached files"));
    assert.ok(/<Avatar role="img" aria-label/.test(card));
    assert.ok(!/<Typography[^>]*aria-label=\{`\$\{colTasks\.length\}/.test(board));
    assert.ok(board.includes('" tasks"'));
  });

  summary();
})();
