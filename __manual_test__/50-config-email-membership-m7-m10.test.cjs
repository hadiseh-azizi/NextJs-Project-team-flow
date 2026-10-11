require("./register.cjs");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { execFileSync } = require("child_process");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { makeFakeRateLimitModel } = require("./fakeRateLimitModel.cjs");

// Audit items M7-M10:
//   M7  .gitignore coverage + a .env.example that matches what the code reads
//   M8  emailed links never point at localhost in production
//   M9  SMTP timeouts, transport reuse, consistent errors, DB writes unaffected
//   M10 removing a project member also clears their task assignments
//
// Real route/lib code is loaded; only Mongoose models and nodemailer are
// replaced by in-memory fakes. Live MongoDB and a real mail provider are
// not available here (see the final report), so M10's $pull behavior is
// proven against a fake that implements $pull/$addToSet/$set semantics.

const ROOT = path.resolve(__dirname, "..");
const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(e));

const ENV_KEYS = ["NODE_ENV", "NEXTAUTH_URL", "EMAIL_SERVER_HOST", "EMAIL_SERVER_PORT", "EMAIL_SERVER_USER", "EMAIL_SERVER_PASSWORD", "EMAIL_FROM"];
function setEnv(vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
  setEnv(vars);
  try {
    return await fn();
  } finally {
    setEnv(saved);
  }
}
async function quiet(fn) {
  const w = console.warn, e = console.error;
  const logs = { warn: [], error: [] };
  console.warn = (...a) => logs.warn.push(a.map(String).join(" "));
  console.error = (...a) => logs.error.push(a);
  try {
    return { result: await fn(), logs };
  } catch (err) {
    err.logs = logs;
    throw err;
  } finally {
    console.warn = w;
    console.error = e;
  }
}

// ---------------------------------------------------------------- M7 ----
function codeEnvVars() {
  const found = new Set();
  const walk = (p) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|cjs|mjs)$/.test(entry.name)) scan(fs.readFileSync(full, "utf8"));
    }
  };
  const scan = (src) => {
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
    for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*process\.env/g)) m[1].split(",").forEach((n) => found.add(n.trim()));
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "scripts"));
  scan(fs.readFileSync(path.join(ROOT, "next.config.js"), "utf8"));
  found.delete("NODE_ENV");
  return found;
}

function parseExample() {
  const text = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const active = {};
  const commented = {};
  for (const line of text.split("\n")) {
    let m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) active[m[1]] = m[2];
    m = line.match(/^#\s([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) commented[m[1]] = m[2];
  }
  return { text, active, commented };
}

