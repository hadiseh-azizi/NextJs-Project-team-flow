require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const { STOPS, GRADIENT, ATMOSPHERE, WORDMARK, brandCssVariables, accentGradient } = require("../src/lib/brand.js");
const { buildTheme } = require("../src/lib/theme.js");

const root = path.join(__dirname, "..");

(async () => {
  await test("every gradient is built from the four logo colors (no private hexes)", () => {
    for (const mode of ["light", "dark"]) {
      for (const key of ["brand", "strong", "soft", "subtle", "border"]) {
        const g = GRADIENT[mode][key];
        assert.ok(g.startsWith("linear-gradient("), `${mode}.${key}`);
        const hexes = g.match(/#[0-9A-Fa-f]{6}/g) || [];
        for (const h of hexes) assert.ok(STOPS[mode].includes(h.toUpperCase()), `${mode}.${key} uses ${h}`);
      }
      assert.strictEqual(GRADIENT[mode].brand, WORDMARK.gradient[mode], "brand gradient equals the wordmark gradient");
    }
  });

  await test("atmosphere washes stay faint (alpha <= 0.3) and are radial", () => {
    for (const mode of ["light", "dark"]) {
      const a = ATMOSPHERE[mode];
      for (const layer of [a.page, ...a.hero]) {
        for (const m of layer.matchAll(/rgba\(\d+,\d+,\d+,([0-9.]+)\)/g)) assert.ok(Number(m[1]) <= 0.3, `${mode} alpha ${m[1]}`);
      }
      assert.ok(a.page.split("radial-gradient(").length - 1 >= 3);
    }
  });

  await test("light-mode page atmosphere is fainter than dark-mode's", () => {
    const max = (s) => Math.max(...[...s.matchAll(/rgba\(\d+,\d+,\d+,([0-9.]+)\)/g)].map((m) => Number(m[1])));
    assert.ok(max(ATMOSPHERE.light.page) < max(ATMOSPHERE.dark.page));
  });

  await test("brandCssVariables emits the gradient and atmosphere variables for both modes", () => {
    const css = brandCssVariables();
    const [light, dark] = css.split('html[data-theme-mode="dark"]');
    for (const name of ["gradient", "gradient-strong", "gradient-soft", "gradient-subtle", "gradient-border", "gradient-action", "glow", "atmosphere", "panel-wash", "surface-tint", "border-hover"]) {
      assert.ok(light.includes(`--brand-${name}:`), `light --brand-${name}`);
      assert.ok(dark.includes(`--brand-${name}:`), `dark --brand-${name}`);
    }
  });

  await test("primary button label uses the brand onPrimary token (the old t.onAccent was undefined)", () => {
    for (const mode of ["light", "dark"]) {
      const th = buildTheme(mode);
      const { BRAND } = require("../src/lib/brand.js");
      assert.strictEqual(th.components.MuiButton.styleOverrides.containedPrimary.color, BRAND[mode].onPrimary);
    }
    const src = fs.readFileSync(path.join(root, "src/lib/theme.js"), "utf8");
    assert.ok(!/t\.onAccent/.test(src.replace(/\/\/.*$/gm, "")));
  });

  await test("action gradient keeps the button label at WCAG AA across its whole length", () => {
    const { BRAND, mixHex } = require("../src/lib/brand.js");
    const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
    for (const mode of ["light", "dark"]) {
      for (const g of [GRADIENT[mode].action, GRADIENT[mode].actionHover]) {
        for (const h of g.match(/#[0-9A-Fa-f]{6}/g)) assert.ok(ratio(BRAND[mode].onPrimary, h) >= 4.5, `${mode} ${h} ${ratio(BRAND[mode].onPrimary, h).toFixed(2)}`);
      }
    }
  });

  await test("accentGradient runs from the identity color toward the brand cyan", () => {
    const g = accentGradient("#1D5FD8", "light");
    assert.ok(g.startsWith("linear-gradient(90deg, #1D5FD8"));
  });

  await test("logo is one component with a preserved 333:276 ratio and no stretching", () => {
    const src = fs.readFileSync(path.join(root, "src/components/TeamFlowBrand.jsx"), "utf8");
    assert.ok(src.includes("333 / 276"));
    assert.ok(/height: s\.symbol, width: "auto"/.test(src));
    for (const f of ["src/app/page.jsx", "src/components/AuthShell.jsx", "src/components/Navbar.jsx", "src/app/shared/board/[token]/page.jsx"]) {
      const s = fs.readFileSync(path.join(root, f), "utf8");
      assert.ok(s.includes("TeamFlowBrand") && !s.includes("symbol.png"), f);
    }
  });

  summary();
})();
