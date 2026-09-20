// A size-capped alternative to calling `req.formData()` directly.
//
// The problem with `req.formData()` on its own: it has to read and fully
// parse the request body before it returns anything, so by the time a
// route can check `file.size` against a limit, an oversized upload has
// already been received and held in memory in full — the check happens
// after the expensive/dangerous part, not before it.
//
// This reads the body as a stream instead, counting bytes as they arrive,
// and aborts the read the moment the total crosses `maxBytes` — before
// the rest of an oversized body is ever pulled off the wire. Only once
// the body is confirmed to be within budget does it get handed to the
// platform's own multipart parser (via a freshly constructed `Request`),
// so boundary/part parsing itself is untouched — this only changes how
// the bytes are collected first.

export class PayloadTooLargeError extends Error {
  constructor(message = "The request body is too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

// `req` is a standard (Web) Request / NextRequest. `maxBytes` is the
// total request-body budget — for a single-file upload endpoint that
// should be the per-file limit plus a small allowance for multipart
// overhead (boundaries, part headers, the filename), not the raw file
// limit itself.
export async function readFormDataWithLimit(req, maxBytes) {
  // Fast path: a normal client (every browser, and any well-behaved
  // script) sends Content-Length up front. When it's present and already
  // over budget, reject without reading a single byte of the body.
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }

  // No body stream (e.g. a genuinely empty request) — nothing to guard,
  // let formData() itself produce whatever "empty body" behavior it
  // normally would (the caller's existing try/catch handles that).
  const reader = req.body?.getReader();
  if (!reader) return req.formData();

  const chunks = [];
  let total = 0;

  // Content-Length can be absent (e.g. chunked transfer-encoding), or a
  // client can simply lie about it — the declared-length check above is
  // an optimization, not the actual guarantee. This loop is the real
  // enforcement: it never trusts anything the client claims about size,
  // only what actually arrives.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Stop pulling further data from the client immediately rather
      // than draining the rest of an oversized body just to discard it.
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Only the content type (which carries the multipart boundary) is
  // needed for parsing — rebuilding headers from scratch avoids carrying
  // over anything (e.g. the original Content-Length) that could now be
  // inconsistent with the buffered body.
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const bufferedRequest = new Request(req.url, {
    method: "POST",
    headers,
    body,
  });
  return bufferedRequest.formData();
}
