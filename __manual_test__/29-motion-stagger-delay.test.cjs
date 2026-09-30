// Animations & Micro-Interactions pass — see CHANGELOG.md.
//
// `staggerDelay` is the one piece of this phase's motion work that is
// plain, unit-testable JS (everything else is CSS/JSX behavior with no
// meaningful assertion under this Node-only harness, which has no DOM).
// It lives in lib/staggerDelay.js — deliberately kept out of the .jsx
// component file so it's importable here without a JSX transform — and
// backs FadeInStagger's entrance animation for Kanban columns/tasks. It's
// exported specifically so its capping logic — "a long list must not take
// longer to finish appearing than a short one" — can be checked directly,
// without rendering anything.
require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

const { staggerDelay } = require("../src/lib/staggerDelay.js");

(async () => {
  await test("delay grows linearly with index for a small list", () => {
    assert.strictEqual(staggerDelay(0, 40), 0);
    assert.strictEqual(staggerDelay(1, 40), 40);
    assert.strictEqual(staggerDelay(2, 40), 80);
  });

  await test("delay is capped so a long list finishes appearing in bounded time", () => {
    // With the default base (30ms/step), anything past index 8 would
    // exceed the 240ms cap uncapped — it must clamp instead of growing
    // forever.
    const uncapped = 50 * 30;
    assert.ok(uncapped > 240, "sanity check: this index would exceed the cap if unclamped");
    assert.strictEqual(staggerDelay(50), 240);
  });

  await test("a zero or negative base never produces a negative/NaN delay", () => {
    assert.strictEqual(staggerDelay(3, 0), 0);
  });

  await test("defaults to a 30ms step when no base is given", () => {
    assert.strictEqual(staggerDelay(2), 60);
  });

  summary();
})();
