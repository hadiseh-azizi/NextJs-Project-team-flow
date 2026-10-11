// H5 — attachment limits vs. the Vercel request/response body limit.
//
// Vercel Functions reject request bodies, and non-streamed response bodies,
// over 4.5 MB (the platform answers with 413 FUNCTION_PAYLOAD_TOO_LARGE
// before app code runs). These tests check that every request budget the
// app enforces sits under that limit with real headroom, using REAL
// Request/FormData/File objects so the byte counts include genuine
// multipart framing — and then drive the real routes (and the real
// lib/limitedFormData.js) with those requests.
//
// What this does NOT prove: that Vercel itself behaves as documented. That
// needs a Vercel preview deployment; see "Vercel verification" in the README
// and the changelog notes for the manual matrix.

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const policy = require("../src/lib/attachmentPolicy.js");

const {
  PLATFORM_BODY_LIMIT_BYTES,
  MAX_FILE_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_CREATE_ATTACHMENTS_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_UPLOAD_REQUEST_SIZE,
  MAX_CREATE_UPLOAD_REQUEST_SIZE,
} = policy;

const MIN_HEADROOM = 150_000; // bytes kept free under the platform limit

const TASK_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const COLUMN_ID = "ffffffffffffffffffffffff";
const USER_ID = "dddddddddddddddddddddddd";
const ATTACHMENT_ID = "111111111111111111111111";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A PNG-signature buffer of EXACTLY `totalBytes` bytes.
function pngOfSize(totalBytes) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(totalBytes - PNG_SIGNATURE.length, 1)]);
}
function realFile(name, buffer, type = "image/png") {
  return new File([buffer], name, { type });
}
const LONG_NAME = "a".repeat(146) + ".png"; // 150 chars: the filename cap
const LONG_UNICODE_NAME = "é".repeat(146) + ".png"; // 150 chars, 2 bytes each in UTF-8

function realReq(formData, headers = {}) {
  return new Request("http://localhost/api/test", { method: "POST", body: formData, headers });
}
async function bodyBytes(formData) {
  return (await realReq(formData).arrayBuffer()).byteLength;
}

// ---- create-route world (same shape as 24-task-creation-attachments) ----
function setupCreateWorld() {
  resetModuleCache();
  const committed = new Map();
  let counter = 0;
  const realMongoose = require("mongoose");
  mockModule("mongoose", {
    ...realMongoose,
    startSession: async () => {
      const session = { buffer: [] };
      session.withTransaction = async (fn) => {
        await fn();
        for (const doc of session.buffer) committed.set(doc._id, doc);
      };
      session.endSession = async () => {};
      return session;
    },
  });
  const chain = (v) => {
    const n = { sort: () => n, select: () => n, session: () => n, populate: () => n, lean: async () => v };
    return n;
  };
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
    canEditProject: () => true,
    getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
    validateAssignees: () => ({ assignees: [] }),
  });
  mockModule("@/models/Column", {
    findOne: () => ({ session: () => ({ lean: async () => ({ _id: COLUMN_ID }) }) }),
  });
  mockModule("@/models/Task", {
    findOne: () => chain(null),
    findById: (id) => chain(committed.get(id) || null),
    create: async (docs, opts = {}) => {
      const created = docs.map((d) => ({
        _id: `task_${++counter}`,
        ...d,
        attachments: (d.attachments || []).map((a, i) => ({ _id: `att_${counter}_${i}`, uploadedAt: new Date(), ...a })),
      }));
      if (opts.session) opts.session.buffer.push(...created);
      else created.forEach((d) => committed.set(d._id, d));
      return created;
    },
  });
  return { committed };
}

function createFormData(files, dataOverrides = {}) {
  const fd = new FormData();
  fd.append("data", JSON.stringify({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "T", ...dataOverrides }));
  for (const f of files) fd.append("files", f);
  return fd;
}

