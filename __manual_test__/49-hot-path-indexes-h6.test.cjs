require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

// Audit issue H6 — indexes on the hot query paths.
//
// Part 1 (always runs, no database): inspects the declared Mongoose schema
// indexes. This proves what the app WILL ASK MongoDB to build; it does not
// prove MongoDB built them.
//
// Part 2 (needs a live mongod): MONGODB_TEST_URI, or a mongod that
// mongodb-memory-server can fetch. Builds the indexes against a throwaway
// database that already holds duplicate-valued and legacy-shaped documents,
// then reads the real index list back. Without a mongod it prints SKIPPED —
// a skipped run is NOT a pass for Part 2.

const load = (name) => {
  const mod = require(`../src/models/${name}.js`);
  return mod.default || mod;
};
const Task = load("Task");
const Project = load("Project");
const Team = load("Team");
const Column = load("Column");

const keyOf = (spec) => JSON.stringify(spec);
const declared = (Model) => Model.schema.indexes().map(([spec, opts]) => ({ spec, opts: opts || {} }));
const find = (Model, spec) => declared(Model).filter((i) => keyOf(i.spec) === keyOf(spec));

// Fields as written in the audit: [Model, key spec]
const REQUIRED = [
  ["Task", Task, { project: 1 }],
  ["Project", Project, { team: 1 }],
  ["Project", Project, { manager: 1 }],
  ["Team", Team, { members: 1 }],
  ["Team", Team, { manager: 1 }],
];

