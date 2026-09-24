// Shared rules + helpers for task attachments, used by both the upload
// route and the attachment-by-id route (download/delete). Kept in one
// place so the limits enforced server-side can never drift between the
// two routes.
//
// Architecture note: attachments are stored as base64 inside the Task
// document itself (see models/Task.js) rather than in an external object
// store. For a project of this size that's a reasonable, self-contained
// choice — it needs no extra service, no extra credentials, and no extra
// deployment step — but it borrows the *whole document's* budget from
// MongoDB's hard 16MB-per-document BSON limit, and base64 inflates raw
// bytes by ~33%. Every limit below exists to keep a Task document safely
// inside that ceiling even with several attachments, a full activity
// history of fields, and future growth in mind.

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file, raw bytes

// 8MB of raw attachment data encodes to ~10.9MB of base64. Combined with
// the rest of a task's fields (title, description, assignees, etc. — all
// tiny by comparison), that leaves multiple MB of headroom under the 16MB
// BSON limit.
export const MAX_TOTAL_ATTACHMENTS_SIZE = 8 * 1024 * 1024; // 8MB per task

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
// raw file bytes. 64KB is generous for that overhead for the single-file
// uploads this endpoint accepts, while still keeping the effective limit
// on actual file content essentially at MAX_FILE_SIZE.
const MULTIPART_OVERHEAD_ALLOWANCE = 64 * 1024;
export const MAX_UPLOAD_REQUEST_SIZE = MAX_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE;

const MAX_FILENAME_LENGTH = 150;

// Conservative allowlist of normal business/productivity file types. Keyed
// by MIME type, each with the extensions it's allowed to pair with — both
// must match, so a script renamed to ".pdf" or served with a spoofed MIME
// type is rejected either way.
export const ALLOWED_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  // .py has no single standard browser-reported MIME type — depending on
  // the OS's mime database, browsers send "text/x-python", fall back to
  // the generic "text/plain", or (commonly, since most OSes don't
  // register a mapping for .py at all) send an empty string. All three
  // are accepted here, paired only with the ".py" extension, so this
  // doesn't loosen validation for anything else.
  "text/plain": [".txt", ".py"],
  "text/x-python": [".py"],
  "": [".py"],
  "text/csv": [".csv"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
};

// Human-readable summary for error messages / UI copy, derived from the
// allowlist above so it can't fall out of sync with it.
export const ALLOWED_TYPES_SUMMARY = "PDF, PNG, JPEG, GIF, WebP, TXT, CSV, Python (.py), and common Office documents";

function getExtension(filename) {
  const match = /\.[^./\\]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
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
    case "text/csv":
    case "text/x-python":
    case "":
      // Same rationale as .txt/.csv above: plain source code has no magic
      // number, so the byte-level check is the same "no NUL bytes" text
      // heuristic rather than a signature match.
      return looksLikeText(buffer);
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

// Builds a Content-Disposition header value that's safe regardless of what
// characters are in the (already-sanitized) filename: an ASCII-only
// fallback for older clients, plus an RFC 5987 `filename*` for everyone
// else so non-ASCII names still display correctly instead of as literal
// percent-escapes.
export function buildContentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_") || "file";
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