// ---- upload / download world (same shape as 14-attachment-security) ----
function baseTask(overrides = {}) {
  return { _id: TASK_ID, title: "Task", description: null, column: COLUMN_ID, order: 0, dueDate: null, color: null,
    project: PROJECT_ID, assignees: [], attachments: [], createdAt: new Date(), ...overrides };
}
function setupUploadWorld(taskOverrides = {}) {
  resetModuleCache();
  const calls = { updateOne: [] };
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
    canEditProject: () => true,
    getTaskAccess: async () => ({ task: baseTask(taskOverrides), project: { _id: PROJECT_ID } }),
  });
  mockModule("@/models/Task", {
    updateOne: async (filter, update) => { calls.updateOne.push({ filter, update }); return { matchedCount: 1 }; },
    findById: () => ({ select() { return this; }, populate() { return this; }, lean: async () => baseTask() }),
  });
  return calls;
}
function setupDownloadWorld(attachment) {
  resetModuleCache();
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  const list = [attachment];
  const task = baseTask({ attachments: { ...list, length: 1, id: (id) => list.find((a) => a._id === id) || null } });
  mockModule("@/lib/authz", {
    canEditProject: () => true,
    getTaskAccess: async () => ({ task, project: { _id: PROJECT_ID } }),
  });
}

