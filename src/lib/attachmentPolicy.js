// Shared rules + helpers for task attachments, used by both the upload
// route and the attachment-by-id route (download/delete). Kept in one
// place so the limits enforced server-side can never drift between the
// two routes.

const MB = 1024 * 1024;

// Deployment constraint — Vercel Functions reject any request body, and
// any non-streamed response body, larger than 4.5 MB (a request over the
// limit is answered by the platform itself with a 413
// FUNCTION_PAYLOAD_TOO_LARGE before this app's code ever runs; an
// oversized response becomes a 500). The docs don't say whether "MB" means
// 10^6 or 2^20 bytes, so the stricter reading (4,500,000 bytes) is used
// here. Every request-size budget below must stay under this with room to
// spare — __manual_test__/48-vercel-body-limits-h5.test.cjs enforces that.
export const PLATFORM_BODY_LIMIT_BYTES = 4_500_000;

// What counts toward these limits: files travel as raw binary parts of a
// multipart/form-data body (upload) or as raw bytes in the response
// (download) — never as base64 over the wire. So the platform limit is
// measured against raw file size plus a little multipart framing, and the
// ~33% base64 inflation only applies to what is stored in MongoDB
// (see the per-task total below), not to request/response bodies.
//
// Architecture note: attachments are stored as base64 inside the Task
// document itself (see models/Task.js) rather than in an external object
// store. For a project of this size that's a reasonable, self-contained
// choice — it needs no extra service, no extra credentials, and no extra
// deployment step — but it borrows the *whole document's* budget from
// MongoDB's hard 16MB-per-document BSON limit, and base64 inflates raw
// bytes by ~33%. The per-task total below exists to keep a Task document
// safely inside that ceiling even with several attachments.

// Per file, raw bytes. 4 MiB + the 64 KiB multipart allowance below is
// 4,259,840 bytes: ~240 KB under the platform limit.
export const MAX_FILE_SIZE = 4 * MB;

// Schema-level ceiling for an already-STORED attachment (models/Task.js).
// Deliberately NOT lowered with MAX_FILE_SIZE: attachments uploaded under
// the earlier 5 MiB limit still exist in the database, and Mongoose
// re-validates every loaded attachment subdocument whenever its task is
// saved (rename, move, complete, ...). A lower ceiling here would make
// those saves fail for any task holding such a file. New uploads are held
// to MAX_FILE_SIZE by the routes, which is what the platform limit needs.
export const MAX_STORED_FILE_SIZE = 5 * MB;

// Total raw attachment data a task may hold across all of its uploads
// (each upload is its own request, so this is a storage limit, not a
// request limit). 8 MiB of raw data encodes to ~10.7 MB of base64, which
// leaves multiple MB of headroom under the 16MB BSON limit.
export const MAX_TOTAL_ATTACHMENTS_SIZE = 8 * MB; // 8MB per task

// Total raw file data that can ride along in ONE task-creation request.
// Unlike MAX_TOTAL_ATTACHMENTS_SIZE this *is* a request-size limit: every
// file is in the same body, so the platform limit applies to their sum.
// More files can still be added afterwards, one request each, up to the
// per-task total above.
export const MAX_CREATE_ATTACHMENTS_SIZE = 4 * MB;

// A separate cap on *count*, independent of total size — without it nothing
// stops a task from accumulating hundreds of tiny files, which bloats the
// document's array overhead and makes the task detail view unwieldy.
export const MAX_ATTACHMENTS_PER_TASK = 20;

// Budget for the *entire* upload request body, used to reject an
// oversized request before it's fully read (see lib/limitedFormData.js) —
// not just to re-check a file's size after the fact. This has to be a bit
// larger than MAX_FILE_SIZE itself: a multipart body also carries the
// boundary delimiters, per-part headers, and the (already length-capped)
// filename, which add a small, bounded amount of overhead on top of the
// raw file bytes (well under 1 KB in practice). 64KB is generous for that
// overhead for the single-file uploads this endpoint accepts, while still
// keeping the effective limit on actual file content essentially at
// MAX_FILE_SIZE.
const MULTIPART_OVERHEAD_ALLOWANCE = 64 * 1024;
export const MAX_UPLOAD_REQUEST_SIZE = MAX_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE;

// Budget for the entire multipart request body when a task is created
// with attachments already attached (see the create-time upload path in
// app/api/tasks/route.js): the files themselves, plus a per-part allowance
// for multipart boundaries/headers across up to MAX_ATTACHMENTS_PER_TASK
// parts, plus room for the "data" field (the task's own JSON: title,
// description up to 5000 chars at up to 3 bytes each in UTF-8, assignees).
const CREATE_MULTIPART_OVERHEAD_ALLOWANCE = MAX_ATTACHMENTS_PER_TASK * 2 * 1024;
const CREATE_JSON_FIELD_ALLOWANCE = 64 * 1024;
export const MAX_CREATE_UPLOAD_REQUEST_SIZE =
  MAX_CREATE_ATTACHMENTS_SIZE + CREATE_MULTIPART_OVERHEAD_ALLOWANCE + CREATE_JSON_FIELD_ALLOWANCE;

