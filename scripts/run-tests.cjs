#!/usr/bin/env node
// Runs every standalone test file in __manual_test__/ (the project's only
// test suite - see __manual_test__/README.md), one Node process per file,
// and exits non-zero if any file fails.
//
//   npm test                 run everything
//   npm test -- 35 reorder   run only files whose name contains "35" or "reorder"
//
// Files are discovered by name (NN-*.test.cjs) instead of from a hand-kept
// list, so a new test file can't be silently left out of the run.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const dir = path.join(root, "__manual_test__");
const filters = process.argv.slice(2);
const PER_FILE_TIMEOUT_MS = 5 * 60 * 1000;

const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d+-.*\.test\.cjs$/.test(f))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

if (files.length === 0) {
  console.error("No test files matched.");
  process.exit(1);
}

const failed = [];
const started = Date.now();
for (const f of files) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(dir, f)], {
    cwd: root,
    encoding: "utf8",
    timeout: PER_FILE_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const output = `${res.stdout || ""}${res.stderr || ""}`;
  // Files print "N passed, M failed" (harness.cjs); some log expected errors
  // after it, so look for that line rather than taking the last one.
  const lastLine = (output.match(/^\d+ passed, \d+ failed$/m) || [""])[0];
  const ok = res.status === 0 && !res.error;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}  (${secs}s)  ${ok ? lastLine : ""}`);
  if (!ok) {
    failed.push(f);
    if (res.error) console.log(`      ${res.error.message}`);
    console.log(output.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}

const total = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${files.length - failed.length}/${files.length} files passed in ${total}s`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