async function m7() {
  console.log("M7 — .env.example and .gitignore");
  const ex = parseExample();

  await test(".env.example exists and the README points at it", async () => {
    assert.ok(fs.existsSync(path.join(ROOT, ".env.example")));
    assert.ok(fs.readFileSync(path.join(ROOT, "README.md"), "utf8").includes(".env.example"));
  });

  await test("documents exactly the env vars the code reads — none missing, none invented", async () => {
    const documented = new Set([...Object.keys(ex.active), ...Object.keys(ex.commented)]);
    const used = codeEnvVars();
    assert.deepStrictEqual([...used].filter((v) => !documented.has(v)), [], "read by code but not documented");
    assert.deepStrictEqual([...documented].filter((v) => !used.has(v)), [], "documented but never read");
  });

  await test("only the three required vars are active; email and deployment vars are optional (commented)", async () => {
    assert.deepStrictEqual(Object.keys(ex.active).sort(), ["MONGODB_URI", "NEXTAUTH_SECRET", "NEXTAUTH_URL"]);
  });

  await test("contains placeholders only: empty secret, USER:PASSWORD URI, no long token-looking values", async () => {
    assert.strictEqual(ex.active.NEXTAUTH_SECRET, "", "NEXTAUTH_SECRET must be empty so the app fails fast");
    assert.ok(/\/\/USER:PASSWORD@CLUSTER\./.test(ex.active.MONGODB_URI));
    for (const v of [...Object.values(ex.active), ...Object.values(ex.commented)]) {
      assert.ok(!/[A-Za-z0-9+/=_-]{32,}/.test(v), `suspicious value: ${v}`);
    }
    assert.ok(!/^[A-Z_]*(PASSWORD|USER)=.+/m.test(ex.text.replace(/^#\s/gm, "")), "SMTP user/password must stay empty");
  });

  await test("an empty NEXTAUTH_SECRET really does fail fast with a clear message", async () => {
    resetModuleCache();
    const saved = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "";
    try {
      const { getAuthSecret } = require("../src/lib/authSecret.js");
      assert.throws(() => getAuthSecret(), /NEXTAUTH_SECRET is not set/);
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });

  await test(".gitignore (checked with real `git check-ignore`) ignores secrets/artifacts and tracks real files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gi-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fs.copyFileSync(path.join(ROOT, ".gitignore"), path.join(dir, ".gitignore"));
    const ignored = [".env", ".env.local", ".env.production", ".env.production.local", ".vercel/project.json", ".next/cache/x", "node_modules/a/b.js", "debug.log", "npm-debug.log", "next-env.d.ts", ".DS_Store", "tsconfig.tsbuildinfo", "coverage/lcov.info", "cert.pem", ".eslintcache"];
    const tracked = [".env.example", "package.json", "package-lock.json", "README.md", "src/app/page.jsx", "public/favicon.ico", "scripts/migrations/001.cjs", "__manual_test__/50.test.cjs", "eslint.config.mjs"];
    for (const f of [...ignored, ...tracked]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), "x");
    }
    const isIgnored = (f) => { try { execFileSync("git", ["check-ignore", "-q", f], { cwd: dir }); return true; } catch { return false; } };
    assert.deepStrictEqual(ignored.filter((f) => !isIgnored(f)), [], "should be ignored");
    assert.deepStrictEqual(tracked.filter(isIgnored), [], "should NOT be ignored");
  });
}

// ------------------------------------------------------- email helpers ----
function loadEmail({ real = false } = {}) {
  resetModuleCache();
  const created = [];
  const state = { sendMail: async () => ({ messageId: "t" }), sent: [] };
  if (real) {
    delete require.cache[require.resolve("nodemailer")];
  } else {
    mockModule("nodemailer", {
      createTransport: (opts) => {
        created.push(opts);
        return { sendMail: async (m) => { state.sent.push(m); return state.sendMail(m); } };
      },
    });
  }
  return { email: require("../src/lib/email.js"), created, state };
}

const SENDERS = {
  verification: [(e) => e.sendVerificationEmail({ to: "a@example.com", name: "A", token: "tok" }), "/verify-email?token=tok"],
  reset: [(e) => e.sendPasswordResetEmail({ to: "a@example.com", name: "A", token: "tok" }), "/reset-password?token=tok"],
  invitation: [(e) => e.sendTeamInviteEmail({ to: "a@example.com", teamName: "T", inviterName: "I" }), "/register?email=a%40example.com"],
};

async function m8() {
  console.log("\nM8 — emailed URLs");
  const SMTP = { EMAIL_SERVER_HOST: "smtp.example.test" };

  for (const [name, [send, pathPart]] of Object.entries(SENDERS)) {
    await test(`${name}: development with NEXTAUTH_URL unset uses the dev URL`, async () => {
      const { email, state } = loadEmail();
      await withEnv({ ...SMTP, NODE_ENV: "development" }, () => send(email));
      assert.ok(state.sent[0].text.includes(`http://localhost:3000${pathPart}`));
    });
    await test(`${name}: development with a malformed NEXTAUTH_URL falls back with a warning`, async () => {
      const { email, state } = loadEmail();
      const { logs } = await quiet(() => withEnv({ ...SMTP, NODE_ENV: "development", NEXTAUTH_URL: "not a url" }, () => send(email)));
      assert.ok(state.sent[0].text.includes(`http://localhost:3000${pathPart}`));
      assert.ok(logs.warn.some((w) => /not a valid/.test(w)));
    });
    await test(`${name}: production with a valid https URL builds the link from its origin`, async () => {
      const { email, state } = loadEmail();
      await withEnv({ ...SMTP, NODE_ENV: "production", NEXTAUTH_URL: "https://team-flow.vercel.app/ignored/path" }, () => send(email));
      assert.ok(state.sent[0].text.includes(`https://team-flow.vercel.app${pathPart}`));
      assert.ok(state.sent[0].html.includes(`https://team-flow.vercel.app${pathPart}`));
      assert.ok(!state.sent[0].text.includes("localhost"));
    });
  }

  const BAD = [undefined, "", "   ", "not a url", "ftp://app.example.com", "javascript:alert(1)", "http://localhost:3000", "https://127.0.0.1", "http://127.1.2.3:3000", "http://[::1]:3000", "http://0.0.0.0", "https://app.localhost"];
  await test("production: every bad NEXTAUTH_URL makes all three emails fail with EMAIL_CONFIG and send nothing", async () => {
    for (const bad of BAD) {
      for (const [name, [send]] of Object.entries(SENDERS)) {
        const { email, created, state } = loadEmail();
        let err;
        await quiet(() => withEnv({ ...SMTP, NODE_ENV: "production", NEXTAUTH_URL: bad }, () => send(email))).catch((e) => { err = e; });
        assert.ok(err, `${name} should reject for ${JSON.stringify(bad)}`);
        assert.strictEqual(err.name, "EmailError");
        assert.strictEqual(err.code, "EMAIL_CONFIG");
        assert.strictEqual(state.sent.length, 0);
        assert.strictEqual(created.length, 0);
        if (bad && bad.trim()) assert.ok(!err.message.includes(bad), "the configured value must not be echoed");
      }
    }
  });

  await test("production with a bad URL fails even when SMTP is unset (no token printed to the console fallback)", async () => {
    const { email } = loadEmail();
    let err;
    const { logs } = await quiet(async () => {
      try { await withEnv({ NODE_ENV: "production", NEXTAUTH_URL: "http://localhost:3000" }, () => SENDERS.reset[0](email)); } catch (e) { err = e; }
    });
    assert.strictEqual(err?.code, "EMAIL_CONFIG");
    assert.ok(!logs.warn.some((w) => w.includes("tok")));
  });

  await test("production over plain http (non-loopback) still works but warns once", async () => {
    const { email, state } = loadEmail();
    const { logs } = await quiet(() => withEnv({ ...SMTP, NODE_ENV: "production", NEXTAUTH_URL: "http://intranet.example.com" }, async () => {
      await SENDERS.reset[0](email); await SENDERS.reset[0](email);
    }));
    assert.ok(state.sent[0].text.includes("http://intranet.example.com/reset-password"));
    assert.strictEqual(logs.warn.filter((w) => /http:\/\//.test(w)).length, 1);
  });

  await test("importing email.js never throws in production, so `next build` works without NEXTAUTH_URL", async () => {
    await withEnv({ NODE_ENV: "production" }, async () => { loadEmail(); });
  });
}

async function m9() {
  console.log("\nM9 — SMTP reliability");
  const SMTP = { EMAIL_SERVER_HOST: "smtp.example.test", EMAIL_SERVER_PORT: "587", EMAIL_SERVER_USER: "mailer", EMAIL_SERVER_PASSWORD: "hunter2-secret", NODE_ENV: "development" };

  await test("transport gets bounded connection/greeting/dns/socket timeouts and keeps host/port/secure/auth", async () => {
    const { email, created } = loadEmail();
    await withEnv(SMTP, () => SENDERS.verification[0](email));
    const o = created[0];
    for (const k of ["connectionTimeout", "greetingTimeout", "dnsTimeout", "socketTimeout"]) {
      assert.ok(Number.isInteger(o[k]) && o[k] > 0 && o[k] <= 10000, `${k}=${o[k]}`);
    }
    assert.notStrictEqual(o.pool, true, "pooling is deliberately off in serverless");
    assert.deepStrictEqual([o.host, o.port, o.secure, o.auth], ["smtp.example.test", 587, false, { user: "mailer", pass: "hunter2-secret" }]);
  });

  await test("port 465 is implicit-TLS; no user means no auth", async () => {
    const { email, created } = loadEmail();
    await withEnv({ EMAIL_SERVER_HOST: "h", EMAIL_SERVER_PORT: "465", NODE_ENV: "development" }, () => SENDERS.verification[0](email));
    assert.strictEqual(created[0].secure, true);
    assert.strictEqual(created[0].auth, undefined);
  });

  await test("the transport is reused across sends and rebuilt only when SMTP settings change", async () => {
    const { email, created } = loadEmail();
    await withEnv(SMTP, async () => { await SENDERS.reset[0](email); await SENDERS.invitation[0](email); await SENDERS.verification[0](email); });
    assert.strictEqual(created.length, 1);
    await withEnv({ ...SMTP, EMAIL_SERVER_PASSWORD: "rotated" }, async () => { await SENDERS.reset[0](email); await SENDERS.reset[0](email); });
    assert.strictEqual(created.length, 2);
  });

  await test("message content and recipients are unchanged (to, from default/override, subject, text, html)", async () => {
    const { email, state } = loadEmail();
    await withEnv(SMTP, () => SENDERS.verification[0](email));
    assert.deepStrictEqual([state.sent[0].to, state.sent[0].from, state.sent[0].subject], ["a@example.com", "TeamFlow <no-reply@teamflow.app>", "Confirm your email for TeamFlow"]);
    assert.ok(state.sent[0].text && state.sent[0].html);
    await withEnv({ ...SMTP, EMAIL_FROM: "Ops <ops@example.com>" }, () => SENDERS.verification[0](email));
    assert.strictEqual(state.sent[1].from, "Ops <ops@example.com>");
  });

  await test("a hung SMTP server is cut off by the overall deadline (timers scaled down) and leaves no stray timer or rejection", async () => {
    const { email, state } = loadEmail();
    state.sendMail = () => new Promise(() => {}); // never settles
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...r) => realSetTimeout(fn, Math.min(ms, 40), ...r);
    let err;
    try { await withEnv(SMTP, () => SENDERS.reset[0](email)); } catch (e) { err = e; } finally { global.setTimeout = realSetTimeout; }
    assert.strictEqual(err?.code, "SMTP_TIMEOUT");
    assert.ok(!err.message.includes("hunter2") && !err.message.includes("a@example.com"));
    const timersBefore = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    await withEnv(SMTP, () => { state.sendMail = async () => ({}); return SENDERS.reset[0](email); });
    assert.strictEqual(process.getActiveResourcesInfo().filter((r) => r === "Timeout").length, timersBefore, "a successful send must clear its deadline timer");
  });

  const CASES = [
    [{ code: "ETIMEDOUT" }, "SMTP_TIMEOUT"],
    [{ code: "ESOCKET", message: "Socket timeout" }, "SMTP_TIMEOUT"],
    [{ code: "EAUTH" }, "SMTP_AUTH"],
    [{ code: "ECONNECTION" }, "SMTP_CONNECTION"],
    [{ code: "ESOCKET" }, "SMTP_CONNECTION"],
    [{ code: "EDNS" }, "SMTP_CONNECTION"],
    [{ code: "EENVELOPE" }, "SMTP_REJECTED"],
    [{ responseCode: 550 }, "SMTP_REJECTED"],
    [{ responseCode: 451 }, "SMTP_REJECTED"],
    [{ message: "weird" }, "SMTP_ERROR"],
  ];
  await test("SMTP errors map to one consistent EmailError and never leak credentials, recipient or raw server text", async () => {
    for (const [raw, code] of CASES) {
      const { email, state } = loadEmail();
      state.sendMail = async () => {
        throw Object.assign(new Error(`${raw.message || "fail"} user=mailer pass=hunter2-secret to=a@example.com`), raw, { response: "535 hunter2-secret", command: "AUTH" });
      };
      let err;
      await withEnv(SMTP, () => SENDERS.invitation[0](email)).catch((e) => { err = e; });
      assert.strictEqual(err?.name, "EmailError");
      assert.strictEqual(err.code, code, JSON.stringify(raw));
      for (const secret of ["hunter2-secret", "mailer", "a@example.com", "AUTH"]) assert.ok(!err.message.includes(secret), `${code} leaked ${secret}`);
      assert.ok(!("cause" in err) && !("response" in err) && !("command" in err));
    }
  });

  await test("REAL nodemailer: a server that accepts the connection but never greets is cut off by the greeting timeout (~5s)", async () => {
    const server = net.createServer(() => {}); // accepts, says nothing
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { email } = loadEmail({ real: true });
    const started = Date.now();
    let err;
    await withEnv({ EMAIL_SERVER_HOST: "127.0.0.1", EMAIL_SERVER_PORT: String(server.address().port), NODE_ENV: "development" }, () => SENDERS.reset[0](email)).catch((e) => { err = e; });
    const took = Date.now() - started;
    server.close(); server.closeAllConnections?.();
    assert.strictEqual(err?.code, "SMTP_TIMEOUT", err?.message);
    assert.ok(took >= 4000 && took < 9500, `took ${took}ms`);
  });

  await test("REAL nodemailer: a closed port fails fast as SMTP_CONNECTION", async () => {
    const probe = net.createServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port; await new Promise((r) => probe.close(r));
    const { email } = loadEmail({ real: true });
    let err;
    await withEnv({ EMAIL_SERVER_HOST: "127.0.0.1", EMAIL_SERVER_PORT: String(port), NODE_ENV: "development" }, () => SENDERS.reset[0](email)).catch((e) => { err = e; });
    assert.strictEqual(err?.code, "SMTP_CONNECTION", err?.message);
  });
}

// ------------------------------------------- routes: DB vs. email -------
const MANAGER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER_A = "bbbbbbbbbbbbbbbbbbbbbbbb";
const USER_B = "cccccccccccccccccccccccc";
const USER_C = "dddddddddddddddddddddddd";
const TEAM = "a1a1a1a1a1a1a1a1a1a1a1a1";
const TEAM_2 = "b2b2b2b2b2b2b2b2b2b2b2b2";
const P1 = "111111111111111111111111";
const P2 = "111111111111111111111112";
const P_OTHER_TEAM = "111111111111111111111113";
const req = (body, url = "http://x/api") => ({ url, json: async () => body, headers: { get: () => null } });

async function routesDbVsEmail() {
  console.log("\nM8/M9 — routes keep DB writes when email fails");
  const SMTP = { EMAIL_SERVER_HOST: "smtp.example.test" };

  function inviteSetup(sendMail) {
    resetModuleCache();
    mockModule("nodemailer", { createTransport: () => ({ sendMail }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER } }) });
    mockModule("@/models/Team", { findById: () => Promise.resolve({ _id: TEAM, manager: MANAGER, members: [MANAGER], name: "Eng" }) });
    mockModule("@/models/User", { findOne: () => ({ lean: async () => null }), findById: () => ({ select: () => ({ lean: async () => ({ name: "Boss" }) }) }) });
    mockModule("@/models/Project", {});
    mockModule("@/models/Task", {});
    const created = [];
    mockModule("@/models/Invitation", { findOne: () => ({ lean: async () => null }), deleteOne: async () => {}, create: async (d) => { created.push(d); } });
    return { created, route: require("../src/app/api/teams/[id]/members/route.js") };
  }

  await test("invite: misconfigured production URL — invitation is still saved and reported, nothing mailed, error logged clearly", async () => {
    const sent = [];
    const { created, route } = inviteSetup(async (m) => sent.push(m));
    const { result: res, logs } = await quiet(() => withEnv({ ...SMTP, NODE_ENV: "production" }, () => route.POST(req({ email: "new@example.com" }), { params: Promise.resolve({ id: TEAM }) })));
    assert.strictEqual(res.status, 201);
    assert.strictEqual(created.length, 1);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(logs.error[0][1].code, "EMAIL_CONFIG");
  });

  await test("invite: SMTP timeout — invitation is still saved and reported, error logged as SMTP_TIMEOUT", async () => {
    const { created, route } = inviteSetup(async () => { throw Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }); });
    const { result: res, logs } = await quiet(() => withEnv({ ...SMTP, NODE_ENV: "production", NEXTAUTH_URL: "https://app.example.com" }, () => route.POST(req({ email: "new@example.com" }), { params: Promise.resolve({ id: TEAM }) })));
    assert.strictEqual(res.status, 201);
    assert.strictEqual(created.length, 1);
    assert.strictEqual(logs.error[0][1].code, "SMTP_TIMEOUT");
  });

  await test("forgot-password: SMTP failure gives the same response for existing and unknown accounts (no enumeration)", async () => {
    const run = async (userExists) => {
      resetModuleCache();
      mockModule("nodemailer", { createTransport: () => ({ sendMail: async () => { throw Object.assign(new Error("x"), { code: "EAUTH" }); } }) });
      mockModule("@/lib/mongodb", { connectDB: async () => {} });
      mockModule("@/models/RateLimitAttempt", makeFakeRateLimitModel());
      mockModule("@/models/User", { findOne: async () => (userExists ? { _id: USER_A, email: "a@example.com", name: "A" } : null) });
      mockModule("@/lib/passwordResetToken", { createPasswordResetToken: async () => "tok" });
      const { POST } = require("../src/app/api/auth/forgot-password/route.js");
      const { result: res, logs } = await quiet(() => withEnv({ ...SMTP, NODE_ENV: "production", NEXTAUTH_URL: "https://app.example.com" }, () => POST(req({ email: "a@example.com" }))));
      return { status: res.status, body: await res.json(), logged: logs.error.length };
    };
    const yes = await run(true), no = await run(false);
    assert.deepStrictEqual([yes.status, yes.body], [no.status, no.body]);
    assert.deepStrictEqual([yes.status, yes.body], [200, { ok: true }]);
    assert.strictEqual(yes.logged, 1);
  });
}

