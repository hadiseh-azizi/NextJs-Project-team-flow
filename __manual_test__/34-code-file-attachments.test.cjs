// Manual tests for attaching source-code files (.py, .js, .cpp, ...) to
// tasks, both at creation time (POST /api/tasks, multipart) and on an
// existing task (POST /api/tasks/[id]/attachments), plus download headers.
//
// What must hold: every supported code extension is accepted by the SERVER
// regardless of the (unreliable) MIME type the browser declared; anything
// off the allowlist is still rejected; binary content posing as source code
// is still rejected; code files are stored/served as inert "text/plain"
// downloads; and the pre-existing types (PNG, PDF, TXT, ...) behave exactly
// as before.

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const {
  CODE_EXTENSIONS,
  ATTACHMENT_ACCEPT,
  resolveAttachmentMimeType,
  isAllowedAttachmentExtension,
  validateAttachmentFile,
} = require("../src/lib/attachmentPolicy.js");

const PROJECT_ID = "111111111111111111111111";
const COLUMN_ID = "222222222222222222222222";
const TASK_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER_ID = "dddddddddddddddddddddddd";
const ATTACHMENT_ID = "333333333333333333333333";

const REQUIRED_EXTENSIONS = [
  ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".php", ".rb", ".go", ".rs", ".swift", ".kt", ".kts", ".html",
  ".css", ".scss", ".sql", ".json", ".xml", ".yaml", ".yml", ".md", ".txt",
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = () => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(50, 1)]);
const src = (text) => Buffer.from(text, "utf8");

function fakeFile({ name, type = "", bytes }) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function fakeUploadReq(file) {
  return { headers: new Headers(), body: null, formData: async () => ({ get: (k) => (k === "file" ? file : null) }) };
}

function fakeMultipartReq(fields, files = []) {
  return {
    headers: new Headers({ "content-type": "multipart/form-data; boundary=x" }),
    body: null,
    formData: async () => ({
      get: (k) => (k === "data" ? JSON.stringify(fields) : null),
      getAll: (k) => (k === "files" ? files : []),
    }),
  };
}

// ---- existing-task route harness (same shape as 14-attachment-security) ----
function setupExistingTaskRoute() {
  resetModuleCache();
  const calls = { updates: [] };
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
    canEditProject: () => true,
    getTaskAccess: async () => ({
      task: { _id: TASK_ID, attachments: [], title: "T", project: PROJECT_ID, column: COLUMN_ID, assignees: [], createdAt: new Date() },
      project: { _id: PROJECT_ID },
    }),
  });
  mockModule("@/models/Task", {
    updateOne: async (filter, update) => {
      calls.updates.push(update);
      return { matchedCount: 1 };
    },
    findById: () => ({
      select() { return this; },
      populate() { return this; },
      lean: async () => ({ _id: TASK_ID, title: "T", project: PROJECT_ID, column: COLUMN_ID, assignees: [], attachments: [], createdAt: new Date() }),
    }),
  });
  const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
  return { POST, calls };
}

async function upload(name, type, bytes) {
  const { POST, calls } = setupExistingTaskRoute();
  const res = await POST(fakeUploadReq(fakeFile({ name, type, bytes })), { params: Promise.resolve({ id: TASK_ID }) });
  return { res, calls };
}

// ---- create-task route harness (same shape as 24-task-creation-attachments) ----
function setupCreateRoute() {
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
        for (const d of session.buffer) committed.set(d._id, d);
      };
      session.endSession = async () => {};
      return session;
    },
  });
  mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
  mockModule("@/lib/mongodb", { connectDB: async () => {} });
  mockModule("@/lib/authz", {
    canEditProject: () => true,
    getAccessibleProject: async () => ({ _id: PROJECT_ID, team: { members: [] } }),
    validateAssignees: () => ({ assignees: [] }),
  });
  mockModule("@/models/Column", { findOne: () => ({ session: () => ({ lean: async () => ({ _id: COLUMN_ID }) }) }) });
  const chain = (v) => {
    const n = { sort: () => n, select: () => n, session: () => n, populate: () => n, lean: async () => v };
    return n;
  };
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
  const { POST } = require("../src/app/api/tasks/route.js");
  return { POST, committed };
}

