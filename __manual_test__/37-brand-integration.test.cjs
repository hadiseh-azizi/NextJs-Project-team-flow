require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

// Brand integration guards. Rendering is not testable without a browser, so
// these check the things that silently regress: every brand instance goes
// through the one component, the assets exist, and the wordmark spelling.

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function png(p) {
  const b = fs.readFileSync(path.join(root, p));
  assert.strictEqual(b.slice(1, 4).toString(), "PNG", `${p} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

(async () => {
  await test("symbol asset is a transparent PNG with the expected proportions", () => {
    const s = png("public/brand/symbol.png");
    assert.strictEqual(s.colorType, 6, "RGBA");
    assert.ok(Math.abs(s.w / s.h - 333 / 276) < 0.01, "matches SYMBOL_RATIO in TeamFlowBrand");
  });

  await test("app icon tiles exist at the declared sizes", () => {
    for (const [f, n] of [["icon-32.png", 32], ["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
      const i = png(`public/brand/${f}`);
      assert.strictEqual(i.w, n);
      assert.strictEqual(i.h, n);
    }
    assert.ok(fs.existsSync(path.join(root, "public/favicon.ico")));
  });

  await test("brand component: accessible name, decorative image, official spelling", () => {
    const src = read("src/components/TeamFlowBrand.jsx");
    assert.ok(src.includes('aria-label="Team Flow"'));
    assert.ok(src.includes('alt=""'), "symbol image is decorative inside a labelled link");
    assert.ok(/Team <span className="tf-brand-flow">Flow<\/span>/.test(src));
    assert.ok(!/TeamFlow"/.test(src.replace(/TeamFlowBrand/g, "")), "no 'TeamFlow' spelling");
  });

  await test("old text-only Wordmark is gone and nothing imports it", () => {
    assert.ok(!fs.existsSync(path.join(root, "src/components/Wordmark.jsx")));
    for (const f of ["src/components/Navbar.jsx", "src/components/AuthShell.jsx", "src/app/page.jsx", "src/app/shared/board/[token]/page.jsx"]) {
      const s = read(f);
      assert.ok(!s.includes("Wordmark"), `${f} still references Wordmark`);
      assert.ok(s.includes("TeamFlowBrand"), `${f} should use TeamFlowBrand`);
    }
  });

  await test("layout declares the symbol-only icons", () => {
    const s = read("src/app/layout.jsx");
    assert.ok(s.includes("/favicon.ico") && s.includes("/brand/icon-192.png") && s.includes("apple-touch-icon.png"));
  });

  summary();
})();