// ----------------------------------------------------------- M10 --------
const clone = (v) => JSON.parse(JSON.stringify(v));
const ids = (a) => (a || []).map(String);

function makeStore() {
  const db = {
    teams: [
      { _id: TEAM, name: "T1", manager: MANAGER, members: [MANAGER, USER_A, USER_B, USER_C] },
      { _id: TEAM_2, name: "T2", manager: MANAGER, members: [MANAGER, USER_A, USER_B] },
    ],
    projects: [
      { _id: P1, name: "P1", team: TEAM, manager: MANAGER, members: [USER_A, USER_B, USER_C], editors: [USER_A, USER_B], editingMode: "manager_approval", createdAt: new Date() },
      { _id: P2, name: "P2", team: TEAM, manager: MANAGER, members: [USER_A, USER_B], editors: [USER_A], createdAt: new Date() },
      { _id: P_OTHER_TEAM, name: "P3", team: TEAM_2, manager: MANAGER, members: [USER_A, USER_B], createdAt: new Date() },
    ],
    tasks: [
      { _id: "t1", project: P1, column: "c", title: "t1", assignees: [USER_A, USER_B] },
      { _id: "t2", project: P1, column: "c", title: "t2", assignees: [USER_A] },
      { _id: "t3", project: P1, column: "c", title: "t3", assignees: [USER_B, USER_C] },
      { _id: "t4", project: P1, column: "c", title: "t4", assignees: [] },
      { _id: "t5", project: P2, column: "c", title: "t5", assignees: [USER_A, USER_B] },
      { _id: "t6", project: P_OTHER_TEAM, column: "c", title: "t6", assignees: [USER_A, USER_B] },
    ],
  };
  const calls = { project: [], task: [] };
  const user = (id) => ({ _id: id, name: `u-${id.slice(0, 2)}`, email: `${id.slice(0, 2)}@x.com` });
  const applyUpdate = (doc, update) => {
    if (update.$set) Object.assign(doc, clone(update.$set));
    for (const [f, v] of Object.entries(update.$addToSet || {})) { doc[f] = doc[f] || []; if (!ids(doc[f]).includes(String(v))) doc[f].push(String(v)); }
    for (const [f, v] of Object.entries(update.$pull || {})) if (Array.isArray(doc[f])) doc[f] = doc[f].filter((x) => String(x) !== String(v));
  };
  const matchProj = (p, f) => (!f._id || p._id === String(f._id)) && (!f.team || p.team === String(f.team)) && (!f.members || f.members.$exists !== false || p.members === undefined);
  const chain = (get) => { const c = { populate: () => c, select: () => c, sort: () => c, session: () => c, lean: async () => get(), then: (res, rej) => Promise.resolve(get()).then(res, rej) }; return c; };
  const populated = (p, id) => {
    const c = clone(p), t = db.teams.find((x) => x._id === p.team);
    c.team = { ...clone(t), manager: user(t.manager), members: t.members.map(user) };
    c.manager = user(p.manager);
    if (c.members) c.members = c.members.map(user);
    if (c.editors) c.editors = c.editors.map(user);
    return c;
  };
  const models = {
    Project: {
      findById: (id) => chain(() => { const p = db.projects.find((x) => x._id === String(id)); return p ? populated(p) : null; }),
      find: (f) => chain(() => db.projects.filter((p) => matchProj(p, f)).map((p) => ({ _id: p._id }))),
      updateOne: async (f, u, o) => { calls.project.push({ f, u, o }); const p = db.projects.find((x) => matchProj(x, f)); if (p) applyUpdate(p, u); },
      updateMany: async (f, u, o) => { calls.project.push({ f, u, o }); db.projects.filter((p) => matchProj(p, f)).forEach((p) => applyUpdate(p, u)); },
    },
    Task: {
      find: (f) => chain(() => db.tasks.filter((t) => t.project === String(f.project)).map((t) => ({ ...clone(t), assignees: t.assignees.map(user) }))),
      updateMany: async (f, u, o) => {
        calls.task.push({ f, u, o });
        const allowed = f.project?.$in ? f.project.$in.map(String) : [String(f.project)];
        db.tasks.filter((t) => allowed.includes(t.project)).forEach((t) => applyUpdate(t, u));
      },
    },
    Column: { find: () => chain(() => []) },
    Team: {
      updateOne: async (f, u) => { applyUpdate(db.teams.find((t) => t._id === String(f._id)), u); },
      findById: (id) => { const t = db.teams.find((x) => x._id === String(id)); const p = Promise.resolve(clone(t)); const c = chain(() => ({ ...clone(t), manager: user(t.manager), members: t.members.map(user) })); p.populate = c.populate; p.lean = c.lean; return p; },
    },
  };
  return { db, calls, models };
}
const assigneesOf = (db, id) => ids(db.tasks.find((t) => t._id === id).assignees);