(async () => {
  console.log("attachmentPolicy.js — code file types");

  await test("the allowlist covers every required extension, and .txt keeps working", () => {
    for (const ext of REQUIRED_EXTENSIONS) {
      assert.ok(isAllowedAttachmentExtension(`file${ext}`), `${ext} should be allowed`);
    }
    for (const ext of CODE_EXTENSIONS) assert.ok(REQUIRED_EXTENSIONS.includes(ext), `${ext} unexpected in CODE_EXTENSIONS`);
  });

  await test("every required code extension validates with an empty or wrong browser MIME type", () => {
    for (const ext of REQUIRED_EXTENSIONS.filter((e) => e !== ".txt")) {
      for (const declared of ["", "application/octet-stream", "video/mp2t", "text/x-python", "text/markdown"]) {
        const name = `main${ext}`;
        const mime = resolveAttachmentMimeType(name, declared);
        assert.strictEqual(mime, "text/plain", `${name} should resolve to text/plain`);
        const v = validateAttachmentFile(name, mime, src("print('hi')\n"));
        assert.strictEqual(v.ok, true, `${name} (declared "${declared}") rejected: ${v.error}`);
      }
    }
  });

  await test("uppercase extensions (MAIN.PY) are accepted too", () => {
    assert.strictEqual(validateAttachmentFile("MAIN.PY", resolveAttachmentMimeType("MAIN.PY", ""), src("x=1")).ok, true);
  });

  await test("the file-picker accept string includes code extensions and the pre-existing types", () => {
    const parts = ATTACHMENT_ACCEPT.split(",");
    for (const ext of REQUIRED_EXTENSIONS) assert.ok(parts.includes(ext), `${ext} missing from accept`);
    for (const ext of [".pdf", ".png", ".jpg", ".docx", ".xlsx", ".csv"]) assert.ok(parts.includes(ext), `${ext} missing from accept`);
  });

  await test("unsupported / dangerous extensions are still rejected, whatever MIME is declared", () => {
    for (const name of ["run.exe", "run.sh", "run.bat", "run.ps1", "lib.dll", "a.zip", "logo.svg", "page.htm", "x.jar", "x.py.exe", "noextension", "x.pyc"]) {
      for (const declared of ["", "text/plain", "application/octet-stream", "text/x-python"]) {
        const mime = resolveAttachmentMimeType(name, declared);
        assert.strictEqual(validateAttachmentFile(name, mime, src("echo hi")).ok, false, `${name} (declared "${declared}") should be rejected`);
      }
    }
    assert.strictEqual(isAllowedAttachmentExtension("run.exe"), false);
    assert.strictEqual(isAllowedAttachmentExtension("noextension"), false);
  });

  await test("binary content renamed to a source-code extension is rejected", () => {
    const binary = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), Buffer.alloc(200, 0)]);
    for (const name of ["evil.py", "evil.js", "evil.cpp", "evil.json"]) {
      const v = validateAttachmentFile(name, resolveAttachmentMimeType(name, ""), binary);
      assert.strictEqual(v.ok, false, `${name} with binary body should be rejected`);
    }
  });

  await test("a real PNG renamed to .py is rejected (contains NUL bytes)", () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(20, 0)]);
    assert.strictEqual(validateAttachmentFile("pic.py", resolveAttachmentMimeType("pic.py", "image/png"), png).ok, false);
  });

  await test("pre-existing behavior is unchanged: mismatched MIME/extension for non-code types, and strict .txt", () => {
    assert.strictEqual(resolveAttachmentMimeType("photo.png", "image/png"), "image/png");
    assert.strictEqual(validateAttachmentFile("photo.png", "image/png", pngBytes()).ok, true);
    assert.strictEqual(validateAttachmentFile("photo.pdf", "image/png", pngBytes()).ok, false);
    assert.strictEqual(validateAttachmentFile("doc.pdf", "application/pdf", src("%PDF-1.4")).ok, true);
    assert.strictEqual(validateAttachmentFile("notes.txt", "text/plain", src("hello")).ok, true);
    assert.strictEqual(validateAttachmentFile("notes.txt", "application/octet-stream", src("hello")).ok, false);
  });

  console.log("\nPOST /api/tasks/[id]/attachments — existing task");

  await test(".py upload on an existing task succeeds (browser reported no MIME type) and is stored as text/plain", async () => {
    const bytes = src("def main():\n    print('hello')\n");
    const { res, calls } = await upload("script.py", "", bytes);
    assert.strictEqual(res.status, 201, JSON.stringify(await res.clone().json()));
    const pushed = calls.updates[0].$push.attachments;
    assert.strictEqual(pushed.filename, "script.py");
    assert.strictEqual(pushed.mimeType, "text/plain");
    assert.strictEqual(pushed.data, bytes.toString("base64"));
  });

  await test(".js (application/javascript), .ts (video/mp2t) and .cpp (text/x-c++src) uploads succeed", async () => {
    for (const [name, type] of [["app.js", "application/javascript"], ["types.ts", "video/mp2t"], ["main.cpp", "text/x-c++src"]]) {
      const { res, calls } = await upload(name, type, src("// code\nint x = 1;\n"));
      assert.strictEqual(res.status, 201, `${name}: ${JSON.stringify(await res.clone().json())}`);
      assert.strictEqual(calls.updates[0].$push.attachments.mimeType, "text/plain");
    }
  });

  await test("unsupported types are rejected with 400 and nothing is written", async () => {
    for (const [name, type] of [["run.exe", "application/x-msdownload"], ["run.sh", "text/x-shellscript"], ["evil.py.exe", "text/plain"]]) {
      const { res, calls } = await upload(name, type, src("echo hi"));
      assert.strictEqual(res.status, 400, `${name} should be rejected`);
      assert.strictEqual(calls.updates.length, 0);
    }
  });

  await test("binary posing as .py is rejected with 400 and nothing is written", async () => {
    const { res, calls } = await upload("evil.py", "text/x-python", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100, 0)]));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(calls.updates.length, 0);
  });

  await test("existing attachment types still upload: PNG keeps its declared MIME type", async () => {
    const { res, calls } = await upload("photo.png", "image/png", pngBytes());
    assert.strictEqual(res.status, 201);
    assert.strictEqual(calls.updates[0].$push.attachments.mimeType, "image/png");
  });

  console.log("\nPOST /api/tasks — attachments at creation time");

  await test("creating a task with .py + .cpp + .png attaches all three, code stored as text/plain", async () => {
    const { POST, committed } = setupCreateRoute();
    const py = src("print('x')\n");
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "With code" }, [
      fakeFile({ name: "solution.py", type: "", bytes: py }),
      fakeFile({ name: "main.cpp", type: "text/x-c++src", bytes: src("int main(){}\n") }),
      fakeFile({ name: "shot.png", type: "image/png", bytes: pngBytes() }),
    ]);
    const res = await POST(req);
    const json = await res.json();
    assert.strictEqual(res.status, 201, JSON.stringify(json));
    const [task] = [...committed.values()];
    assert.deepStrictEqual(task.attachments.map((a) => a.filename), ["solution.py", "main.cpp", "shot.png"]);
    assert.deepStrictEqual(task.attachments.map((a) => a.mimeType), ["text/plain", "text/plain", "image/png"]);
    assert.strictEqual(task.attachments[0].data, py.toString("base64"));
    assert.ok(!JSON.stringify(json).includes(py.toString("base64")), "response must not leak file data");
  });

  await test("one unsupported file among valid code files rejects the whole request; no task is created", async () => {
    const { POST, committed } = setupCreateRoute();
    const req = fakeMultipartReq({ projectId: PROJECT_ID, columnId: COLUMN_ID, title: "Mixed" }, [
      fakeFile({ name: "ok.py", bytes: src("x=1") }),
      fakeFile({ name: "setup.exe", type: "application/x-msdownload", bytes: src("MZ") }),
    ]);
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(committed.size, 0);
  });

  console.log("\nGET /api/tasks/[id]/attachments/[attachmentId] — code files download inertly");

  await test("a stored .py downloads as an attachment, text/plain, nosniff, with the filename intact", async () => {
    resetModuleCache();
    const data = src("import os\n");
    mockModule("next-auth", { getServerSession: async () => ({ user: { id: USER_ID } }) });
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockModule("@/lib/authz", {
      canEditProject: () => true,
      getTaskAccess: async () => ({
        task: { attachments: { id: () => ({ filename: "script.py", mimeType: "text/plain", data: data.toString("base64") }) } },
        project: { _id: PROJECT_ID },
      }),
    });
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "text/plain");
    assert.ok(res.headers.get("content-disposition").startsWith("attachment;"));
    assert.ok(res.headers.get("content-disposition").includes("script.py"));
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(Buffer.from(await res.arrayBuffer()).toString(), "import os\n");
  });

  summary();
})();
