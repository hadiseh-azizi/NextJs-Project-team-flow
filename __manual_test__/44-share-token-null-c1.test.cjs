require("./register.cjs");
const fs = require("fs");
const path = require("path");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

// Audit issue C1: Project.shareToken must be ABSENT (not null) while a
// project isn't shared, because the unique sparse index on shareToken
// indexes an explicit null and a second null collides (E11000 -> 409).
//
// What this file can and cannot prove (be honest about it):
//   - It uses the REAL Mongoose schema (no database) to prove a new
//     Project no longer carries `shareToken: null`, and checks the declared
//     index definition. It also drives the real share route with a small
//     stateful fake model, and the migration with a fake collection.
//   - It CANNOT prove the MongoDB unique/sparse index behavior. A fake
//     cannot reproduce that, which is exactly why the original bug slipped
//     through. The real-index checks are in
//     45-share-token-live-mongo.test.cjs, which needs a live MongoDB.

const MANAGER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PROJECT_ID = "111111111111111111111111";
const fakeReq = () => ({ headers: { get: () => null } });

function loadRealProjectModel() {
  resetModuleCache();
  const mod = require("../src/models/Project.js");
  return mod.default || mod;
}

(async () => {
  console.log("models/Project.js — real Mongoose schema, no database");

  await test("a new Project does not contain a shareToken key at all (not null)", () => {
    const Project = loadRealProjectModel();
    const doc = new Project({ name: "A", manager: MANAGER_ID, team: MANAGER_ID, members: [] });
    const plain = doc.toObject();
    assert.ok(!Object.prototype.hasOwnProperty.call(plain, "shareToken"), `shareToken present: ${JSON.stringify(plain.shareToken)}`);
    assert.notStrictEqual(plain.shareToken, null);
    assert.strictEqual(plain.shareEnabled, false);
  });

  await test("two new Projects both lack shareToken (nothing for the index to collide on)", () => {
    const Project = loadRealProjectModel();
    const a = new Project({ name: "A", manager: MANAGER_ID, team: MANAGER_ID }).toObject();
    const b = new Project({ name: "B", manager: MANAGER_ID, team: MANAGER_ID }).toObject();
    assert.ok(!("shareToken" in a) && !("shareToken" in b));
  });

  await test("an explicit token is kept as a string", () => {
    const Project = loadRealProjectModel();
    const doc = new Project({ name: "A", manager: MANAGER_ID, team: MANAGER_ID, shareToken: "abc" });
    assert.strictEqual(doc.toObject().shareToken, "abc");
  });

  await test("regression guard: the old `default: null` schema is what stored null", () => {
    const { Schema, model } = require("mongoose");
    const Old = model("OldProjectShape", new Schema({ shareToken: { type: String, default: null } }));
    assert.strictEqual(new Old({}).toObject().shareToken, null);
  });

  await test("index definition is still unique + sparse on { shareToken: 1 } and there is only one", () => {
    const Project = loadRealProjectModel();
    const onToken = Project.schema.indexes().filter(([keys]) => "shareToken" in keys);
    assert.strictEqual(onToken.length, 1);
    const [[keys, opts]] = onToken;
    assert.deepStrictEqual(keys, { shareToken: 1 });
    assert.strictEqual(opts.unique, true);
    assert.strictEqual(opts.sparse, true);
    assert.ok(!opts.partialFilterExpression);
  });

  // ------------------------------------------------------------------
  console.log("\nsource scan — nothing re-introduces a null shareToken");

  await test("no non-comment line in src/ or scripts/ assigns shareToken to null", () => {
    const root = path.resolve(__dirname, "..");
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|jsx|cjs|mjs)$/.test(entry.name)) {
          fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
            const t = line.trim();
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
            if (/shareToken["']?\s*:\s*null\b/.test(line)) offenders.push(`${path.relative(root, full)}:${i + 1}: ${t}`);
          });
        }
      }
    };
    walk(path.join(root, "src"));
    walk(path.join(root, "scripts"));
    assert.deepStrictEqual(offenders, []);
  });

  // ------------------------------------------------------------------
  console.log("\n/api/projects/[id]/share — enable / disable / re-enable (stateful fake model)");

  function setupShareRoute(initial) {
    resetModuleCache();
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: MANAGER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const store = { _id: PROJECT_ID, manager: MANAGER_ID, shareEnabled: false, ...initial };
    const updates = [];
    mockModule("@/models/Project", {
      findById: () => ({ lean: async () => ({ ...store }) }),
      updateOne: async (_filter, update) => {
        updates.push(update);
        Object.assign(store, update.$set || {});
        for (const k of Object.keys(update.$unset || {})) delete store[k];
      },
    });
    const route = require("../src/app/api/projects/[id]/share/route.js");
    return { route, store, updates };
  }
  const ctx = { params: Promise.resolve({ id: PROJECT_ID }) };

  await test("enable stores a non-empty string token", async () => {
    const { route, store } = setupShareRoute();
    const res = await route.POST(fakeReq(), ctx);
    assert.strictEqual(res.status, 200);
    assert.ok(typeof store.shareToken === "string" && store.shareToken.length >= 32);
    assert.strictEqual(store.shareEnabled, true);
  });

  await test("disable removes the field ($unset) and never writes null", async () => {
    const { route, store, updates } = setupShareRoute({ shareEnabled: true, shareToken: "live-token" });
    const res = await route.DELETE(fakeReq(), ctx);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(updates[0], { $set: { shareEnabled: false }, $unset: { shareToken: "" } });
    assert.ok(!("shareToken" in store), "shareToken key should be gone, not null");
    assert.ok(!JSON.stringify(updates).includes("null"));
  });

  await test("enable -> disable -> enable yields a fresh, different valid token", async () => {
    const { route, store } = setupShareRoute();
    await route.POST(fakeReq(), ctx);
    const first = store.shareToken;
    await route.DELETE(fakeReq(), ctx);
    assert.ok(!("shareToken" in store));
    const res = await route.POST(fakeReq(), ctx);
    assert.strictEqual(res.status, 200);
    assert.ok(typeof store.shareToken === "string" && store.shareToken.length >= 32);
    assert.notStrictEqual(store.shareToken, first);
  });

  await test("a project with no shareToken field reports sharing off with a null URL", async () => {
    const { route } = setupShareRoute();
    const json = await (await route.GET(fakeReq(), ctx)).json();
    assert.deepStrictEqual(json, { shareEnabled: false, shareUrl: null });
  });

  // ------------------------------------------------------------------
  console.log("\nscripts/migrations/001-unset-null-share-token.cjs — against a fake collection");

  // Mirrors MongoDB semantics for the two filters the script uses:
  // $type "null" matches ONLY an explicit null (not a missing field),
  // $type "string" matches only strings.
  function fakeCollection(docs) {
    const typeOf = (d) => (!("shareToken" in d) ? "missing" : d.shareToken === null ? "null" : typeof d.shareToken);
    const matching = (f) => docs.filter((d) => typeOf(d) === f.shareToken.$type);
    const writes = [];
    return {
      docs,
      writes,
      countDocuments: async (f) => matching(f).length,
      updateMany: async (f, u) => {
        writes.push({ f, u });
        const hits = matching(f);
        hits.forEach((d) => { for (const k of Object.keys(u.$unset)) delete d[k]; });
        return { modifiedCount: hits.length };
      },
      indexes: async () => [{ key: { shareToken: 1 }, name: "shareToken_1", unique: true, sparse: true }],
    };
  }
  const { migrate } = require("../scripts/migrations/001-unset-null-share-token.cjs");
  const seed = () => [
    { _id: 1, name: "legacy", shareToken: null },
    { _id: 2, name: "never shared" },
    { _id: 3, name: "shared", shareToken: "valid-token-1" },
    { _id: 4, name: "shared too", shareToken: "valid-token-2" },
  ];

  await test("dry run reports but writes nothing", async () => {
    const c = fakeCollection(seed());
    const r = await migrate(c, { apply: false });
    assert.strictEqual(r.nullBefore, 1);
    assert.strictEqual(c.writes.length, 0);
    assert.strictEqual(c.docs[0].shareToken, null);
    assert.ok(r.ok);
  });

  await test("--apply unsets null only; missing and valid tokens are untouched", async () => {
    const c = fakeCollection(seed());
    const r = await migrate(c, { apply: true });
    assert.strictEqual(r.modified, 1);
    assert.strictEqual(r.nullAfter, 0);
    assert.ok(!("shareToken" in c.docs[0]));
    assert.ok(!("shareToken" in c.docs[1]));
    assert.strictEqual(c.docs[2].shareToken, "valid-token-1");
    assert.strictEqual(c.docs[3].shareToken, "valid-token-2");
    assert.strictEqual(r.stringBefore, r.stringAfter);
    assert.deepStrictEqual(c.writes[0], { f: { shareToken: { $type: "null" } }, u: { $unset: { shareToken: "" } } });
    assert.ok(r.ok && r.index.ok);
  });

  await test("idempotent: a second run modifies nothing and issues no write", async () => {
    const c = fakeCollection(seed());
    await migrate(c, { apply: true });
    c.writes.length = 0;
    const r = await migrate(c, { apply: true });
    assert.strictEqual(r.modified, 0);
    assert.strictEqual(c.writes.length, 0);
    assert.ok(r.ok);
  });

  await test("flags a non-unique/non-sparse shareToken index without touching it", async () => {
    const c = fakeCollection(seed());
    c.indexes = async () => [{ key: { shareToken: 1 }, name: "shareToken_1", unique: true }];
    const r = await migrate(c, { apply: false });
    assert.strictEqual(r.index.ok, false);
  });

  summary();
})();
