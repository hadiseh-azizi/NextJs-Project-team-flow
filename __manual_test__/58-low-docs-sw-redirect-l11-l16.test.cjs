require("./register.cjs");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// L11-L16 (Low-priority maintenance fixes). Real source files are loaded;
// no browser is involved here (the service worker runs in a vm with a small
// in-memory Cache Storage, and layout/style behavior is checked at the source
// and generated-CSS level). Real-browser checks for L12/L15 were run
// separately and are described in the session report, not in this file.

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(rel, out);
    } else out.push(rel);
  }
  return out;
}

(async () => {
  // ---------------------------------------------------------------- L11
  console.log("L11 - documentation references");

  await test("every UPPER_CASE .md document mentioned in source, tests, scripts and READMEs exists", () => {
    const files = [...walk("src"), ...walk("__manual_test__"), ...walk("scripts"), "README.md", "next.config.js", "eslint.config.mjs"].filter((f) =>
      /\.(js|jsx|cjs|mjs|md)$/.test(f)
    );
    const missing = [];
    for (const f of files) {
      const text = read(f);
      for (const m of text.matchAll(/(?<![\w./-])([A-Z][A-Z0-9_]*\.md)\b/g)) {
        const name = m[1];
        if (name === "SIZES.md") continue; // a JS property (TeamFlowBrand.jsx), not a document
        // README.md is checked next to the file that mentions it or at the root.
        const candidates = [path.join(path.dirname(f), name), name];
        if (!candidates.some((c) => fs.existsSync(path.join(ROOT, c)))) missing.push(`${f}: ${name}`);
      }
    }
    assert.deepStrictEqual(missing, []);
  });

  await test("the test README has no leftover phase title and no history-only notes", () => {
    const readme = read("__manual_test__/README.md");
    assert.ok(!/Phase 2/.test(readme));
    assert.ok(!/missing from this\s+README's run list/.test(readme));
  });

  await test("the test README documents the files it points at", () => {
    const readme = read("__manual_test__/README.md");
    const onDisk = new Set(fs.readdirSync(path.join(ROOT, "__manual_test__")));
    for (const m of readme.matchAll(/`(\d+-[\w-]+\.test\.cjs)`/g)) assert.ok(onDisk.has(m[1]), `README names ${m[1]} but it does not exist`);
    assert.ok(readme.includes("58-low-docs-sw-redirect-l11-l16.test.cjs"));
  });

  // ---------------------------------------------------------------- L12
  console.log("\nL12 - service worker cache");

  // A minimal Cache Storage: insertion-ordered, `put` of an existing key
  // moves it to the end (as the spec's delete-then-append does).
  function makeCaches() {
    const stores = new Map();
    const open = async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        put: async (req, res) => {
          const key = typeof req === "string" ? req : req.url;
          m.delete(key);
          m.set(key, res);
        },
        keys: async () => [...m.keys()].map((url) => ({ url })),
        delete: async (req) => m.delete(typeof req === "string" ? req : req.url),
      };
    };
    return {
      stores,
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (req) => {
        for (const m of stores.values()) {
          const hit = m.get(req.url);
          if (hit) return hit.clone();
        }
        return undefined;
      },
    };
  }

  function loadSw(scriptUrl, { fetchImpl, caches } = {}) {
    const listeners = {};
    let claimed = false;
    let skipped = false;
    const self = {
      location: { href: scriptUrl, origin: new URL(scriptUrl).origin },
      addEventListener: (type, fn) => (listeners[type] = fn),
      skipWaiting: () => (skipped = true),
      clients: { claim: async () => (claimed = true) },
    };
    const ctx = vm.createContext({ self, caches: caches || makeCaches(), fetch: fetchImpl || (async () => new Response("ok")), URL, Response, Promise, console });
    vm.runInContext(read("public/sw.js"), ctx);
    return { listeners, ctx, state: () => ({ claimed, skipped }) };
  }

  function fetchEvent(url, method = "GET") {
    const waits = [];
    const ev = {
      request: { url, method },
      responded: null,
      respondWith(p) {
        ev.responded = p;
      },
      waitUntil(p) {
        waits.push(p);
      },
    };
    return { ev, settle: () => Promise.all(waits) };
  }

  const ORIGIN = "https://app.example.com";

  await test("the cache is named after the build id in the worker URL; a missing or odd id falls back to 'dev'", async () => {
    for (const [url, expected] of [
      [`${ORIGIN}/sw.js?v=abc123`, "teamflow-shared-shell-abc123"],
      [`${ORIGIN}/sw.js`, "teamflow-shared-shell-dev"],
      [`${ORIGIN}/sw.js?v=${encodeURIComponent("../x y")}`, "teamflow-shared-shell-dev"],
    ]) {
      const caches = makeCaches();
      const sw = loadSw(url, { caches });
      const { ev, settle } = fetchEvent(`${ORIGIN}/_next/static/chunks/a.js`);
      sw.listeners.fetch(ev);
      await ev.responded;
      await settle();
      assert.deepStrictEqual([...caches.stores.keys()], [expected], url);
    }
  });

  await test("activate removes caches from other builds only, keeps the current one and unrelated caches", async () => {
    const caches = makeCaches();
    await caches.open("teamflow-shared-shell-old1");
    await caches.open("teamflow-shared-shell-v1");
    await caches.open("teamflow-shared-shell-new");
    await caches.open("teamflow-shared-board-data-v1"); // board data cache: not this worker's
    await caches.open("someone-elses-cache");
    const sw = loadSw(`${ORIGIN}/sw.js?v=new`, { caches });
    let done;
    sw.listeners.activate({ waitUntil: (p) => (done = p) });
    await done;
    assert.deepStrictEqual([...caches.stores.keys()].sort(), ["someone-elses-cache", "teamflow-shared-board-data-v1", "teamflow-shared-shell-new"]);
    assert.strictEqual(sw.state().claimed, true);
  });

  await test("install still activates immediately", () => {
    const sw = loadSw(`${ORIGIN}/sw.js?v=1`);
    sw.listeners.install({});
    assert.strictEqual(sw.state().skipped, true);
  });

  await test("only the shared board, its build assets and the favicon are handled", async () => {
    const handled = [`${ORIGIN}/shared/board/tok`, `${ORIGIN}/shared/board/tok?_rsc=1`, `${ORIGIN}/_next/static/css/a.css`, `${ORIGIN}/favicon.ico`];
    const ignored = [
      `${ORIGIN}/_next/image?url=%2Fa.png&w=64&q=75`,
      `${ORIGIN}/_next/data/x/y.json`,
      `${ORIGIN}/api/shared/board/tok`,
      `${ORIGIN}/api/projects`,
      `${ORIGIN}/dashboard`,
      `${ORIGIN}/login`,
      "https://cdn.example.net/_next/static/a.js",
    ];
    const sw = loadSw(`${ORIGIN}/sw.js?v=1`);
    for (const u of handled) {
      const { ev } = fetchEvent(u);
      sw.listeners.fetch(ev);
      assert.ok(ev.responded, `expected ${u} to be handled`);
      await ev.responded;
    }
    for (const u of ignored) {
      const { ev } = fetchEvent(u);
      sw.listeners.fetch(ev);
      assert.strictEqual(ev.responded, null, `expected ${u} to be left alone`);
    }
    const { ev } = fetchEvent(`${ORIGIN}/shared/board/tok`, "POST");
    sw.listeners.fetch(ev);
    assert.strictEqual(ev.responded, null, "non-GET is never intercepted");
  });

  await test("network-first: a good response is returned and stored; offline falls back to the stored copy", async () => {
    let online = true;
    const caches = makeCaches();
    const sw = loadSw(`${ORIGIN}/sw.js?v=1`, {
      caches,
      fetchImpl: async () => {
        if (!online) throw new TypeError("offline");
        return new Response("fresh", { status: 200 });
      },
    });
    const url = `${ORIGIN}/shared/board/tok`;
    let { ev, settle } = fetchEvent(url);
    sw.listeners.fetch(ev);
    assert.strictEqual(await (await ev.responded).text(), "fresh");
    await settle();
    online = false;
    ({ ev } = fetchEvent(url));
    sw.listeners.fetch(ev);
    assert.strictEqual(await (await ev.responded).text(), "fresh", "served from the cache while offline");
  });

  await test("an error response is not stored, and the network response is still returned", async () => {
    const caches = makeCaches();
    const sw = loadSw(`${ORIGIN}/sw.js?v=1`, { caches, fetchImpl: async () => new Response("nope", { status: 404 }) });
    const { ev, settle } = fetchEvent(`${ORIGIN}/shared/board/tok`);
    sw.listeners.fetch(ev);
    assert.strictEqual((await ev.responded).status, 404);
    await settle();
    assert.strictEqual([...caches.stores.values()].reduce((n, m) => n + m.size, 0), 0);
  });

  await test("the cache is capped: the oldest entries are dropped first", async () => {
    const caches = makeCaches();
    const sw = loadSw(`${ORIGIN}/sw.js?v=1`, { caches });
    for (let i = 0; i < 130; i++) {
      const { ev, settle } = fetchEvent(`${ORIGIN}/_next/static/chunks/c${i}.js`);
      sw.listeners.fetch(ev);
      await ev.responded;
      await settle();
    }
    const store = caches.stores.get("teamflow-shared-shell-1");
    assert.strictEqual(store.size, 120);
    assert.ok(!store.has(`${ORIGIN}/_next/static/chunks/c0.js`));
    assert.ok(store.has(`${ORIGIN}/_next/static/chunks/c129.js`));
  });

  await test("the page registers the worker with the build id and next.config.js supplies one per build", () => {
    const page = read("src/app/shared/board/[token]/page.jsx");
    assert.ok(/register\(`\/sw\.js\?v=\$\{buildId\}`/.test(page));
    assert.ok(page.includes("NEXT_PUBLIC_BUILD_ID"));
    assert.ok(page.includes('updateViaCache: "none"'));

    const keep = { a: process.env.NEXT_PUBLIC_BUILD_ID, b: process.env.VERCEL_GIT_COMMIT_SHA };
    try {
      delete process.env.NEXT_PUBLIC_BUILD_ID;
      process.env.VERCEL_GIT_COMMIT_SHA = "deadbeef1234";
      delete require.cache[require.resolve("../next.config.js")];
      assert.strictEqual(require("../next.config.js").env.NEXT_PUBLIC_BUILD_ID, "deadbeef1234");

      delete process.env.NEXT_PUBLIC_BUILD_ID;
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete require.cache[require.resolve("../next.config.js")];
      const fallback = require("../next.config.js").env.NEXT_PUBLIC_BUILD_ID;
      assert.ok(/^[\w.-]{1,64}$/.test(fallback), fallback);
      // A second load in the same process (a build worker) agrees with the first.
      delete require.cache[require.resolve("../next.config.js")];
      assert.strictEqual(require("../next.config.js").env.NEXT_PUBLIC_BUILD_ID, fallback);
    } finally {
      for (const [k, v] of [["NEXT_PUBLIC_BUILD_ID", keep.a], ["VERCEL_GIT_COMMIT_SHA", keep.b]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      delete require.cache[require.resolve("../next.config.js")];
    }
  });

  // ---------------------------------------------------------------- L13
  console.log("\nL13 - redirect signed-in users away from login/register");

  function loadRedirectHelper(session) {
    resetModuleCache();
    const calls = { redirects: [] };
    mockModule("next-auth", { getServerSession: async () => session });
    mockModule("next/navigation", {
      redirect: (to) => {
        calls.redirects.push(to);
        const err = new Error("NEXT_REDIRECT");
        err.digest = `NEXT_REDIRECT;replace;${to}`;
        throw err;
      },
    });
    mockModule("@/lib/auth", { authOptions: {} });
    return { ...require("../src/lib/redirectIfSignedIn.js"), calls };
  }

  await test("a signed-in user is redirected to /dashboard", async () => {
    const h = loadRedirectHelper({ user: { id: "u1", name: "Ada" } });
    await assert.rejects(() => h.redirectIfSignedIn(), /NEXT_REDIRECT/);
    assert.deepStrictEqual(h.calls.redirects, ["/dashboard"]);
  });

  await test("no session, or a session without a user, renders the page unchanged (no redirect)", async () => {
    for (const session of [null, undefined, {}, { user: null }]) {
      const h = loadRedirectHelper(session);
      await h.redirectIfSignedIn();
      assert.deepStrictEqual(h.calls.redirects, [], JSON.stringify(session));
    }
  });

  await test("login and register layouts call it before rendering, and use no client-side session state", () => {
    for (const rel of ["src/app/login/layout.jsx", "src/app/register/layout.jsx"]) {
      const src = read(rel);
      assert.ok(/export default async function Layout/.test(src), rel);
      assert.ok(/await redirectIfSignedIn\(\);\s*return children;/.test(src), rel);
      assert.ok(!/useSession|"use client"/.test(src), rel);
      assert.ok(/export const metadata = \{ title: "(Sign In|Sign Up)" \}/.test(src), `${rel} keeps its page title`);
    }
  });

  await test("no loop: the redirect target is the dashboard, whose layout sends signed-out users to /login using the same check", () => {
    const helper = read("src/lib/redirectIfSignedIn.js");
    const dash = read("src/app/dashboard/layout.jsx");
    assert.ok(helper.includes("session?.user"));
    assert.ok(dash.includes("!session?.user") && dash.includes('redirect("/login")'));
    assert.ok(fs.existsSync(path.join(ROOT, "src/app/dashboard/page.jsx")));
    assert.ok(read("src/app/login/page.jsx").includes('router.push("/dashboard")'), "post-login destination unchanged");
  });

  // ---------------------------------------------------------------- L14
  console.log("\nL14 - Content-Disposition filename*");

  resetModuleCache();
  const { buildContentDisposition, encodeRfc5987 } = require("../src/lib/attachmentPolicy.js");
  const ATTR_VALUE = /^UTF-8''(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})+$/;

  function parts(header) {
    const m = header.match(/^attachment; filename="([^"]*)"; filename\*=(.+)$/);
    assert.ok(m, `unexpected header shape: ${header}`);
    return { fallback: m[1], star: m[2] };
  }

  await test("', (, ) and * are percent-encoded; nothing outside RFC 5987 attr-char is left literal", () => {
    assert.strictEqual(encodeRfc5987("a'b(c)d*e.txt"), "a%27b%28c%29d%2Ae.txt");
    for (const name of ["it's (final) *draft*.pdf", "'''.txt", "((()))***.csv", "a b+c&d=e,f;g@h.txt"]) {
      const { star } = parts(buildContentDisposition(name));
      assert.ok(ATTR_VALUE.test(star), star);
      assert.ok(!/['()*]/.test(star.slice("UTF-8''".length)), star);
    }
  });

  await test("Unicode, spaces and ordinary punctuation round-trip exactly", () => {
    for (const name of ["résumé 简历 🚀 (v2).pdf", "Привет мир.txt", "報告書_最終版.docx", "my file - copy [1] {x} #2 & more! ~tilde ^caret `tick` |bar|.txt", "a.b.c.tar.gz", "100% done.pdf", "file name  with   spaces.txt"]) {
      const { star } = parts(buildContentDisposition(name));
      assert.ok(ATTR_VALUE.test(star), star);
      assert.strictEqual(decodeURIComponent(star.slice("UTF-8''".length)), name);
    }
    assert.ok(parts(buildContentDisposition("a b.txt")).star.endsWith("a%20b.txt"));
  });

  await test("the ASCII fallback is printable ASCII, one underscore per non-ASCII character, never a quote or backslash", () => {
    assert.strictEqual(parts(buildContentDisposition("résumé 🚀.pdf")).fallback, "r_sum_ _.pdf");
    const hostile = buildContentDisposition('a"b\\c.txt');
    assert.strictEqual(parts(hostile).fallback, "a_b_c.txt");
    for (const name of ["x\r\nSet-Cookie: a=b.txt", "tab\there.txt", "nul\u0000.txt"]) {
      const h = buildContentDisposition(name);
      assert.ok(!/[\r\n\u0000\t]/.test(h), JSON.stringify(h));
      assert.ok(/^[\x20-\x7e]*$/.test(h), JSON.stringify(h));
    }
    assert.strictEqual(parts(buildContentDisposition("")).fallback, "file");
  });

  await test("a lone surrogate no longer throws; it is encoded as U+FFFD", () => {
    assert.doesNotThrow(() => buildContentDisposition("bad\ud800name.txt"));
    assert.strictEqual(encodeRfc5987("a\ud800b"), "a%EF%BF%BDb");
    assert.strictEqual(encodeRfc5987("a\udc00b"), "a%EF%BF%BDb");
    assert.strictEqual(encodeRfc5987("ok😀"), "ok%F0%9F%98%80", "a valid surrogate pair is untouched");
  });

  await test("the download route still builds its header through buildContentDisposition", () => {
    const route = read("src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    assert.ok(route.includes("buildContentDisposition(attachment.filename)"));
  });

  // ---------------------------------------------------------------- L15
  console.log("\nL15 - container-query unit fallback");

  resetModuleCache();
  const { columnContentWidthSx } = require("../src/lib/columnWidth.js");

  await test("the base width has no cqw (so it survives browsers without them); cqw only inside @supports", () => {
    assert.deepStrictEqual(columnContentWidthSx.width, { xs: "100%", sm: 288 });
    const supports = columnContentWidthSx["@supports (width: 1cqw)"];
    assert.deepStrictEqual(supports.width, { xs: "84cqw", sm: 288 });
    assert.ok(!JSON.stringify({ width: columnContentWidthSx.width }).includes("cqw"));
  });

  await test("board and skeleton use the shared fragment instead of a bare 84cqw", () => {
    for (const rel of ["src/components/KanbanBoard.jsx", "src/components/KanbanBoardSkeleton.jsx"]) {
      const src = read(rel);
      assert.ok(!/"84cqw"/.test(src), `${rel} still has a bare 84cqw`);
      assert.ok(src.includes("...columnContentWidthSx"), rel);
    }
    assert.ok(/containerType: "inline-size"/.test(read("src/components/KanbanBoard.jsx")), "board is still the inline-size container");
    assert.ok(/flex: collapsed \? `0 0 \$\{COLLAPSED_COLUMN_WIDTH\}px` : \{ xs: "0 0 84%", sm: "0 0 288px" \}/.test(read("src/components/KanbanBoard.jsx")), "column flex-basis unchanged");
  });

  await test("the generated CSS has a plain-width fallback and an @supports block holding the cqw widths", () => {
    const React = require("react");
    const { renderToString } = require("react-dom/server");
    const { Box } = require("@mui/material");
    const html = renderToString(React.createElement(Box, { sx: { ...columnContentWidthSx, boxSizing: "border-box", p: 1 } }));
    const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    assert.ok(/width:100%/.test(css), css);
    assert.ok(/@supports \(width: ?1cqw\)/.test(css), css);
    const supportsAt = css.search(/@supports/);
    assert.ok(supportsAt > css.search(/width:100%/), "fallback comes before the upgrade so the upgrade wins where supported");
    assert.ok(/84cqw/.test(css.slice(supportsAt)), "84cqw only after @supports");
    assert.ok(!/84cqw/.test(css.slice(0, supportsAt)), "no bare cqw before @supports");
  });

  // ---------------------------------------------------------------- L16
  console.log("\nL16 - separate deleting state in KanbanBoard");

  const board = read("src/components/KanbanBoard.jsx");

  await test("there is no shared `deleting` flag any more; task and column each have their own", () => {
    assert.ok(!/\bsetDeleting\b/.test(board));
    assert.ok(!/\bdeleting\b(?!Task|Column)/.test(board.replace(/\/\/.*$/gm, "")), "no bare `deleting` identifier");
    assert.strictEqual((board.match(/const \[deletingTask, setDeletingTask\] = useState\(false\)/g) || []).length, 1);
    assert.strictEqual((board.match(/const \[deletingColumn, setDeletingColumn\] = useState\(false\)/g) || []).length, 1);
  });

  function fnBody(name) {
    const start = board.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, name);
    const next = board.indexOf("\n  async function ", start + 10);
    const alt = board.indexOf("\n  // A project with no columns yet", start);
    const end = [next, alt].filter((n) => n > 0).sort((a, b) => a - b)[0];
    return board.slice(start, end);
  }

  await test("confirmTaskDelete only reads and writes the task flag", () => {
    const body = fnBody("confirmTaskDelete");
    assert.ok(/if \(!confirmDeleteTask \|\| deletingTask\) return;/.test(body));
    assert.ok(body.includes("setDeletingTask(true)") && body.includes("setDeletingTask(false)"));
    assert.ok(!/Column\b.*deleting|deletingColumn|setDeletingColumn/.test(body));
  });

  await test("confirmColumnDelete only reads and writes the column flag", () => {
    const body = fnBody("confirmColumnDelete");
    assert.ok(/if \(!confirmDeleteColumn \|\| deletingColumn\) return;/.test(body));
    assert.ok(body.includes("setDeletingColumn(true)") && body.includes("setDeletingColumn(false)"));
    assert.ok(!/deletingTask|setDeletingTask/.test(body));
  });

  await test("each confirmation dialog is bound to its own flag; dialogs, titles, messages and errors are unchanged", () => {
    const task = board.match(/<ConfirmDialog\s+open=\{!!confirmDeleteTask\}[\s\S]*?\/>/)[0];
    const column = board.match(/<ConfirmDialog\s+open=\{!!confirmDeleteColumn\}[\s\S]*?\/>/)[0];
    assert.ok(task.includes("loading={deletingTask}") && task.includes("error={deleteTaskError}") && task.includes('title="Delete task"'));
    assert.ok(column.includes("loading={deletingColumn}") && column.includes("error={deleteColumnError}") && column.includes('title="Delete column"'));
    assert.ok(!task.includes("deletingColumn") && !column.includes("deletingTask"));
  });

  summary();
})();
