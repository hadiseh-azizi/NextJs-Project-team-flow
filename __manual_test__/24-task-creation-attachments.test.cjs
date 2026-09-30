// Manual tests for attaching files during task creation (additive feature
// on top of the existing post-creation attachment workflow — see
// __manual_test__/14-attachment-security.test.cjs for that route's own
// coverage, which is untouched by this feature).
//
// POST /api/tasks now accepts two request shapes:
//   1. A plain JSON body (the original shape) — still the only shape the
//      rest of the manual-test harness uses (05-task-create-transaction,
//      13-column-task-race, 15/17 audits, etc.), so those are the
//      regression check that this feature didn't disturb the existing
//      path.
//   2. A multipart/form-data body with a "data" field (the same JSON
//      payload, stringified) plus zero or more "files" parts — used only
//      when the client is attaching files at creation time.
//
// These tests exercise shape 2: field validation still runs the same way,
// per-file and running-total/count limits are enforced before the task is
// created, a mislabeled/oversized file rejects the whole request (no task
// is left behind), and a task created with valid files has them embedded
// immediately — all without touching the post-creation attachment route.

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const { MAX_FILE_SIZE, MAX_TOTAL_ATTACHMENTS_SIZE, MAX_ATTACHMENTS_PER_TASK } = require("../src/lib/attachmentPolicy.js");

const PROJECT_ID = "111111111111111111111111";
const COLUMN_ID = "222222222222222222222222";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngBytes(extraBytes = 50) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extraBytes, 1)]);
}

function fakeFile({ name, type = "image/png", bytes }) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Mirrors the multipart shape the frontend sends: a "data" field holding
// the JSON task payload, and zero or more "files" entries.
function fakeMultipartReq(fields, files = []) {
  return {
    headers: new Headers({ "content-type": "multipart/form-data; boundary=x" }),
    body: null,
    formData: async () => ({
      get: (key) => (key === "data" ? JSON.stringify(fields) : null),
      getAll: (key) => (key === "files" ? files : []),
    }),
  };
}

function fakeJsonReq(body) {
  return { json: async () => body };
}

function makeFakeTaskWorld(initialTasks = []) {
  const committed = new Map(initialTasks.map((t) => [t._id, { ...t }]));
  let counter = 0;

  const mongooseMock = {
    startSession: async () => {
      const session = { buffer: [] };
      session.withTransaction = async (fn) => {
        await fn();
        for (const doc of session.buffer) committed.set(doc._id, doc);
      };
      session.endSession = async () => {};
      return session;
    },
  };

  function chain(resolveValue) {
    const node = {
      sort: () => node,
      select: () => node,
      session: () => node,
      populate: () => node,
      lean: async () => resolveValue,
    };
    return node;
  }

  const TaskModel = {
    findOne: ({ column }) => {
      const matches = [...committed.values()].filter((t) => t.column === column);
      const max = matches.length ? matches.reduce((m, t) => (t.order > m.order ? t : m)) : null;
      return chain(max);
    },
    findById: (id) => chain(committed.get(id) || null),
    create: async (docsArray, opts = {}) => {
      const session = opts.session;
      // Mirrors two things the real Mongoose schema does automatically
      // (models/Task.js) that this in-memory fake otherwise skips: an
      // `_id` and a default `uploadedAt` on each embedded attachment
      // subdocument, both needed by lib/serialize.js's toAttachmentDTO.
      const created = docsArray.map((d) => ({
        _id: `task_${++counter}`,
        ...d,
        attachments: (d.attachments || []).map((a, i) => ({
          _id: `att_${counter}_${i}`,
          uploadedAt: new Date(),
          ...a,
        })),
      }));
      if (session) session.buffer.push(...created);
      else created.forEach((d) => committed.set(d._id, d));
      return created;
    },
  };

  return { mongooseMock, TaskModel, committed };
}

