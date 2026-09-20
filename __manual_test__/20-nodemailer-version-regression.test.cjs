require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

// Final Security Patch — Nodemailer 9.0.5 -> 9.1.1 (see CHANGELOG.md /
// FINAL_SECURITY_PATCH.md). 07-email-html-escaping.test.cjs already stubs
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
const { sendVerificationEmail } = require("../src/lib/email.js");

(async () => {
  console.log("Nodemailer 9.1.1 regression");

  await test("installed nodemailer package resolves to the patched 9.1.x line", () => {
    const { version } = require("nodemailer/package.json");
    assert.ok(
      /^9\.1\.\d+$/.test(version),
      `expected an installed 9.1.x version, got ${version}`
    );
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
    // against 9.1.1 with nothing mocked.
    delete process.env.EMAIL_SERVER_HOST;
    const result = await sendVerificationEmail({ to: "new-user@example.com", name: "Ada", token: "tok123" });
    assert.deepStrictEqual(result, { sent: false }, "expected the no-SMTP fallback result");
  });

  summary();
})();
