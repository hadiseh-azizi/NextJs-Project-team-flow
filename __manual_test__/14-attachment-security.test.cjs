// Manual tests for the Task Attachment Security, Validation, Memory Usage,
// and Storage Safety audit. Covers three layers:
//
//   1. Pure validation/sanitization logic in lib/attachmentPolicy.js —
//      exercised directly, no mocking needed.
//   2. Authorization + projection behavior in lib/authz.js's
//      getTaskAccess() — verifies attachment bytes are only loaded when a
//      caller explicitly opts in.
//   3. The upload/download/delete routes themselves, with Mongoose/
//      next-auth mocked the same way as 12-transaction-fallback-routes —
//      covers oversized requests/files, count and total-size limits (both
//      the up-front check and the atomic race-closing backstop),
//      malformed/mislabeled files, and authorization on download/delete.
//
// What this does and doesn't prove: same caveat as the rest of this
// harness (see __manual_test__/README.md) — there's no live MongoDB here,
// so the atomic-update race-closing query (`Task.updateOne` with `$expr`)
// is verified by asserting the route builds and reacts to it correctly,
// not by actually firing two concurrent requests at a real server and
// watching one lose. The `$expr`/`$size`/`$sum` operators used in that
// filter are standard, stable MongoDB query-language features (available
// since 3.6), so the query shape itself isn't in question — what these
// tests confirm is that the *route* sends the right filter and handles
// both possible outcomes (`matchedCount` 1 or 0) correctly.

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");

const {
  sanitizeFilename,
  validateAttachmentFile,
  buildContentDisposition,
  MAX_FILE_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
} = require("../src/lib/attachmentPolicy.js");

const TASK_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const TEAM_ID = "cccccccccccccccccccccccc";
const USER_ID = "dddddddddddddddddddddddd";
const OUTSIDER_ID = "eeeeeeeeeeeeeeeeeeeeeeee";
const COLUMN_ID = "ffffffffffffffffffffffff";
const ATTACHMENT_ID = "111111111111111111111111";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngBuffer(extraBytes = 100) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extraBytes, 1)]);
}

function fakeFile({ name, type, bytes }) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// A request with no body stream (falls straight through to formData()) and
// no Content-Length header, so lib/limitedFormData.js's fast-path check is
// skipped and control reaches the route's own field-by-field checks —
// those, not the multipart transport itself, are what these tests target.
// The transport-level guard is already covered end-to-end by
// 06-limited-form-data.test.cjs.
function fakeUploadReq(file) {
  return {
    headers: new Headers(),
    body: null,
    formData: async () => ({ get: (key) => (key === "file" ? file : null) }),
  };
}

function fakeDeclaredOversizedReq(declaredBytes) {
  return {
    headers: new Headers({ "content-length": String(declaredBytes) }),
    // If the route/limitedFormData reads this before rejecting, the test
    // below fails loudly instead of silently passing for the wrong reason.
    get body() {
      throw new Error("body should never be read once Content-Length already exceeds the limit");
    },
  };
}