(async () => {
  console.log("required indexes are declared");
  for (const [name, Model, spec] of REQUIRED) {
    await test(`${name}: ${keyOf(spec)} declared exactly once, plain (not unique/sparse/partial/TTL)`, () => {
      const hits = find(Model, spec);
      assert.strictEqual(hits.length, 1, `expected 1, found ${hits.length}`);
      const o = hits[0].opts;
      assert.ok(!o.unique && !o.sparse && !o.partialFilterExpression && o.expireAfterSeconds === undefined, JSON.stringify(o));
    });
  }

  console.log("\nexisting indexes are preserved");
  await test("Task still has { column: 1, order: 1 }", () => {
    assert.strictEqual(find(Task, { column: 1, order: 1 }).length, 1);
  });
  await test("Project.shareToken is still unique + sparse", () => {
    const hits = find(Project, { shareToken: 1 });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].opts.unique, true);
    assert.strictEqual(hits[0].opts.sparse, true);
  });
  await test("Column's unique { project: 1, order: 1 } is untouched", () => {
    const hits = find(Column, { project: 1, order: 1 });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].opts.unique, true);
  });

  console.log("\nno duplicate or redundant indexes");
  for (const [name, Model] of [["Task", Task], ["Project", Project], ["Team", Team]]) {
    await test(`${name}: no repeated key spec`, () => {
      const keys = declared(Model).map((i) => keyOf(i.spec));
      assert.strictEqual(new Set(keys).size, keys.length, keys.join(" | "));
    });
    await test(`${name}: no index is a leading prefix of another (would be redundant)`, () => {
      const lists = declared(Model).map((i) => Object.keys(i.spec));
      for (const a of lists) {
        for (const b of lists) {
          if (a === b || a.length >= b.length) continue;
          assert.ok(!a.every((k, n) => b[n] === k), `${a.join(",")} is a prefix of ${b.join(",")}`);
        }
      }
    });
  }
  await test("no field also carries an inline `index`/`unique` option that would double-declare these", () => {
    for (const [, Model, spec] of REQUIRED) {
      const field = Object.keys(spec)[0];
      const o = Model.schema.path(field).options;
      assert.ok(!o.index && !o.unique && !o.sparse, `${Model.modelName}.${field} has an inline index option`);
    }
  });
  await test("the new Task index is not already served by the compound one (project is not its leading field)", () => {
    assert.notStrictEqual(Object.keys(find(Task, { column: 1, order: 1 })[0].spec)[0], "project");
  });

  console.log("\nlive MongoDB");
  let mongo;
  if (process.env.MONGODB_TEST_URI) mongo = { uri: process.env.MONGODB_TEST_URI, stop: async () => {} };
  else {
    try {
      const { MongoMemoryServer } = require("mongodb-memory-server");
      const server = await Promise.race([
        MongoMemoryServer.create(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out fetching/starting mongod (20s)")), 20000)),
      ]);
      mongo = { uri: server.getUri(), stop: () => server.stop() };
    } catch (err) {
      console.log("  SKIPPED: no live MongoDB available (set MONGODB_TEST_URI, or allow mongodb-memory-server to fetch mongod).");
      console.log(`  reason: ${String(err.message).split("\n")[0]}`);
      console.log("  NOTE: index creation was NOT verified against a real database.");
      summary();
      process.exit(process.exitCode || 0); // an aborted download can leave timers alive
    }
  }

  const mongoose = require("mongoose");
  const dbName = `teamflow_h6_${Math.random().toString(36).slice(2, 10)}`;
  await mongoose.connect(mongo.uri, { dbName });
  try {
    const oid = () => new mongoose.Types.ObjectId();
    const teamId = oid();
    const mgrId = oid();
    const userId = oid();

    // Seed data BEFORE the indexes exist: many docs sharing the same
    // team/manager/project/member ids (so a wrongly-unique index would fail
    // to build), plus legacy-shaped projects with no members/editors field.
    await mongoose.connection.collection("projects").insertMany([
      { name: "p1", manager: mgrId, team: teamId },
      { name: "p2", manager: mgrId, team: teamId },
      { name: "p3", manager: mgrId, team: teamId, members: [] },
    ]);
    await mongoose.connection.collection("teams").insertMany([
      { name: "t1", manager: mgrId, members: [userId] },
      { name: "t2", manager: mgrId, members: [userId, oid()] },
      { name: "t3", manager: mgrId }, // legacy: no members key at all
    ]);
    const projId = oid();
    const colId = oid();
    await mongoose.connection.collection("tasks").insertMany([
      { title: "a", project: projId, column: colId, order: 0 },
      { title: "b", project: projId, column: colId, order: 1 },
    ]);

    for (const [name, Model, collection, wanted] of [
      ["Task", Task, "tasks", [{ project: 1 }, { column: 1, order: 1 }]],
      ["Project", Project, "projects", [{ team: 1 }, { manager: 1 }, { shareToken: 1 }]],
      ["Team", Team, "teams", [{ members: 1 }, { manager: 1 }]],
    ]) {
      await test(`${name}: index build succeeds on pre-existing duplicate-valued/legacy data and the indexes exist`, async () => {
        await Model.init(); // resolves/rejects with the real createIndex results
        const real = await mongoose.connection.collection(collection).indexes();
        for (const spec of wanted) {
          const hit = real.filter((i) => keyOf(i.key) === keyOf(spec));
          assert.strictEqual(hit.length, 1, `${keyOf(spec)} not found on the real collection`);
        }
        const required = REQUIRED.filter(([n]) => n === name);
        for (const [, , spec] of required) {
          const hit = real.find((i) => keyOf(i.key) === keyOf(spec));
          assert.ok(!hit.unique && !hit.sparse, `${keyOf(spec)} unexpectedly unique/sparse`);
        }
      });
    }

    await test("Team.members is multikey: the real planner uses it for { members: userId } and for the $or", async () => {
      const coll = mongoose.connection.collection("teams");
      const stageNames = (plan) => JSON.stringify(plan);
      const eq = await coll.find({ members: userId }).explain("queryPlanner");
      assert.ok(stageNames(eq.queryPlanner.winningPlan).includes("members_1"), "members_1 not used");
      const or = await coll.find({ $or: [{ manager: mgrId }, { members: userId }] }).explain("queryPlanner");
      const plan = stageNames(or.queryPlanner.winningPlan);
      assert.ok(plan.includes("members_1") && plan.includes("manager_1"), "$or did not use both indexes");
    });
    await test("Project list $or and Task { project } use their indexes (plan only; no timing measured)", async () => {
      const p = await mongoose.connection.collection("projects").find({ $or: [{ manager: mgrId }, { team: { $in: [teamId] } }] }).explain("queryPlanner");
      const plan = JSON.stringify(p.queryPlanner.winningPlan);
      assert.ok(plan.includes("manager_1") && plan.includes("team_1"), "$or did not use both indexes");
      const t = await mongoose.connection.collection("tasks").find({ project: { $in: [projId] } }).explain("queryPlanner");
      assert.ok(JSON.stringify(t.queryPlanner.winningPlan).includes("project_1"), "project_1 not used");
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await mongo.stop();
  }

  summary();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
