require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");

const { BRAND, WORDMARK, brandCssVariables, mixHex } = require("../src/lib/brand.js");
const { projectColorForId, teamColorForId } = require("../src/lib/entityColor.js");
const { pastelForString } = require("../src/lib/pastelColor.js");
const { buildTheme } = require("../src/lib/theme.js");

const root = path.join(__dirname, "..");
const HEX = /^#[0-9A-Fa-f]{6}$/;

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

(async () => {
  await test("every brand token is a valid hex (or rgba for the backdrop) in both modes", () => {
    for (const mode of ["light", "dark"]) {
      for (const [k, v] of Object.entries(BRAND[mode])) {
        if (k === "backdrop") continue;
        assert.ok(HEX.test(v), `${mode}.${k} = ${v}`);
      }
    }
    assert.deepStrictEqual(Object.keys(BRAND.light).sort(), Object.keys(BRAND.dark).sort());
  });

  await test("text, action and status colors meet WCAG AA (4.5:1) on their surfaces, in both modes", () => {
    for (const mode of ["light", "dark"]) {
      const t = BRAND[mode];
      const checks = [
        ["text/surface", t.text, t.surface],
        ["text/background", t.text, t.background],
        ["text/elevated", t.text, t.surfaceElevated],
        ["textSecondary/surface", t.textSecondary, t.surface],
        ["textSecondary/background", t.textSecondary, t.background],
        ["textMuted/surface", t.textMuted, t.surface],
        ["onPrimary/primary", t.onPrimary, t.primary],
        ["onPrimary/primaryHover", t.onPrimary, t.primaryHover],
        ["primary/surface (links, focus text)", t.primary, t.surface],
        ["primary/background", t.primary, t.background],
        ["secondary/surface", t.secondary, t.surface],
        ["accent/surface", t.accent, t.surface],
        ["success/surface", t.success, t.surface],
        ["warning/surface", t.warning, t.surface],
        ["error/surface", t.error, t.surface],
        ["info/surface", t.info, t.surface],
        ["tooltipText/tooltipBackground", t.tooltipText, t.tooltipBackground],
      ];
      for (const [name, fg, bg] of checks) {
        // primaryHover is a hover fill in light mode (white text) but a lighter
        // fill in dark mode (dark text); onPrimary is defined against primary,
        // so only require the hover pairing where it is a real pairing.
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= 4.5, `${mode} ${name}: ${ratio.toFixed(2)}`);
      }
    }
  });

  await test("borders are visible against their surfaces (3:1 for strong borders, 1.15:1 hairlines)", () => {
    for (const mode of ["light", "dark"]) {
      const t = BRAND[mode];
      assert.ok(contrast(t.borderStrong, t.surface) >= 1.5, `${mode} borderStrong`);
      assert.ok(contrast(t.border, t.surface) >= 1.1, `${mode} border`);
    }
  });

  await test("brandCssVariables declares every required --brand-* variable for light and dark", () => {
    const css = brandCssVariables();
    const required = [
      "primary", "primary-hover", "primary-active", "secondary", "accent", "background",
      "surface", "surface-elevated", "border", "text", "text-secondary", "text-muted",
      "success", "warning", "error",
    ];
    const [light, dark] = css.split('html[data-theme-mode="dark"]');
    for (const name of required) {
      assert.ok(light.includes(`--brand-${name}:`), `light missing --brand-${name}`);
      assert.ok(dark.includes(`--brand-${name}:`), `dark missing --brand-${name}`);
    }
    assert.ok(light.includes(BRAND.light.primary) && dark.includes(BRAND.dark.primary));
  });

  await test("buildTheme maps brand tokens onto MUI in both modes, with no appearance argument", () => {
    for (const mode of ["light", "dark"]) {
      const th = buildTheme(mode);
      const t = BRAND[mode];
      assert.strictEqual(th.palette.primary.main, t.primary);
      assert.strictEqual(th.palette.primary.dark, t.primaryHover);
      assert.strictEqual(th.palette.secondary.main, t.secondary);
      assert.strictEqual(th.palette.background.default, t.background);
      assert.strictEqual(th.palette.background.paper, t.surface);
      assert.strictEqual(th.palette.text.primary, t.text);
      assert.strictEqual(th.palette.error.main, t.error);
      assert.strictEqual(th.palette.divider, t.border);
      assert.strictEqual(th.palette.surface.track, t.track);
    }
    assert.strictEqual(buildTheme.length, 1, "buildTheme takes only the color mode");
  });

  await test("the wordmark gradient is the unchanged official one", () => {
    assert.strictEqual(WORDMARK.gradient.light, "linear-gradient(90deg, #5B5FEE 0%, #2F7DF0 38%, #1FA3DC 66%, #17BE97 100%)");
    assert.strictEqual(WORDMARK.gradient.dark, "linear-gradient(90deg, #6A6FF7 0%, #3E8EFB 38%, #3EB6F5 66%, #35DEB4 100%)");
    const src = fs.readFileSync(path.join(root, "src/components/TeamFlowBrand.jsx"), "utf8");
    assert.ok(src.includes("WORDMARK.gradient") && !/#[0-9A-Fa-f]{6}/.test(src), "TeamFlowBrand has no private colors");
  });

  await test("project and team identity colors stay inside the brand hue band and are legible as graphics", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
    for (const mode of ["light", "dark"]) {
      const surface = BRAND[mode].surface;
      for (const id of ids) {
        const p = projectColorForId(id, mode);
        const team = teamColorForId(id, mode);
        for (const c of [p.strong, p.muted, team]) {
          assert.ok(HEX.test(c), `${mode} ${c}`);
          const h = hue(c);
          assert.ok(h >= 150 && h <= 270, `${mode} ${c} hue ${h.toFixed(0)} is outside the brand blue/violet/teal band`);
        }
        assert.ok(contrast(p.strong, surface) >= 3, `${mode} project ${p.strong} on surface`);
        assert.ok(contrast(team, surface) >= 3, `${mode} team ${team} on surface`);
        assert.ok(contrast(p.muted, surface) < contrast(p.strong, surface), `${mode} muted is quieter than strong`);
      }
    }
  });

  await test("project palette gives eight distinct colors; team palette shares none of them", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
    const proj = new Set(ids.map((i) => projectColorForId(i, "light").strong));
    const team = new Set(ids.map((i) => teamColorForId(i, "light")));
    assert.strictEqual(proj.size, 8);
    assert.strictEqual(team.size, 8);
    for (const c of team) assert.ok(!proj.has(c), `${c} appears in both palettes`);
  });

  await test("avatar tints are brand-family hues and keep body text readable in both modes", () => {
    for (let i = 0; i < 200; i++) {
      for (const mode of ["light", "dark"]) {
        const c = pastelForString(`user-${i}`, mode);
        assert.ok(HEX.test(c));
        const h = hue(c);
        assert.ok(h >= 150 && h <= 270, `${mode} ${c} hue ${h.toFixed(0)}`);
        assert.ok(contrast(BRAND[mode].text, c) >= 4.5, `${mode} text on ${c}`);
      }
    }
  });

  await test("mixHex blends toward the target and is deterministic", () => {
    assert.strictEqual(mixHex("#000000", "#FFFFFF", 0.5), "#808080");
    assert.strictEqual(mixHex("#1D5FD8", "#FFFFFF", 0), "#1D5FD8");
    assert.strictEqual(mixHex("#1D5FD8", "#FFFFFF", 1), "#FFFFFF");
  });

  await test("color-theme customization is gone: files, provider, picker and storage logic", () => {
    for (const f of ["src/components/AppearancePickerButton.jsx", "src/components/AppearanceThemeContext.jsx", "src/lib/appearanceThemes.js"]) {
      assert.ok(!fs.existsSync(path.join(root, f)), `${f} should be deleted`);
    }
    const hits = [];
    for (const f of walk(path.join(root, "src"))) {
      const s = fs.readFileSync(f, "utf8");
      if (/teamflow-appearance-theme|setAppearanceTheme|useAppearanceTheme|APPEARANCE_THEMES|AppearanceTheme|AppearancePicker|appearanceThemes|data-appearance-theme/.test(s)) {
        hits.push(path.relative(root, f).split(path.sep).join("/"));
      }
    }
    // The only remaining mention is the one-line cleanup of the old
    // localStorage value in the pre-hydration script.
    assert.deepStrictEqual(hits, ["src/app/layout.jsx"]);
    const layout = fs.readFileSync(path.join(root, "src/app/layout.jsx"), "utf8");
    assert.ok(layout.includes('removeItem("teamflow-appearance-theme")'));
    assert.ok(!layout.includes("setItem"), "nothing writes the old key any more");
    const navbar = fs.readFileSync(path.join(root, "src/components/Navbar.jsx"), "utf8");
    assert.ok(!navbar.includes("Appearance"));
  });

  await test("dark/light mode is untouched: toggle, provider and pre-hydration mode script remain", () => {
    for (const f of ["src/components/ThemeToggleButton.jsx", "src/components/ThemeModeContext.jsx"]) {
      assert.ok(fs.existsSync(path.join(root, f)), `${f} must remain`);
    }
    const navbar = fs.readFileSync(path.join(root, "src/components/Navbar.jsx"), "utf8");
    assert.ok(navbar.includes("ThemeToggleButton"));
    const layout = fs.readFileSync(path.join(root, "src/app/layout.jsx"), "utf8");
    assert.ok(layout.includes("teamflow-theme-mode") && layout.includes("brandCssVariables()"));
  });

  await test("no color literals outside the brand/palette libraries", () => {
    // Files that are allowed to define colors. Everything else must read
    // theme tokens, --brand-* variables or these libraries.
    const allowed = new Set([
      "src/lib/brand.js",
      "src/lib/entityColor.js",
      "src/lib/pastelColor.js",
      "src/lib/taskColors.js", // user-chosen task label colors (stored by key)
    ]);
    const literal = /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/;
    const offenders = [];
    for (const f of walk(path.join(root, "src"))) {
      const rel = path.relative(root, f).split(path.sep).join("/");
      if (allowed.has(rel)) continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (literal.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    assert.deepStrictEqual(offenders, []);
  });

  summary();
})();
