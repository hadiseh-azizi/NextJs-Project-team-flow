import { after } from "next/server";

// L3: runs `task` after the HTTP response has been sent, so work that only
// exists for some inputs (looking the account up, writing a token, talking
// to SMTP) can't be told apart by how long the response took.
//
// `after()` keeps a serverless invocation alive until the task finishes
// (Vercel's waitUntil under the hood), which is why it is used instead of
// a bare un-awaited promise: that can be frozen mid-flight as soon as the
// response is sent.
//
// If `after()` can't be used (called outside a request scope, e.g. from a
// script or a test), the task simply runs to completion before returning -
// slower, never skipped. Failures are logged and never thrown: by this
// point the client already has its answer.
export function runAfterResponse(task, label = "deferred task") {
  const guarded = async () => {
    try {
      await task();
    } catch (err) {
      console.error(`[${label}] failed:`, err);
    }
  };

  if (typeof after === "function") {
    try {
      after(guarded);
      return undefined;
    } catch {
      // fall through to running inline
    }
  }
  return guarded();
}