// Human-readable limits for error messages / UI copy, derived from the
// constants above so the text can never disagree with what is enforced.
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / MB;
export const MAX_TOTAL_ATTACHMENTS_SIZE_MB = MAX_TOTAL_ATTACHMENTS_SIZE / MB;
export const MAX_CREATE_ATTACHMENTS_SIZE_MB = MAX_CREATE_ATTACHMENTS_SIZE / MB;

const MAX_FILENAME_LENGTH = 150;

// Source-code / plain-text-based file types that can be attached alongside
// the business documents below. Browsers are wildly inconsistent about the
// MIME type they report for these (".py" is often "" or "text/x-python",
// ".ts" is commonly reported as "video/mp2t", ".md" as "" or
// "text/markdown"), so for these extensions the *server* decides the type
// from the extension and ignores whatever the client declared — see
// resolveAttachmentMimeType(). They're always stored and served as
// "text/plain", never as their "real" type (e.g. text/html), so a download
// or direct link can never be interpreted as a script or a page. ".txt" is
// intentionally not in this list: it was already supported and keeps its
// original strict MIME check.
export const CODE_EXTENSIONS = [
  ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".php", ".rb", ".go", ".rs", ".swift", ".kt", ".kts", ".html",
  ".css", ".scss", ".sql", ".json", ".xml", ".yaml", ".yml", ".md",
];
const CODE_EXTENSION_SET = new Set(CODE_EXTENSIONS);

// Conservative allowlist of normal business/productivity file types plus
// the source-code types above. Keyed by MIME type, each with the extensions
// it's allowed to pair with — both must match, so a script renamed to
// ".pdf" or served with a spoofed MIME type is rejected either way.
export const ALLOWED_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "text/plain": [".txt", ...CODE_EXTENSIONS],
  "text/csv": [".csv"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
};

// Human-readable summary for error messages / UI copy.
export const ALLOWED_TYPES_SUMMARY =
  "PDF, images (PNG, JPEG, GIF, WebP), TXT, CSV, Office documents, and source code (.py, .js, .ts, .java, .cpp, .json, .md and more)";

// Value for <input type="file" accept="...">. Derived from the allowlist so
// the picker can't drift from what the server accepts. It's only a hint to
// the browser — the server re-validates everything.
export const ATTACHMENT_ACCEPT = Object.values(ALLOWED_TYPES).flat().join(",");

function getExtension(filename) {
  const match = /\.[^./\\]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

// MIME types browsers are known to report for a genuine ".csv" file.
// Chrome/Edge on Windows with Excel installed report CSVs as
// "application/vnd.ms-excel" (the type Windows associates with the
// extension), and other platforms/browsers use the older text/* and
// application/* aliases. Deliberately narrow: an empty type,
// "application/octet-stream" or an unrelated type (e.g. "application/pdf")
// on a ".csv" is still rejected rather than guessed at.
const CSV_DECLARED_MIME_ALIASES = new Set([
  "text/csv",
  "application/csv",
  "text/x-csv",
  "application/x-csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
]);

// Canonical MIME type to validate and store for an upload. For source-code
// extensions the client-declared type is unreliable (see CODE_EXTENSIONS),
// so it's replaced with "text/plain". For ".csv" the declared type is
// normalised to "text/csv" only when it is one of the known browser
// aliases above; the bytes are then still checked by validateAttachmentFile
// (the declared type alone never decides acceptance). For every other
// type the declared type is returned unchanged and must still match the
// extension.
export function resolveAttachmentMimeType(filename, declaredMimeType) {
  const ext = getExtension(filename);
  if (CODE_EXTENSION_SET.has(ext)) return "text/plain";
  if (ext === ".csv" && CSV_DECLARED_MIME_ALIASES.has(declaredMimeType)) return "text/csv";
  return declaredMimeType;
}

// Extension-only check used by the UI to give an immediate, specific error
// before anything is uploaded. Not a security boundary — the server runs
// validateAttachmentFile() on every upload regardless.
export function isAllowedAttachmentExtension(filename) {
  const ext = getExtension(filename);
  return !!ext && Object.values(ALLOWED_TYPES).some((exts) => exts.includes(ext));
}

// Strips path components and anything that isn't safe to store or to echo
// back later in a Content-Disposition header — control characters,
// quotes, and backslashes/slashes (which some clients send the full path
// in, e.g. old IE, or a hand-crafted request). Falls back to a generic
// name if nothing usable is left, and caps length so an absurd filename
// can't bloat the stored metadata.
export function sanitizeFilename(rawName) {
  const base = String(rawName || "")
    .split(/[/\\]/)
    .pop() // drop any path prefix, keep just the last segment
    .replace(/[\u0000-\u001f\u007f"\\]/g, "") // control chars, quotes, backslashes
    .trim();

  const cleaned = base || "file";
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;

  // Truncate from the middle of the name, keeping the extension intact.
  const ext = getExtension(cleaned);
  const stem = ext ? cleaned.slice(0, -ext.length) : cleaned;
  return stem.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
}

function extensionMatchesMime(filename, mimeType) {
  const allowedExtensions = ALLOWED_TYPES[mimeType];
  if (!allowedExtensions) return false;
  return allowedExtensions.includes(getExtension(filename));
}

// Magic-byte signatures for the binary formats in the allowlist. This
// catches the common case of a client lying about a file's MIME type (or
// a browser guessing wrong) for formats where the actual bytes on disk
// give it away. Zip-based Office formats (.docx/.xlsx/.pptx) and the
// legacy OLE-based ones (.doc/.xls/.ppt) all share one container signature
// per family — fully distinguishing between, say, a .docx and a .xlsx
// would mean parsing the zip's internal manifest, which isn't practical
// here and isn't a meaningful security boundary anyway since both are
// already on the allowlist. Plain-text formats (.txt/.csv) have no magic
// number by design, so they're checked with a lighter heuristic instead.
const ZIP_OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const OLE_OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

function bufferStartsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function looksLikeText(buffer) {
  // A real text file shouldn't contain NUL bytes. This won't catch every
  // mislabeled binary, but it rejects the obvious case of an arbitrary
  // binary renamed to ".txt"/".csv" to slip past the extension+MIME check.
  const sampleLength = Math.min(buffer.length, 8000);
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0) return false;
  }
  return true;
}

// Leading bytes of binary formats a mislabeled file would start with.
// Used for ".csv" because its declared type can legitimately be
// "application/vnd.ms-excel", the same type real binary .xls files carry
// - so a spreadsheet, archive or image renamed to ".csv" must be refused on
// content, not on the declared type.
const BINARY_SIGNATURES = [
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE2 (.xls/.doc/.ppt)
  [0x50, 0x4b, 0x03, 0x04], // zip container (.xlsx/.docx/.pptx/.zip)
  [0x50, 0x4b, 0x05, 0x06], // empty zip
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x52, 0x49, 0x46, 0x46], // RIFF (WebP/WAV/AVI)
  [0x4d, 0x5a], // "MZ" - Windows executable
  [0x7f, 0x45, 0x4c, 0x46], // ELF executable
];

