// Manual test for the Phase 3 attachment-security fix: the streaming
// size guard in lib/limitedFormData.js. Exercises it directly against
// real Web Request/ReadableStream primitives (available natively in this
// Node version) — no fakes needed, since this module only depends on the
// Fetch API, not on Mongoose/Next.js/next-auth.

require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");
const { readFormDataWithLimit, PayloadTooLargeError } = require("../src/lib/limitedFormData.js");

const BOUNDARY = "----testboundary123";

function multipartBodyBytes(fileBytes, { filename = "test.txt", mimeType = "text/plain" } = {}) {
  const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${BOUNDARY}--\r\n`;
  return Buffer.concat([Buffer.from(head), Buffer.from(fileBytes), Buffer.from(tail)]);
}

// A ReadableStream that yields the given buffer in small chunks, so the
// guard's byte-by-byte accumulation is actually exercised (a single big
// chunk would technically pass but wouldn't prove the loop works).
function chunkedStream(buffer, chunkSize = 1024) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= buffer.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, buffer.length);
      controller.enqueue(new Uint8Array(buffer.subarray(offset, end)));
      offset = end;
    },
  });
}

function makeRequest(buffer, { declareLength = true, chunkSize = 1024 } = {}) {
  const headers = new Headers({ "content-type": `multipart/form-data; boundary=${BOUNDARY}` });
  if (declareLength) headers.set("content-length", String(buffer.length));
  return {
    url: "http://localhost/api/tasks/x/attachments",
    headers,
    body: chunkedStream(buffer, chunkSize),
    // Only exercised on the "no body" test below.
    formData: async () => {
      throw new Error("formData() should not be called directly when a body stream is present");
    },
  };
}

async function run() {
  console.log("Attachment upload — streaming size guard (lib/limitedFormData.js)");

  await test("a normal small upload parses successfully and preserves the file", async () => {
    const body = multipartBodyBytes(Buffer.from("hello world"));
    const req = makeRequest(body);
    const formData = await readFormDataWithLimit(req, 5 * 1024 * 1024);
    const file = formData.get("file");
    assert.ok(file, "expected a file field in the parsed form data");
    const text = await file.text();
    assert.strictEqual(text, "hello world");
  });

  await test("declared Content-Length over the limit is rejected without reading the body", async () => {
    const oneByteOverLimit = 10 * 1024 * 1024 + 1;
    const headers = new Headers({
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "content-length": String(oneByteOverLimit),
    });
    let streamTouched = false;
    const req = {
      url: "http://localhost/api/tasks/x/attachments",
      headers,
      // If the guard reads this before checking Content-Length, the test
      // fails loudly instead of silently passing for the wrong reason.
      get body() {
        streamTouched = true;
        return chunkedStream(Buffer.alloc(0));
      },
    };
    await assert.rejects(() => readFormDataWithLimit(req, 10 * 1024 * 1024), PayloadTooLargeError);
    assert.strictEqual(streamTouched, false, "body stream should never be opened when Content-Length already exceeds the limit");
  });

  await test("actual body size over the limit is rejected even with no Content-Length header", async () => {
    const oversized = Buffer.concat([Buffer.alloc(2 * 1024 * 1024, 65), Buffer.alloc(0)]);
    const body = multipartBodyBytes(oversized);
    const req = makeRequest(body, { declareLength: false });
    await assert.rejects(() => readFormDataWithLimit(req, 1 * 1024 * 1024), PayloadTooLargeError);
  });

  await test("actual body size over the limit is rejected even when the client lies in Content-Length", async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024, 65);
    const body = multipartBodyBytes(oversized);
    const headers = new Headers({ "content-type": `multipart/form-data; boundary=${BOUNDARY}` });
    headers.set("content-length", "10"); // lies — claims the body is tiny
    const req = {
      url: "http://localhost/api/tasks/x/attachments",
      headers,
      body: chunkedStream(body),
    };
    await assert.rejects(() => readFormDataWithLimit(req, 1 * 1024 * 1024), PayloadTooLargeError);
  });

  await test("a file exactly at the limit is accepted", async () => {
    const exact = Buffer.alloc(1024, 65);
    const body = multipartBodyBytes(exact, { filename: "exact.txt" });
    const req = makeRequest(body, { declareLength: false });
    // Give it exactly enough budget for this whole multipart body.
    const formData = await readFormDataWithLimit(req, body.length);
    const file = formData.get("file");
    assert.ok(file, "expected file to be present when body length equals the limit exactly");
  });

  await test("a malformed multipart body still surfaces as an error the route can catch", async () => {
    const garbage = Buffer.from("this is not a valid multipart body");
    const req = {
      url: "http://localhost/api/tasks/x/attachments",
      headers: new Headers({ "content-type": "multipart/form-data; boundary=nope" }),
      body: chunkedStream(garbage),
    };
    let threw = false;
    try {
      await readFormDataWithLimit(req, 5 * 1024 * 1024);
    } catch (err) {
      threw = true;
      assert.ok(!(err instanceof PayloadTooLargeError), "a parse failure should not be misreported as PayloadTooLargeError");
    }
    assert.ok(threw, "expected malformed multipart data to throw");
  });

  await test("a request with no body stream falls through to formData() untouched", async () => {
    const headers = new Headers({ "content-type": "multipart/form-data; boundary=x" });
    let called = false;
    const req = {
      url: "http://localhost/api/tasks/x/attachments",
      headers,
      body: null,
      formData: async () => {
        called = true;
        return new Map();
      },
    };
    await readFormDataWithLimit(req, 5 * 1024 * 1024);
    assert.strictEqual(called, true, "expected the fallback to formData() to be used when there is no body stream");
  });

  summary();
}

run();
