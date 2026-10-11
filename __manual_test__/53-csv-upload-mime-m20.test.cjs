// M20 - CSV uploads on Windows. Chrome/Edge with Excel installed report a
// ".csv" as "application/vnd.ms-excel", which used to fail the
// extension/MIME pairing (that type is only paired with ".xls").
//
// What must hold: genuine CSV text is accepted under every MIME type a
// browser is known to send for it, and is stored as "text/csv"; the server
// never accepts a file on the strength of the extension or declared type
// alone (binary content renamed ".csv" is refused); real .xls files and
// every other previously-blocked combination are still blocked; size
// limits are untouched.

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { mockModule, resetModuleCache } = require("./mockRequire.cjs");
const policy = require("../src/lib/attachmentPolicy.js");
const { resolveAttachmentMimeType, validateAttachmentFile, MAX_FILE_SIZE } = policy;

const TASK_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PROJECT_ID = "111111111111111111111111";
const COLUMN_ID = "222222222222222222222222";
const USER_ID = "dddddddddddddddddddddddd";

const CSV = Buffer.from("name,role\r\nAda,Engineer\r\n\"Smith, J\",PM\r\n", "utf8");
const CSV_WITH_BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), CSV]);
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64, 0)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0)]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.from("This program cannot be run in DOS mode")]);

function check(name, declared, bytes) {
  const mime = resolveAttachmentMimeType(name, declared);
  return { mime, ...validateAttachmentFile(name, mime, bytes) };
}

function fakeFile({ name, type = "", bytes, size }) {
  return {
    name,
    type,
    size: size ?? bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

async function upload(name, type, bytes, size) {
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
  const file = fakeFile({ name, type, bytes, size });
  const req = { headers: new Headers(), body: null, formData: async () => ({ get: (k) => (k === "file" ? file : null) }) };
  const res = await POST(req, { params: Promise.resolve({ id: TASK_ID }) });
  return { res, calls };
}

(async () => {
  await test("the Windows case: .csv declared as application/vnd.ms-excel is accepted and canonicalised to text/csv", () => {
    const r = check("report.csv", "application/vnd.ms-excel", CSV);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.mime, "text/csv");
  });

  await test("every known browser MIME alias for CSV is accepted, as is a UTF-8 BOM (Excel's 'CSV UTF-8')", () => {
    for (const t of ["text/csv", "application/csv", "text/x-csv", "application/x-csv", "text/comma-separated-values", "application/vnd.ms-excel"]) {
      assert.strictEqual(check("data.csv", t, CSV).ok, true, t);
    }
    assert.strictEqual(check("data.csv", "application/vnd.ms-excel", CSV_WITH_BOM).ok, true);
    assert.strictEqual(check("DATA.CSV", "application/vnd.ms-excel", CSV).ok, true, "uppercase extension");
  });

  await test("the extension alone is not enough: binary content renamed .csv is refused under every accepted MIME type", () => {
    for (const [label, bytes] of [["OLE/.xls", OLE], ["zip/.xlsx", ZIP], ["pdf", PDF], ["png", PNG], ["exe", EXE]]) {
      for (const t of ["text/csv", "application/vnd.ms-excel"]) {
        const r = check("report.csv", t, bytes);
        assert.strictEqual(r.ok, false, `${label} as ${t} must be refused`);
      }
    }
    // Text that happens to be a PDF/zip/exe header but has no NUL bytes is
    // still refused by the explicit signature check.
    assert.strictEqual(check("a.csv", "text/csv", Buffer.from("%PDF-1.4 a,b,c\n")).ok, false);
    assert.strictEqual(check("a.csv", "text/csv", Buffer.from("MZ,a,b\n")).ok, false);
  });

  await test("a real .xls still works as .xls, and the CSV aliasing does not leak to other extensions", () => {
    assert.strictEqual(check("book.xls", "application/vnd.ms-excel", OLE).ok, true);
    // CSV text posing as .xls / .xlsx is still refused (signature mismatch).
    assert.strictEqual(check("book.xls", "application/vnd.ms-excel", CSV).ok, false);
    assert.strictEqual(check("book.xlsx", "application/vnd.ms-excel", ZIP).ok, false, "xlsx must not accept the ms-excel type");
    assert.strictEqual(check("notes.txt", "application/vnd.ms-excel", CSV).ok, false, ".txt must not accept the ms-excel type");
    assert.strictEqual(check("doc.pdf", "application/vnd.ms-excel", PDF).ok, false);
  });

  await test("unrelated or missing declared types on a .csv are still rejected (no guessing)", () => {
    for (const t of ["application/pdf", "image/png", "text/html", "application/octet-stream", "application/x-msdownload", ""]) {
      assert.strictEqual(check("data.csv", t, CSV).ok, false, `"${t}" should not be accepted for .csv`);
    }
  });

  await test("other disallowed file types remain blocked", () => {
    for (const name of ["run.exe", "script.sh", "setup.bat", "macro.xlsm", "page.svg", "archive.zip"]) {
      assert.strictEqual(policy.isAllowedAttachmentExtension(name), false, name);
      assert.strictEqual(check(name, "application/octet-stream", CSV).ok, false, name);
    }
  });

  await test("route: POST .csv with application/vnd.ms-excel succeeds and stores mimeType text/csv", async () => {
    const { res, calls } = await upload("team-report.csv", "application/vnd.ms-excel", CSV);
    assert.ok(res.status >= 200 && res.status < 300, `status ${res.status}`);
    assert.strictEqual(calls.updates.length, 1);
    const stored = calls.updates[0].$push.attachments;
    assert.strictEqual(stored.mimeType, "text/csv");
    assert.strictEqual(stored.filename, "team-report.csv");
    assert.strictEqual(Buffer.from(stored.data, "base64").toString("utf8"), CSV.toString("utf8"));
  });

  await test("route: a plain text/csv upload still works, with a charset parameter too", async () => {
    const { res } = await upload("plain.csv", "text/csv; charset=utf-8", CSV);
    assert.ok(res.status >= 200 && res.status < 300, `status ${res.status}`);
  });

  await test("route: binary content named .csv with the Windows MIME type is rejected with 400 and nothing is stored", async () => {
    for (const bytes of [OLE, ZIP, PDF, EXE]) {
      const { res, calls } = await upload("fake.csv", "application/vnd.ms-excel", bytes);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(calls.updates.length, 0);
    }
  });

  await test("route: the size limit still applies to CSVs (declared size over MAX_FILE_SIZE -> 400, nothing stored)", async () => {
    const { res, calls } = await upload("big.csv", "application/vnd.ms-excel", CSV, MAX_FILE_SIZE + 1);
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /must not exceed/);
    assert.strictEqual(calls.updates.length, 0);
  });

  await test("route: an empty .csv is still rejected", async () => {
    const { res } = await upload("empty.csv", "application/vnd.ms-excel", Buffer.alloc(0));
    assert.strictEqual(res.status, 400);
  });

  await test("both upload paths (existing task and task creation) use the shared policy functions", () => {
    const fs = require("fs");
    const path = require("path");
    for (const f of ["src/app/api/tasks/[id]/attachments/route.js", "src/app/api/tasks/route.js"]) {
      const s = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      assert.match(s, /resolveAttachmentMimeType\(/, f);
      assert.match(s, /validateAttachmentFile\(/, f);
    }
  });

  summary();
})();