function baseTask(overrides = {}) {
  return {
    _id: TASK_ID,
    title: "Task",
    description: null,
    column: COLUMN_ID,
    order: 0,
    dueDate: null,
    color: null,
    project: PROJECT_ID,
    assignees: [],
    attachments: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function mockAuthorizedAccess(taskOverrides = {}) {
  mockModule("@/lib/authz", {
    getTaskAccess: async () => ({ task: baseTask(taskOverrides), project: { _id: PROJECT_ID } }),
  });
}

function mockDeniedAccess() {
  mockModule("@/lib/authz", { getTaskAccess: async () => null });
}

function mockSession(userId) {
  mockModule("next-auth", { getServerSession: async () => (userId ? { user: { id: userId } } : null) });
}

function mockFindByIdChain(doc) {
  return () => ({
    select: function () { return this; },
    populate: function () { return this; },
    lean: async () => doc,
  });
}

(async () => {
  console.log("attachmentPolicy.js — filename sanitization");

  await test("strips a directory-traversal / path prefix down to the final segment", () => {
    assert.strictEqual(sanitizeFilename("../../etc/passwd"), "passwd");
    assert.strictEqual(sanitizeFilename("..\\..\\windows\\system32\\config"), "config");
  });

  await test("strips control characters, quotes, and backslashes that could break a header", () => {
    const result = sanitizeFilename('evil"\\name\r\n.txt');
    assert.ok(!/["\\]/.test(result), `expected no quotes/backslashes, got ${JSON.stringify(result)}`);
    assert.ok(!/[\r\n]/.test(result), `expected no CR/LF, got ${JSON.stringify(result)}`);
  });

  await test("falls back to a generic name when nothing usable survives sanitization", () => {
    assert.strictEqual(sanitizeFilename("///"), "file");
    assert.strictEqual(sanitizeFilename(""), "file");
    assert.strictEqual(sanitizeFilename(null), "file");
  });

  await test("truncates an absurdly long filename while preserving the extension", () => {
    const longName = "a".repeat(500) + ".pdf";
    const result = sanitizeFilename(longName);
    assert.ok(result.length <= 150, `expected <=150 chars, got ${result.length}`);
    assert.ok(result.endsWith(".pdf"), `expected extension preserved, got ${result}`);
  });

  await test("buildContentDisposition never lets a sanitized filename break out of the header value", () => {
    const header = buildContentDisposition("weird name (final).pdf");
    assert.ok(header.startsWith("attachment;"));
    assert.ok(header.includes("filename*=UTF-8''"));
  });

  console.log("\nattachmentPolicy.js — MIME/extension/magic-byte validation");

  await test("accepts a real PNG with matching extension and MIME type", () => {
    const result = validateAttachmentFile("photo.png", "image/png", pngBuffer());
    assert.strictEqual(result.ok, true);
  });

  await test("rejects an extension that doesn't pair with the declared MIME type", () => {
    const result = validateAttachmentFile("photo.exe", "image/png", pngBuffer());
    assert.strictEqual(result.ok, false);
  });

  await test("rejects a MIME type outside the allowlist even with a plausible extension", () => {
    const result = validateAttachmentFile("script.svg", "image/svg+xml", Buffer.from("<svg/>"));
    assert.strictEqual(result.ok, false);
  });

  await test("rejects a file whose declared type doesn't match its double extension", () => {
    // A classic disguise attempt: the *last* extension is what's checked,
    // so ".pdf.exe" is judged as an ".exe" — not on the allowlist.
    const result = validateAttachmentFile("resume.pdf.exe", "application/pdf", Buffer.from("%PDF-1.4"));
    assert.strictEqual(result.ok, false);
  });

  await test("rejects a file whose bytes don't match its extension+MIME (magic-byte check)", () => {
    // Extension and MIME agree on PNG, but the bytes are plain text — a
    // client lying about, or a browser mis-guessing, the real file type.
    const result = validateAttachmentFile("photo.png", "image/png", Buffer.from("not a real png"));
    assert.strictEqual(result.ok, false);
  });

  await test("rejects a binary file renamed to .txt (no NUL-byte heuristic passes)", () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    const result = validateAttachmentFile("notes.txt", "text/plain", binary);
    assert.strictEqual(result.ok, false);
  });

  await test("accepts a real PDF", () => {
    const pdfBytes = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(50, 0x20)]);
    const result = validateAttachmentFile("report.pdf", "application/pdf", pdfBytes);
    assert.strictEqual(result.ok, true);
  });

  console.log("\nattachmentPolicy.js — .py (Python) attachment support");

  await test("accepts a .py file declared as text/x-python", () => {
    const result = validateAttachmentFile("script.py", "text/x-python", Buffer.from("print('hello')\n"));
    assert.strictEqual(result.ok, true);
  });

  await test("accepts a .py file declared as text/plain (common browser fallback)", () => {
    const result = validateAttachmentFile("script.py", "text/plain", Buffer.from("def main():\n    pass\n"));
    assert.strictEqual(result.ok, true);
  });

  await test("accepts a .py file with no declared MIME type (common when the OS has no .py mapping)", () => {
    const result = validateAttachmentFile("script.py", "", Buffer.from("import sys\n"));
    assert.strictEqual(result.ok, true);
  });

  await test("rejects a binary file renamed to .py (no NUL-byte heuristic passes)", () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    const result = validateAttachmentFile("script.py", "text/x-python", binary);
    assert.strictEqual(result.ok, false);
  });

  await test("rejects a .py.exe double extension even with a text/x-python MIME type", () => {
    const result = validateAttachmentFile("script.py.exe", "text/x-python", Buffer.from("print(1)\n"));
    assert.strictEqual(result.ok, false);
  });

  await test("an empty declared MIME type still only pairs with .py, not other extensions", () => {
    const result = validateAttachmentFile("script.exe", "", Buffer.from("MZ\x90\x00"));
    assert.strictEqual(result.ok, false);
  });

  console.log("\nauthz.js — getTaskAccess() attachment-data projection");

  await test("excludes attachments.data by default", async () => {
    resetModuleCache();
    let capturedSelect = null;
    mockModule("@/models/Task", {
      findById: () => ({
        select(proj) { capturedSelect = proj; return this; },
        then(resolve) { resolve(baseTask()); },
      }),
    });
    mockModule("@/models/Project", {
      findById: () => ({ populate: function () { return this; }, lean: async () => ({ _id: PROJECT_ID, manager: USER_ID, team: { _id: TEAM_ID, members: [] } }) }),
    });

    const { getTaskAccess } = require("../src/lib/authz.js");
    const access = await getTaskAccess(TASK_ID, USER_ID);
    assert.ok(access, "expected access to be granted");
    assert.strictEqual(capturedSelect, "-attachments.data", "expected the default (metadata-only) load to exclude attachments.data");
  });

  await test("includeAttachmentData:true skips the exclusion so the download route can read the bytes", async () => {
    resetModuleCache();
    let selectWasCalled = false;
    mockModule("@/models/Task", {
      findById: () => ({
        select() { selectWasCalled = true; return this; },
        then(resolve) { resolve(baseTask()); },
      }),
    });
    mockModule("@/models/Project", {
      findById: () => ({ populate: function () { return this; }, lean: async () => ({ _id: PROJECT_ID, manager: USER_ID, team: { _id: TEAM_ID, members: [] } }) }),
    });

    const { getTaskAccess } = require("../src/lib/authz.js");
    const access = await getTaskAccess(TASK_ID, USER_ID, { includeAttachmentData: true });
    assert.ok(access, "expected access to be granted");
    assert.strictEqual(selectWasCalled, false, "expected no projection when the caller explicitly opts into full attachment data");
  });

  await test("an outsider (neither manager nor team member) is denied task access regardless of includeAttachmentData", async () => {
    resetModuleCache();
    mockModule("@/models/Task", {
      findById: () => ({ select() { return this; }, then(resolve) { resolve(baseTask()); } }),
    });
    mockModule("@/models/Project", {
      findById: () => ({ populate: function () { return this; }, lean: async () => ({ _id: PROJECT_ID, manager: USER_ID, team: { _id: TEAM_ID, members: [{ _id: USER_ID }] } }) }),
    });

    const { getTaskAccess } = require("../src/lib/authz.js");
    const access = await getTaskAccess(TASK_ID, OUTSIDER_ID, { includeAttachmentData: true });
    assert.strictEqual(access, null);
  });

  console.log("\nserialize.js — attachment DTOs never carry the base64 payload");

  await test("toAttachmentDTO strips `data` even if present on the source document", () => {
    const { toAttachmentDTO } = require("../src/lib/serialize.js");
    const dto = toAttachmentDTO({
      _id: ATTACHMENT_ID,
      filename: "big.pdf",
      mimeType: "application/pdf",
      size: 12345,
      uploadedAt: new Date(),
      data: "a".repeat(50000), // simulates an accidentally-loaded payload
    });
    assert.ok(!("data" in dto), "toAttachmentDTO must never expose the base64 field, even if it was loaded");
  });

  await test("toTaskDTO's attachments array is built entirely from toAttachmentDTO (no raw pass-through)", () => {
    const { toTaskDTO } = require("../src/lib/serialize.js");
    const dto = toTaskDTO({
      ...baseTask(),
      attachments: [{ _id: ATTACHMENT_ID, filename: "x.png", mimeType: "image/png", size: 1, uploadedAt: new Date(), data: "leak" }],
    });
    assert.strictEqual(dto.attachments.length, 1);
    assert.ok(!("data" in dto.attachments[0]));
  });

  console.log("\nPOST /api/tasks/[id]/attachments — validation, limits, and the upload route");

  await test("rejects with 401 when there is no session", async () => {
    resetModuleCache();
    mockSession(null);
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeUploadReq(fakeFile({ name: "a.png", type: "image/png", bytes: pngBuffer() })), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("rejects with 403 (not 404) when the user has no access to the task — doesn't confirm or deny the task's existence", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockDeniedAccess();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeUploadReq(fakeFile({ name: "a.png", type: "image/png", bytes: pngBuffer() })), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("rejects an oversized declared Content-Length before ever touching the task or the database", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => { throw new Error("should not connect before the size guard rejects"); } });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeDeclaredOversizedReq(50 * 1024 * 1024), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 413);
  });

  await test("rejects a file over the per-file size limit", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockAuthorizedAccess();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const oversizedFile = fakeFile({ name: "a.png", type: "image/png", bytes: pngBuffer(MAX_FILE_SIZE + 1) });
    const res = await POST(fakeUploadReq(oversizedFile), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, JSON.stringify(json));
  });

  await test("rejects a zero-byte file", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockAuthorizedAccess();
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const emptyFile = fakeFile({ name: "empty.png", type: "image/png", bytes: Buffer.alloc(0) });
    const res = await POST(fakeUploadReq(emptyFile), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 400);
  });

  await test("rejects once the task already has the maximum number of attachments", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const existing = Array.from({ length: MAX_ATTACHMENTS_PER_TASK }, (_, i) => ({ filename: `f${i}.txt`, mimeType: "text/plain", size: 10 }));
    mockAuthorizedAccess({ attachments: existing });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeUploadReq(fakeFile({ name: "a.png", type: "image/png", bytes: pngBuffer() })), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, JSON.stringify(json));
    assert.ok(/maximum/.test(json.error));
  });

  await test("rejects once the task's total attachment size would exceed the cap", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const nearLimit = [{ filename: "big.pdf", mimeType: "application/pdf", size: MAX_TOTAL_ATTACHMENTS_SIZE - 100 }];
    mockAuthorizedAccess({ attachments: nearLimit });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeUploadReq(fakeFile({ name: "a.png", type: "image/png", bytes: pngBuffer(1000) })), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 400, JSON.stringify(json));
    assert.ok(/total attachment storage limit/.test(json.error));
  });

  await test("rejects a mislabeled file (extension/MIME/bytes mismatch) without ever calling Task.updateOne", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockAuthorizedAccess();
    let updateOneCalled = false;
    mockModule("@/models/Task", { updateOne: async () => { updateOneCalled = true; return { matchedCount: 1 }; } });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const fakeExe = fakeFile({ name: "invoice.pdf", type: "application/pdf", bytes: Buffer.from("MZ\x90\x00fake-exe-not-a-pdf") });
    const res = await POST(fakeUploadReq(fakeExe), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(updateOneCalled, false, "a mislabeled file must never reach the database write");
  });

  await test("a valid upload issues an atomic update guarded by both the count and total-size limits", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockAuthorizedAccess();
    let capturedFilter = null;
    let capturedUpdate = null;
    mockModule("@/models/Task", {
      updateOne: async (filter, update) => {
        capturedFilter = filter;
        capturedUpdate = update;
        return { matchedCount: 1 };
      },
      findById: mockFindByIdChain(baseTask()),
    });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeUploadReq(fakeFile({ name: "photo.png", type: "image/png", bytes: pngBuffer() })), { params: Promise.resolve({ id: TASK_ID }) });
    const json = await res.json();
    assert.strictEqual(res.status, 201, JSON.stringify(json));
    assert.strictEqual(capturedFilter._id, TASK_ID);
    assert.ok(capturedFilter.$expr, "expected the count/size race guard to be part of the update's own filter");
    assert.ok(capturedUpdate.$push.attachments.filename, "expected the new attachment to be pushed");
    assert.ok(
      typeof capturedUpdate.$push.attachments.data === "string" && capturedUpdate.$push.attachments.data.length > 0,
      "expected the encoded file contents to be part of the $push"
    );
  });

  await test("a race lost against a concurrent upload (matchedCount 0) is reported as a 409, not a 500 or a silent 201", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockAuthorizedAccess();
    mockModule("@/models/Task", { updateOne: async () => ({ matchedCount: 0 }) });
    const { POST } = require("../src/app/api/tasks/[id]/attachments/route.js");
    const res = await POST(fakeUploadReq(fakeFile({ name: "photo.png", type: "image/png", bytes: pngBuffer() })), { params: Promise.resolve({ id: TASK_ID }) });
    assert.strictEqual(res.status, 409);
  });

  console.log("\nGET /api/tasks/[id]/attachments/[attachmentId] — download authorization");

  await test("rejects download with 401 when there is no session", async () => {
    resetModuleCache();
    mockSession(null);
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("rejects download with 403 for a user outside the task's project/team", async () => {
    resetModuleCache();
    mockSession(OUTSIDER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockDeniedAccess();
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("rejects a malformed attachment id with 404 instead of letting it reach Mongoose as a CastError", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: "not-an-object-id" }) });
    assert.strictEqual(res.status, 404);
  });

  await test("a real, authorized download streams the file with a safe Content-Disposition and nosniff", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const fileBytes = pngBuffer(20);
    const attachments = [{
      _id: ATTACHMENT_ID,
      filename: "clean.png",
      mimeType: "image/png",
      size: fileBytes.length,
      data: fileBytes.toString("base64"),
    }];
    // Real Mongoose-array-like `.id()` lookup, minimal shape needed by the route.
    const task = baseTask({
      attachments: {
        ...attachments,
        length: attachments.length,
        id: (wantedId) => attachments.find((a) => a._id === wantedId) || null,
      },
    });
    mockModule("@/lib/authz", { getTaskAccess: async (id, userId, opts) => {
      assert.deepStrictEqual(opts, { includeAttachmentData: true }, "download must opt into loading attachment data");
      return { task, project: { _id: PROJECT_ID } };
    } });
    const { GET } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await GET({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.strictEqual(res.headers.get("Content-Type"), "image/png");
    assert.ok(res.headers.get("Content-Disposition").startsWith("attachment;"), "must force download, never inline rendering");
  });

  console.log("\nDELETE /api/tasks/[id]/attachments/[attachmentId] — delete authorization");

  await test("rejects delete with 401 when there is no session", async () => {
    resetModuleCache();
    mockSession(null);
    const { DELETE } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await DELETE({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 401);
  });

  await test("rejects delete with 403 for a user outside the task's project/team", async () => {
    resetModuleCache();
    mockSession(OUTSIDER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    mockDeniedAccess();
    const { DELETE } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await DELETE({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 403);
  });

  await test("an authorized delete issues an atomic $pull scoped to this task and this attachment id", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const attachments = [{ _id: ATTACHMENT_ID, filename: "clean.png", mimeType: "image/png", size: 10 }];
    const task = baseTask({
      attachments: { ...attachments, length: attachments.length, id: (wantedId) => attachments.find((a) => a._id === wantedId) || null },
    });
    mockModule("@/lib/authz", { getTaskAccess: async () => ({ task, project: { _id: PROJECT_ID } }) });
    let capturedFilter = null;
    let capturedUpdate = null;
    mockModule("@/models/Task", {
      updateOne: async (filter, update) => { capturedFilter = filter; capturedUpdate = update; return { matchedCount: 1 }; },
      findById: mockFindByIdChain(baseTask()),
    });
    const { DELETE } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await DELETE({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedFilter._id, TASK_ID);
    assert.deepStrictEqual(capturedUpdate, { $pull: { attachments: { _id: ATTACHMENT_ID } } });
  });

  await test("deleting an attachment id that isn't on this task returns 404, not a delete of the wrong record", async () => {
    resetModuleCache();
    mockSession(USER_ID);
    mockModule("@/lib/mongodb", { connectDB: async () => {} });
    const task = baseTask({ attachments: { length: 0, id: () => null } });
    mockModule("@/lib/authz", { getTaskAccess: async () => ({ task, project: { _id: PROJECT_ID } }) });
    const { DELETE } = require("../src/app/api/tasks/[id]/attachments/[attachmentId]/route.js");
    const res = await DELETE({}, { params: Promise.resolve({ id: TASK_ID, attachmentId: ATTACHMENT_ID }) });
    assert.strictEqual(res.status, 404);
  });

  summary();
})();