function looksLikeCsv(buffer) {
  if (!looksLikeText(buffer)) return false;
  return !BINARY_SIGNATURES.some((sig) => bufferStartsWith(buffer, sig));
}

function matchesSignature(buffer, mimeType) {
  switch (mimeType) {
    case "image/png":
      return bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return bufferStartsWith(buffer, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    case "image/webp":
      return bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && bufferStartsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf":
      return bufferStartsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
    case "text/plain":
      return looksLikeText(buffer);
    case "text/csv":
      return looksLikeCsv(buffer);
    default:
      if (ZIP_OFFICE_MIMES.has(mimeType)) {
        // Local file header "PK\x03\x04" — an empty/edge-case zip using
        // "PK\x05\x06" is vanishingly unlikely for a real Office file, so
        // it isn't accepted here.
        return bufferStartsWith(buffer, [0x50, 0x4b, 0x03, 0x04]);
      }
      if (OLE_OFFICE_MIMES.has(mimeType)) {
        return bufferStartsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      }
      return false;
  }
}

// Full validation pass for an incoming upload: extension/MIME pairing
// plus, where a real signature exists for the format, the file's actual
// bytes. Returns `{ ok: true }` or `{ ok: false, error }` with a message
// safe to show the user.
export function validateAttachmentFile(filename, mimeType, buffer) {
  if (!extensionMatchesMime(filename, mimeType)) {
    return { ok: false, error: `Unsupported file type. Allowed: ${ALLOWED_TYPES_SUMMARY}.` };
  }
  if (!matchesSignature(buffer, mimeType)) {
    return { ok: false, error: "This file's contents don't match its file type. It may be corrupted or mislabeled." };
  }
  return { ok: true };
}

// Percent-encodes a value for the RFC 5987 / RFC 8187 `ext-value` used by
// `filename*`. The only characters allowed to stay literal are the
// RFC 5987 `attr-char` set: ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" /
// "-" / "." / "^" / "_" / "`" / "|" / "~". encodeURIComponent() is close
// but leaves "'" "(" ")" "*" unescaped, and "'" in particular is the
// delimiter between the charset, language and value parts of an
// ext-value, so it has to be escaped. It also throws on a lone UTF-16
// surrogate, which a filename can contain; those become U+FFFD first so a
// strange name can never turn a download into a 500.
export function encodeRfc5987(value) {
  const wellFormed = String(value).replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  return encodeURIComponent(wellFormed).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Builds a Content-Disposition header value that's safe regardless of what
// characters are in the (already-sanitized) filename: an ASCII-only
// fallback for older clients, plus an RFC 5987 `filename*` for everyone
// else so non-ASCII names still display correctly instead of as literal
// percent-escapes. The fallback is a quoted-string, so a quote or
// backslash is never allowed through in it (sanitizeFilename() already
// strips both; this keeps the header safe if it is ever called without it).
export function buildContentDisposition(filename) {
  const asciiFallback = filename.replace(/["\\]/g, "_").replace(/[^\x20-\x7e]/gu, "_") || "file";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