(async () => {
  console.log("Budgets vs. the platform limit");

  await test("every request budget sits under the 4.5 MB platform limit with real headroom", () => {
    assert.ok(MAX_FILE_SIZE < PLATFORM_BODY_LIMIT_BYTES);
    assert.ok(MAX_UPLOAD_REQUEST_SIZE <= PLATFORM_BODY_LIMIT_BYTES - MIN_HEADROOM, `upload budget ${MAX_UPLOAD_REQUEST_SIZE}`);
    assert.ok(MAX_CREATE_UPLOAD_REQUEST_SIZE <= PLATFORM_BODY_LIMIT_BYTES - MIN_HEADROOM, `create budget ${MAX_CREATE_UPLOAD_REQUEST_SIZE}`);
    // The old limits (5 MiB file / ~8 MiB create request) must not come back.
    assert.ok(MAX_FILE_SIZE < 5 * 1024 * 1024);
    assert.ok(MAX_CREATE_ATTACHMENTS_SIZE < 8 * 1024 * 1024);
  });

  await test("per-task storage total is NOT a request limit and still fits the 16 MiB BSON ceiling once base64-encoded", () => {
    const base64Bytes = Math.ceil(MAX_TOTAL_ATTACHMENTS_SIZE / 3) * 4;
    assert.ok(base64Bytes <= 16 * 1024 * 1024 - 4 * 1024 * 1024, `encoded total ${base64Bytes}`);
    // Each file arrives in its own request, so the per-file/creation limits
    // are what the platform sees; the storage total is allowed to exceed it.
    assert.ok(MAX_TOTAL_ATTACHMENTS_SIZE >= MAX_FILE_SIZE);
  });

  await test("a real multipart upload of a MAX_FILE_SIZE file (longest allowed name) fits the upload budget and the platform limit", async () => {
    for (const name of [LONG_NAME, LONG_UNICODE_NAME]) {
      const fd = new FormData();
      fd.append("file", realFile(name, pngOfSize(MAX_FILE_SIZE)));
      const size = await bodyBytes(fd);
      assert.ok(size > MAX_FILE_SIZE, "body includes framing");
      assert.ok(size - MAX_FILE_SIZE < 2048, `framing overhead ${size - MAX_FILE_SIZE} B`);
      assert.ok(size <= MAX_UPLOAD_REQUEST_SIZE);
      assert.ok(size <= PLATFORM_BODY_LIMIT_BYTES - MIN_HEADROOM);
    }
  });

  await test("worst-case create request (20 max-name files totalling the creation limit + max-size JSON) fits its budget and the platform limit", async () => {
    const per = Math.floor(MAX_CREATE_ATTACHMENTS_SIZE / MAX_ATTACHMENTS_PER_TASK);
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_TASK }, (_, i) => {
      const bytes = i === MAX_ATTACHMENTS_PER_TASK - 1 ? MAX_CREATE_ATTACHMENTS_SIZE - per * (MAX_ATTACHMENTS_PER_TASK - 1) : per;
      return realFile(`${i}`.padStart(2, "0") + LONG_NAME.slice(2), pngOfSize(bytes));
    });
    const fd = createFormData(files, {
      title: "t".repeat(200),
      description: "€".repeat(5000), // 3 bytes per char in UTF-8
      assigneeIds: Array.from({ length: 200 }, () => "a".repeat(24)),
    });
    const size = await bodyBytes(fd);
    assert.ok(size <= MAX_CREATE_UPLOAD_REQUEST_SIZE, `${size} > ${MAX_CREATE_UPLOAD_REQUEST_SIZE}`);
    assert.ok(size <= PLATFORM_BODY_LIMIT_BYTES - MIN_HEADROOM, `${size} leaves too little headroom`);
  });

  console.log("\nPOST /api/tasks — multi-attachment creation through the real size limiter");

  await test("three files just below the creation limit are accepted and all stored", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const third = Math.floor((MAX_CREATE_ATTACHMENTS_SIZE - 1024) / 3);
    const files = ["a.png", "b.png", "c.png"].map((n) => realFile(n, pngOfSize(third)));
    const res = await POST(realReq(createFormData(files)));
    assert.strictEqual(res.status, 201, JSON.stringify(await res.clone().json()));
    const [task] = [...world.committed.values()];
    assert.strictEqual(task.attachments.length, 3);
    assert.strictEqual(task.attachments[0].size, third);
  });

  await test("files totalling exactly the creation limit are accepted", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const a = 1_500_000, b = 1_500_000, c = MAX_CREATE_ATTACHMENTS_SIZE - a - b;
    const files = [realFile("a.png", pngOfSize(a)), realFile("b.png", pngOfSize(b)), realFile("c.png", pngOfSize(c))];
    const res = await POST(realReq(createFormData(files)));
    assert.strictEqual(res.status, 201);
    assert.strictEqual([...world.committed.values()][0].attachments.length, 3);
  });

  await test("the worst-case 20-file request is accepted end to end (budget is large enough for legitimate requests)", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const per = Math.floor(MAX_CREATE_ATTACHMENTS_SIZE / MAX_ATTACHMENTS_PER_TASK);
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_TASK }, (_, i) => {
      const bytes = i === MAX_ATTACHMENTS_PER_TASK - 1 ? MAX_CREATE_ATTACHMENTS_SIZE - per * (MAX_ATTACHMENTS_PER_TASK - 1) : per;
      return realFile(`${i}`.padStart(2, "0") + LONG_NAME.slice(2), pngOfSize(bytes));
    });
    const res = await POST(realReq(createFormData(files, { title: "t".repeat(200), description: "€".repeat(5000) })));
    assert.strictEqual(res.status, 201, JSON.stringify(await res.clone().json()));
    assert.strictEqual([...world.committed.values()][0].attachments.length, MAX_ATTACHMENTS_PER_TASK);
  });

  await test("one byte over the creation total is rejected with a 400 naming the limit; no task is created", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const a = 1_500_000, b = 1_500_000, c = MAX_CREATE_ATTACHMENTS_SIZE - a - b + 1;
    const files = [realFile("a.png", pngOfSize(a)), realFile("b.png", pngOfSize(b)), realFile("c.png", pngOfSize(c))];
    const res = await POST(realReq(createFormData(files)));
    const json = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(json.error.includes("4MB"), json.error);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("a single file one byte over the per-file limit is rejected with a 400 naming the limit", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const res = await POST(realReq(createFormData([realFile("big.png", pngOfSize(MAX_FILE_SIZE + 1))])));
    const json = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(json.error.includes("4MB per file"), json.error);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("a body over the request budget (3 x 2 MiB) is cut off by the limiter with a 413, before any file is parsed", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const two = 2 * 1024 * 1024;
    const files = ["a.png", "b.png", "c.png"].map((n) => realFile(n, pngOfSize(two)));
    const res = await POST(realReq(createFormData(files)));
    const json = await res.json();
    assert.strictEqual(res.status, 413);
    assert.ok(json.error.includes("4MB"), json.error);
    assert.strictEqual(world.committed.size, 0);
  });

  await test("a declared Content-Length over the budget is rejected with a 413 without reading the body", async () => {
    const world = setupCreateWorld();
    const { POST } = require("../src/app/api/tasks/route.js");
    const req = {
      headers: new Headers({ "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_CREATE_UPLOAD_REQUEST_SIZE + 1) }),
      get body() { throw new Error("body must not be read"); },
    };
    const res = await POST(req);
    assert.strictEqual(res.status, 413);
    assert.strictEqual(world.committed.size, 0);
  });

  console.log("\nPOST /api/tasks/[id]/attachments — single upload through the real size limiter");

  await test("a file of exactly MAX_FILE_SIZE is accepted and pushed", async () => {
    const calls = setupUploadWorld();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const fd = new FormData();
    fd.append("file", realFile("max.png", pngOfSize(MAX_FILE_SIZE)));
    const res = await POST(realReq(fd), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 201, JSON.stringify(await res.clone().json()));
    assert.strictEqual(calls.updateOne.length, 1);
    assert.strictEqual(calls.updateOne[0].update.$push.attachments.size, MAX_FILE_SIZE);
  });

  await test("a file just below MAX_FILE_SIZE is accepted", async () => {
    const calls = setupUploadWorld();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const fd = new FormData();
    fd.append("file", realFile("almost.png", pngOfSize(MAX_FILE_SIZE - 1024)));
    const res = await POST(realReq(fd), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(calls.updateOne.length, 1);
  });

  await test("a file one byte over MAX_FILE_SIZE is rejected with a 400 naming the limit; nothing is written", async () => {
    const calls = setupUploadWorld();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const fd = new FormData();
    fd.append("file", realFile("over.png", pngOfSize(MAX_FILE_SIZE + 1)));
    const res = await POST(realReq(fd), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(json.error, "File size must not exceed 4MB");
    assert.strictEqual(calls.updateOne.length, 0);
  });

  await test("a 5 MiB file (the previous limit) is cut off by the limiter with a 413 naming the new limit", async () => {
    const calls = setupUploadWorld();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const fd = new FormData();
    fd.append("file", realFile("old-limit.png", pngOfSize(5 * 1024 * 1024)));
    const res = await POST(realReq(fd), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 413);
    assert.strictEqual(json.error, "File size must not exceed 4MB");
    assert.strictEqual(calls.updateOne.length, 0);
  });

  await test("the per-task storage total (8MB across several uploads) is still enforced", async () => {
    const calls = setupUploadWorld({ attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: MAX_TOTAL_ATTACHMENTS_SIZE - 1000 }] });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const fd = new FormData();
    fd.append("file", realFile("more.png", pngOfSize(2000)));
    const res = await POST(realReq(fd), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(json.error.includes("(8MB)"), json.error);
    assert.strictEqual(calls.updateOne.length, 0);
  });

  console.log("\nGET /api/tasks/[id]/attachments/[attachmentId] — downloads");

  await test("a MAX_FILE_SIZE attachment downloads as a normal buffered response with Content-Length and identical bytes", async () => {
    const bytes = pngOfSize(MAX_FILE_SIZE);
    setupDownloadWorld({ _id: ATTACHMENT_ID, filename: "max.png", mimeType: "image/png", size: bytes.length, data: bytes.toString("base64") });
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("Content-Length"), String(bytes.length));
    assert.strictEqual(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.ok(res.headers.get("Content-Disposition").startsWith("attachment;"));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes));
  });

  await test("a legacy attachment stored under the old 5 MiB limit downloads as a chunked stream (no Content-Length) with identical bytes", async () => {
    const bytes = pngOfSize(5 * 1024 * 1024);
    setupDownloadWorld({ _id: ATTACHMENT_ID, filename: "legacy.pdf", mimeType: "image/png", size: bytes.length, data: bytes.toString("base64") });
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("Content-Length"), null);
    assert.strictEqual(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.ok(res.headers.get("Content-Disposition").startsWith("attachment;"));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes));
  });

  console.log("\nTask model — schema ceiling vs. legacy data");

  await test("schema backstop still rejects an attachment over the legacy stored ceiling (5 MiB)", async () => {
    resetModuleCache();
    const Task = require("../src/models/Task.js").default;
    const mongoose = require("mongoose");
    const oid = () => new mongoose.Types.ObjectId();
    const doc = new Task({
      title: "t", column: oid(), project: oid(),
      attachments: [{ filename: "x.png", mimeType: "image/png", size: policy.MAX_STORED_FILE_SIZE + 1, data: "AA==" }],
    });
    await assert.rejects(() => doc.validate(), /size/);
  });

  await test("an already-stored 5 MiB attachment does not break validating/saving an unrelated edit of its task", async () => {
    resetModuleCache();
    const Task = require("../src/models/Task.js").default;
    const mongoose = require("mongoose");
    const oid = () => new mongoose.Types.ObjectId();
    // Same shape the PATCH route loads (getTaskAccess): attachment
    // metadata with `attachments.data` projected out.
    const doc = Task.hydrate({
      _id: oid(), title: "t", column: oid(), project: oid(),
      attachments: [{ _id: oid(), filename: "legacy.pdf", mimeType: "application/pdf", size: 5 * 1024 * 1024, uploadedAt: new Date() }],
    }, { "attachments.data": 0 });
    doc.title = "renamed";
    await doc.validate();
  });

  summary();
})();
