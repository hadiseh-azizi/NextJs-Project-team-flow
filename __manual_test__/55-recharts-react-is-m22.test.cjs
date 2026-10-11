// M22 - Recharts / react-is compatibility.
//
// Recharts 2.15.x declares react-is ^18.3.1 and the app runs React 18.3.1.
// An override forcing react-is@19 into Recharts is a real mismatch:
// react-is 19 only recognises React 19 elements ($$typeof
// "react.transitional.element"), so Recharts' isFragment()/isElement()
// checks silently return false for the React 18 elements this app creates.
//
// These checks (1) pin the dependency relationship, (2) show that the
// react-is Recharts actually resolves recognises React 18 elements, and
// (3) render the real src/components/ProgressChart.jsx through real
// Recharts to static markup. Only ResponsiveContainer is stubbed (it
// needs browser layout to measure its parent); everything else is real.
// JSX is compiled with the `typescript` package (already in the lockfile).

require("./register.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { test, summary, assert } = require("./harness.cjs");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const React = require("react");

function resolveFrom(dir, name) {
  return require.resolve(`${name}/package.json`, { paths: [dir] });
}

(async () => {
  await test("package.json no longer overrides react-is for Recharts; React stays on 18", () => {
    const rec = pkg.overrides && pkg.overrides.recharts;
    assert.ok(!rec || !rec["react-is"], "recharts -> react-is override must not force a different major");
    assert.ok(!("react-is" in (pkg.overrides || {})) || /^18\./.test(pkg.overrides["react-is"]));
    assert.match(pkg.dependencies.react, /^18\./);
    assert.match(pkg.dependencies["react-dom"], /^18\./);
  });

  await test("lockfile matches: Recharts' own react-is is the 18.x it declares; MUI keeps its react-is 19 at the top level", () => {
    const recDeclared = lock.packages["node_modules/recharts"].dependencies["react-is"];
    assert.match(recDeclared, /18/);
    const nested = lock.packages["node_modules/recharts/node_modules/react-is"];
    assert.ok(nested, "Recharts must resolve its own nested react-is");
    assert.match(nested.version, /^18\./);
    assert.match(lock.packages["node_modules/react-is"].version, /^19\./, "top-level react-is (needed by @mui/*) is untouched");
    assert.strictEqual(lock.packages[""].dependencies.recharts, pkg.dependencies.recharts);
  });

  await test("the react-is that Recharts resolves at runtime recognises React 18 elements (Fragments included)", () => {
    const recDir = path.dirname(resolveFrom(root, "recharts"));
    const ris = require(path.join(path.dirname(resolveFrom(recDir, "react-is")), "index.js"));
    const el = React.createElement(React.Fragment, null, React.createElement("g"));
    assert.strictEqual(React.version.split(".")[0], "18");
    assert.strictEqual(ris.isElement(el), true);
    assert.strictEqual(ris.isFragment(el), true);
    assert.strictEqual(ris.isFragment(React.createElement("g")), false);
  });

  // ---- render the real component ----
  const ts = require("typescript");
  const SRC = path.join(root, "src");
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) {
      const base = path.join(SRC, request.slice(2));
      for (const ext of ["", ".js", ".jsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    }
    return origResolve.call(this, request, ...rest);
  };
  require.extensions[".jsx"] = function (module, filename) {
    const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(out.outputText, filename);
  };

  // Real recharts, except ResponsiveContainer gets a fixed size.
  const realRecharts = require("recharts");
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "recharts") {
      return {
        ...realRecharts,
        ResponsiveContainer: ({ children }) => React.cloneElement(children, { width: 640, height: 240 }),
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };

  const { renderToStaticMarkup } = require("react-dom/server");
  const { ThemeProvider } = require("@mui/material/styles");
  const { buildTheme } = require("../src/lib/theme.js");
  const ProgressChart = require("../src/components/ProgressChart.jsx").default;

  const task = (completed) => ({ id: String(Math.random()), completed });
  const projects = [
    { id: "p1", name: "Website relaunch", tasks: [task(true), task(true), task(false), task(false)] },
    { id: "p2", name: "A very long project name that will be truncated", tasks: [task(true)] },
    { id: "p3", name: "Empty project", tasks: [] },
  ];

  function render(props, mode = "light") {
    const errors = [];
    const origErr = console.error;
    console.error = (...a) => errors.push(a.map(String).join(" "));
    try {
      const html = renderToStaticMarkup(React.createElement(ThemeProvider, { theme: buildTheme(mode) }, React.createElement(ProgressChart, props)));
      return { html, errors };
    } finally {
      console.error = origErr;
    }
  }

  await test("ProgressChart renders through real Recharts: SVG, a bar series, category labels, the gradient, no React errors", () => {
    const { html, errors } = render({ projects });
    assert.deepStrictEqual(errors, [], "React/Recharts logged errors or warnings while rendering");
    assert.match(html, /<svg[^>]*class="recharts-surface"/);
    assert.match(html, /recharts-bar/);
    assert.match(html, /Website relaunch/);
    assert.match(html, /A very long proje…/, "long names are still truncated");
    assert.match(html, /id="tf-chart-gradient"/);
    assert.match(html, /aria-label="Progress by project\. Website relaunch: 50%/);
  });

  await test("ProgressChart renders in dark mode too, and its empty / malformed inputs behave as before", () => {
    const dark = render({ projects }, "dark");
    assert.deepStrictEqual(dark.errors, []);
    assert.match(dark.html, /recharts-surface/);
    for (const bad of [undefined, [], [null, undefined]]) {
      const r = render({ projects: bad });
      assert.deepStrictEqual(r.errors, []);
      assert.match(r.html, /Progress appears here once you have a project\./);
    }
    const odd = render({ projects: [{ name: 5 }, { tasks: "x" }, { id: "z", name: "Ok", tasks: [task(true)] }] });
    assert.deepStrictEqual(odd.errors, []);
    assert.match(odd.html, /Untitled/);
  });

  await test("the same render under react-is@19 is what the old override produced: it would not recognise React 18 elements", () => {
    const top19 = require(path.join(path.dirname(resolveFrom(root, "react-is")), "index.js"));
    const el = React.createElement(React.Fragment, null);
    if (/^19\./.test(require(resolveFrom(root, "react-is")).version)) {
      assert.strictEqual(top19.isFragment(el), false, "documents why forcing react-is@19 under Recharts was wrong");
    }
  });

  Module._load = origLoad;
  Module._resolveFilename = origResolve;
  summary();
})();
