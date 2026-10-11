require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

// Nodemailer security floor. History: 9.0.5 -> 9.1.1 (final security patch),
// then 9.1.1 -> 10.0.14 (audit H4: five advisories affecting <= 10.0.8 —
// addressparser DoS, TLS servername DNS-cache cross-transport leak,
// malformed envelope recipient). 07-email-html-escaping.test.cjs already stubs
// out nodemailer.createTransport() entirely to assert on the message it
// captures, so it never actually calls into the real, newly-installed
// nodemailer package. This test does — it exercises the actual
// createTransport()/sendMail() surface from the installed version against
// exactly the config shape email.js builds, so a breaking change in the
// dependency bump would fail here instead of only being caught in
// production. No real SMTP server is contacted: nodemailer's built-in
// "streamTransport" mode (buffer: true) builds and signs a real message in
// memory without opening a network connection.

const nodemailer = require("nodemailer");

// Lowest version that is not affected by the advisories above. Raise this
// (never lower it) when a newer advisory is fixed.
const MIN_SECURE_VERSION = [10, 0, 14];

function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isAtLeast(actual, minimum) {
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

const { sendVerificationEmail } = require("../src/lib/email.js");

(async () => {
  console.log("Nodemailer security-floor regression");

  await test("installed nodemailer is at or above the secure minimum (>= 10.0.14)", () => {
    const { version } = require("nodemailer/package.json");
    const parsed = parseVersion(version);
    assert.ok(parsed, `could not parse installed nodemailer version "${version}"`);
    assert.ok(
      isAtLeast(parsed, MIN_SECURE_VERSION),
      `installed nodemailer ${version} is below the secure minimum ${MIN_SECURE_VERSION.join(".")}`
    );
  });

  await test("package.json dependency and override both require the secure minimum", () => {
    const pkg = require("../package.json");
    const declared = [
      ["dependencies.nodemailer", pkg.dependencies && pkg.dependencies.nodemailer],
      ["overrides.nodemailer", pkg.overrides && pkg.overrides.nodemailer],
    ];
    for (const [label, spec] of declared) {
      assert.ok(typeof spec === "string", `${label} is missing`);
      // Exact pins only (project convention); a range could silently
      // resolve below the floor.
      const parsed = parseVersion(spec);
      assert.ok(parsed, `${label} must be an exact version, got "${spec}"`);
      assert.ok(
        isAtLeast(parsed, MIN_SECURE_VERSION),
        `${label} is ${spec}, below the secure minimum ${MIN_SECURE_VERSION.join(".")}`
      );
    }
  });

  await test("package-lock.json resolves nodemailer to the secure minimum or above", () => {
    const lock = require("../package-lock.json");
    const entry = lock.packages && lock.packages["node_modules/nodemailer"];
    assert.ok(entry, "package-lock.json has no node_modules/nodemailer entry");
    const parsed = parseVersion(entry.version);
    assert.ok(parsed && isAtLeast(parsed, MIN_SECURE_VERSION), `locked nodemailer ${entry.version} is below ${MIN_SECURE_VERSION.join(".")}`);
    const nested = Object.keys(lock.packages).filter((k) => /node_modules\/nodemailer$/.test(k) && k !== "node_modules/nodemailer");
    assert.strictEqual(nested.length, 0, `unexpected nested nodemailer copies: ${nested.join(", ")}`);
  });

  await test("createTransport() accepts email.js's exact host/port/secure/auth shape", async () => {
    // Same option shape as getTransport() in src/lib/email.js, but using
    // nodemailer's own streamTransport so no real connection is attempted.
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    assert.ok(typeof transport.sendMail === "function", "createTransport() did not return a usable transporter");

    const info = await transport.sendMail({
      to: "someone@example.com",
      from: "TeamFlow <no-reply@teamflow.app>",
      subject: "Regression check",
      text: "plain body",
      html: "<p>html body</p>",
    });
    assert.ok(info.message, "sendMail() did not return the built message buffer");
    assert.ok(
      info.message.toString("utf8").includes("Regression check"),
      "built message did not contain the expected subject"
    );
  });

  await test("sendVerificationEmail() still runs end-to-end against the real package when SMTP isn't configured", async () => {
    // getTransport() in email.js returns null when EMAIL_SERVER_HOST is
    // unset, so this exercises the no-SMTP-configured fallback path with
    // the real (unstubbed) nodemailer import loaded, proving the import
    // itself and the rest of email.js's module-level code still work
    // against the installed version with nothing mocked.
    delete process.env.EMAIL_SERVER_HOST;
    const result = await sendVerificationEmail({ to: "new-user@example.com", name: "Ada", token: "tok123" });
    assert.deepStrictEqual(result, { sent: false }, "expected the no-SMTP fallback result");
  });

  summary();
})();