function setupMocks({ tasks = [] } = {}) {
  resetModuleCache();
  const world = makeFakeTaskWorld(tasks);
  const realMongoose = require("mongoose");
  mockModule("mongoose", { ...realMongoose, startSession: world.mongooseMock.startSession });
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: "user1" } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
      canEditProject: () => true,
    getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
    validateAssignees: () => ({ assignees: [] }),
  });
  mockModule("@/models/Column", {
    findOne: () => ({ session: () => ({ lean: async () => ({ _id: COLUMN_ID }) }) }),
  });
  mockModule("@/models/Task", world.TaskModel);
  return world;
}

(async () => {
  console.log("Task creation with attachments (additive feature)");

  await test("creates a task with a single valid attachment embedded immediately", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const bytes = pngBytes();
    const req = fakeMultipartReq(
      { projectId: PROJECT_ID, columnId: COLUMN_ID, title: "With file" },
      [fakeFile({ name: "shot.png", bytes })]
    );
    const res = await POST(req);
    const json = await res.json();
    assert.strictEqual(res.status, 201);
    const [task] = [...world.committed.values()];
    assert.strictEqual(task.attachments.length, 1);
    assert.strictEqual(task.attachments[0].filename, "shot.png");
    assert.strictEqual(task.attachments[0].size, bytes.length);
    assert.strictEqual(task.attachments[0].data, bytes.toString("base64"));
    // The response DTO never leaks the base64 data back to the client.
    assert.ok(!JSON.stringify(json).includes(bytes.toString("base64")));
  });

  await test("creates a task with multiple valid attachments, each preserved individually", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const a = pngBytes(10);
    const b = pngBytes(20);
    const req = fakeMultipartReq(
      { projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Multi" },
      [fakeFile({ name: "a.png", bytes: a }), fakeFile({ name: "b.png", bytes: b })]
    );
    const res = await POST(req);
    assert.strictEqual(res.status, 201);
    const [task] = [...world.committed.values()];
    assert.strictEqual(task.attachments.length, 2);
    assert.strictEqual(task.attachments[0].filename, "a.png");
    assert.strictEqual(task.attachments[1].filename, "b.png");
  });

  await test("a task with no files still uses the plain JSON path and gets an empty attachments array", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(fakeJsonReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "No files" }));
    assert.strictEqual(res.status, 201);
    const [task] = [...world.committed.values()];
    assert.deepStrictEqual(task.attachments, []);
  });

  await test("an oversized file rejects the whole request with 400 and creates no task", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const tooBig = fakeFile({ name: "big.png", bytes: pngBytes(MAX_FILE_SIZE) }); // > MAX_FILE_SIZE
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Too big" }, [tooBig]);
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("a mislabeled file (bad magic bytes) rejects the whole request and creates no task", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const notReallyPng = fakeFile({ name: "fake.png", bytes: Buffer.alloc(20, 9) }); // wrong signature
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Bad file" }, [notReallyPng]);
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("files whose combined size exceeds the per-task total are rejected, no task created", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const half = Math.floor(MAX_TOTAL_ATTACHMENTS_SIZE / 2) + 1024;
    const files = [
      fakeFile({ name: "a.png", bytes: pngBytes(half) }),
      fakeFile({ name: "b.png", bytes: pngBytes(half) }),
    ];
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Over total" }, files);
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("more files than MAX_ATTACHMENTS_PER_TASK are rejected up front, no task created", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_TASK + 1 }, (_, i) =>
      fakeFile({ name: `f${i}.png`, bytes: pngBytes(5) })
    );
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Too many" }, files);
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("an invalid title still 400s before any file is even read, same as the JSON path", async () => {
    const world = setupMocks();
    const { POST } = require("../src/app/api/tasks/route.js");
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "   " }, [
      fakeFile({ name: "a.png", bytes: pngBytes() }),
    ]);
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(world.committed.size, 0);
  });

  summary();
})();