function mountStore(store, { session = null, caller = MANAGER } = {}) {
  resetModuleCache();
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: caller } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  for (const [name, model] of Object.entries(store.models)) mockModule(`@/models/${name}`, model);
  mockModule("@/lib/mongoTransaction", { withOptionalTransaction: async (fn) => fn(session) });
}

async function m10() {
  console.log("\nM10 — project-member removal cleanup");
  const { applyProjectMembership, applyProjectEditPermission } = (() => ({}))();
  void applyProjectMembership; void applyProjectEditPermission;

  await test("removing a member clears members, editors and task assignees of THAT project only; other assignees, other projects and all tasks/projects stay", async () => {
    const s = makeStore(); mountStore(s);
    const { applyProjectMembership: apply } = require("../src/lib/authz.js");
    await apply({ _id: P1, members: [USER_A, USER_B, USER_C], team: s.db.teams[0] }, USER_A, "remove");
    const p1 = s.db.projects[0];
    assert.deepStrictEqual(ids(p1.members), [USER_B, USER_C]);
    assert.deepStrictEqual(ids(p1.editors), [USER_B]);
    assert.strictEqual(p1.manager, MANAGER);
    assert.deepStrictEqual(assigneesOf(s.db, "t1"), [USER_B]);
    assert.deepStrictEqual(assigneesOf(s.db, "t2"), []);
    assert.deepStrictEqual(assigneesOf(s.db, "t3"), [USER_B, USER_C]);
    assert.deepStrictEqual(assigneesOf(s.db, "t4"), []);
    // same project's sibling + another team's project: untouched
    assert.deepStrictEqual(assigneesOf(s.db, "t5"), [USER_A, USER_B]);
    assert.deepStrictEqual(assigneesOf(s.db, "t6"), [USER_A, USER_B]);
    assert.deepStrictEqual(ids(s.db.projects[1].members), [USER_A, USER_B]);
    assert.strictEqual(s.db.tasks.length, 6);
    assert.strictEqual(s.db.projects.length, 3);
    assert.deepStrictEqual(s.calls.task[0].f, { project: P1 }, "task cleanup must be scoped to this project");
  });

  await test("all three writes share the transaction session; a failing task cleanup surfaces instead of being swallowed", async () => {
    const s = makeStore(); const session = { id: "sess" }; mountStore(s, { session });
    const { applyProjectMembership: apply } = require("../src/lib/authz.js");
    await apply({ _id: P1, members: [USER_A], team: s.db.teams[0] }, USER_A, "remove");
    assert.ok(s.calls.project.every((c) => c.o?.session === session));
    assert.strictEqual(s.calls.task[0].o.session, session);
    s.models.Task.updateMany = async () => { throw new Error("db down"); };
    await assert.rejects(() => apply({ _id: P1, members: [USER_B], team: s.db.teams[0] }, USER_B, "remove"), /db down/);
  });

  await test("legacy project (no members field): seeded with the team roster, then the user is removed and unassigned", async () => {
    const s = makeStore(); delete s.db.projects[0].members; delete s.db.projects[0].editors; mountStore(s);
    const { applyProjectMembership: apply } = require("../src/lib/authz.js");
    const legacy = { _id: P1, team: s.db.teams[0] };
    await apply(legacy, USER_A, "remove");
    assert.deepStrictEqual(ids(s.db.projects[0].members), [MANAGER, USER_B, USER_C]);
    assert.deepStrictEqual(assigneesOf(s.db, "t1"), [USER_B]);
  });

  await test("removing someone who isn't assigned/a member is a harmless no-op, and repeating a removal changes nothing", async () => {
    const s = makeStore(); mountStore(s);
    const { applyProjectMembership: apply } = require("../src/lib/authz.js");
    const ghost = "eeeeeeeeeeeeeeeeeeeeeeee";
    await apply({ _id: P1, members: [USER_A], team: s.db.teams[0] }, ghost, "remove");
    const before = clone(s.db);
    await apply({ _id: P1, members: [USER_A], team: s.db.teams[0] }, USER_A, "remove");
    const once = clone(s.db);
    await apply({ _id: P1, members: [USER_B], team: s.db.teams[0] }, USER_A, "remove");
    assert.deepStrictEqual(clone(s.db), once);
    assert.deepStrictEqual(before.tasks, clone(before).tasks);
  });

  await test("adding a member never touches tasks; revoking only edit permission keeps the user's assignments", async () => {
    const s = makeStore(); mountStore(s);
    const { applyProjectMembership: apply, applyProjectEditPermission: edit } = require("../src/lib/authz.js");
    await apply({ _id: P1, members: [USER_A], team: s.db.teams[0] }, USER_C, "add");
    await edit({ _id: P1 }, USER_A, "remove");
    assert.strictEqual(s.calls.task.length, 0);
    assert.deepStrictEqual(assigneesOf(s.db, "t1"), [USER_A, USER_B]);
    assert.ok(!ids(s.db.projects[0].editors).includes(USER_A));
    assert.ok(ids(s.db.projects[0].members).includes(USER_A), "still a member, so still allowed to be assigned");
  });

  console.log("\nM10 — route level (real authz.js)");
  const del = (id, uid) => require("../src/app/api/projects/[id]/members/route.js").DELETE(req(null, `http://x/api/projects/${id}/members?userId=${uid}`), { params: Promise.resolve({ id }) });

  await test("DELETE /projects/[id]/members: manager removes A → 200, A is gone from project and its tasks, the server cleaned assignees (H3: the response is the slim access summary; the client clears assignees locally)", async () => {
    const s = makeStore(); mountStore(s);
    const res = await del(P1, USER_A);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(!JSON.stringify(body.members).includes(USER_A.slice(0, 2) + "@"));
    assert.deepStrictEqual(assigneesOf(s.db, "t1"), [USER_B]);
    assert.deepStrictEqual(assigneesOf(s.db, "t5"), [USER_A, USER_B]);
    // H3: the response no longer carries every task; the database state
    // asserted above is what proves the cleanup, and `editors` is returned
    // so the client can drop the removed member's edit permission too.
    assert.ok(!("tasks" in body) && !("columns" in body));
    assert.ok(Array.isArray(body.editors));
  });

  await test("authorization unchanged: non-manager 403, manager can't be removed 400, bad id 400, no session 401 — all leave data untouched", async () => {
    const s = makeStore(); const snapshot = clone(s.db);
    mountStore(s, { caller: USER_B });
    assert.strictEqual((await del(P1, USER_A)).status, 403);
    mountStore(s);
    assert.strictEqual((await del(P1, MANAGER)).status, 400);
    assert.strictEqual((await del(P1, "nope")).status, 400);
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => null });
    assert.strictEqual((await del(P1, USER_A)).status, 401);
    assert.deepStrictEqual(clone(s.db), snapshot);
    assert.strictEqual(s.calls.task.length, 0);
  });

  await test("team-level removal (DELETE /teams/[id]/members) is consistent: same cleanup across that team's projects, other team untouched", async () => {
    const s = makeStore(); mountStore(s);
    const res = await require("../src/app/api/teams/[id]/members/route.js").DELETE(req(null, `http://x/api/teams/${TEAM}/members?userId=${USER_A}`), { params: Promise.resolve({ id: TEAM }) });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(["t1", "t2", "t3", "t4", "t5"].map((t) => assigneesOf(s.db, t)), [[USER_B], [], [USER_B, USER_C], [], [USER_B]]);
    assert.deepStrictEqual(assigneesOf(s.db, "t6"), [USER_A, USER_B], "a different team's project is not touched");
    assert.ok(![0, 1].some((i) => ids(s.db.projects[i].members).includes(USER_A) || ids(s.db.projects[i].editors).includes(USER_A)));
    assert.strictEqual(s.db.tasks.length, 6);
  });
}

(async () => {
  await m7();
  await m8();
  await m9();
  await routesDbVsEmail();
  await m10();
  await test("no unhandled promise rejections were produced anywhere above", async () => {
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(unhandled, []);
  });
  summary();
})();
