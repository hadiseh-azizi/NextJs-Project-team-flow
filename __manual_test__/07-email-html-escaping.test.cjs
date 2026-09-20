require("./register.cjs");
const { test, summary, assert } = require("./harness.cjs");

// email.js only builds a real transport when EMAIL_SERVER_HOST is set (see
// getTransport()); to observe the exact subject/text/html it hands to
// nodemailer without a real SMTP server, point it at a fake host and stub
// nodemailer.createTransport() to capture the message instead of sending it.
const { sendTeamInviteEmail, sendVerificationEmail } = require("../src/lib/email.js");

const nodemailer = require("nodemailer");
const originalCreateTransport = nodemailer.createTransport;
let lastMail = null;
nodemailer.createTransport = () => ({
  sendMail: async (mail) => {
    lastMail = mail;
    return { messageId: "test" };
  },
});
process.env.EMAIL_SERVER_HOST = "smtp.example.test";

const XSS_NAME = `<img src=x onerror="alert(1)">`;
const XSS_TEAM = `Weird & "Team" <script>alert('x')</script>`;
const QUOTE_NAME = `O'Brien "The Boss"`;
const NEWLINE_TEAM = "Team\r\nBcc: evil@example.com";
const ANGLE_QUOTE_NAME = "Renée «Lead»";

(async () => {
  console.log("sendTeamInviteEmail — HTML escaping");

  await test("script/img tag in inviterName is escaped in HTML body", async () => {
    await sendTeamInviteEmail({ to: "victim@example.com", teamName: "Engineering", inviterName: XSS_NAME });
    assert.ok(!lastMail.html.includes("<img"), "raw <img> tag leaked into HTML");
    assert.ok(lastMail.html.includes("&lt;img"), "escaped form not found in HTML");
  });

  await test("script tag and ampersand/quote in teamName are escaped in HTML body", async () => {
    await sendTeamInviteEmail({ to: "victim@example.com", teamName: XSS_TEAM, inviterName: "Alex" });
    assert.ok(!lastMail.html.includes("<script>"), "raw <script> tag leaked into HTML");
    assert.ok(lastMail.html.includes("&lt;script&gt;"), "escaped script tag not found");
    assert.ok(lastMail.html.includes("&amp;"), "raw & not escaped");
    assert.ok(lastMail.html.includes("&quot;"), "raw \" not escaped");
  });

  await test("single quotes and curly/angle quotes are escaped in HTML body", async () => {
    await sendTeamInviteEmail({ to: "victim@example.com", teamName: "Team «Alpha»", inviterName: QUOTE_NAME });
    assert.ok(!lastMail.html.includes("O'Brien"), "raw apostrophe leaked unescaped");
    assert.ok(lastMail.html.includes("O&#39;Brien"), "escaped apostrophe not found");
    // «» are not HTML-significant characters, so they pass through unescaped —
    // only &, <, >, \", ' need escaping. Just confirm they render at all.
    assert.ok(lastMail.html.includes("«Alpha»"), "non-ASCII quote characters were mangled");
  });

  await test("plaintext body is left as raw text (no double-escaping)", async () => {
    await sendTeamInviteEmail({ to: "victim@example.com", teamName: XSS_TEAM, inviterName: XSS_NAME });
    // The plaintext part is read as-is by mail clients, so it should contain
    // the literal characters, not HTML entities.
    assert.ok(lastMail.text.includes(XSS_TEAM), "plaintext body was unexpectedly escaped");
    assert.ok(lastMail.text.includes(XSS_NAME), "plaintext body was unexpectedly escaped");
  });

  console.log("\nsendTeamInviteEmail — subject / header safety");

  await test("newline in teamName cannot inject a header into the subject", async () => {
    await sendTeamInviteEmail({ to: "victim@example.com", teamName: NEWLINE_TEAM, inviterName: "Alex" });
    // The injected "Bcc:" text itself is harmless once it can no longer
    // start a new header line — the whole point is that it stays folded
    // into the single Subject line rather than being interpretable as a
    // second header by a mail parser.
    assert.ok(!lastMail.subject.includes("\n"), "subject contains a raw newline");
    assert.ok(!lastMail.subject.includes("\r"), "subject contains a raw carriage return");
    assert.strictEqual(lastMail.subject, `Alex invited you to join "Team Bcc: evil@example.com" on TeamFlow`);
  });

  await test("legitimate long-but-normal names still read naturally in the subject", async () => {
    await sendTeamInviteEmail({ to: "victim@example.com", teamName: "Design Team", inviterName: "Alex Rivera" });
    assert.strictEqual(lastMail.subject, `Alex Rivera invited you to join "Design Team" on TeamFlow`);
  });

  console.log("\nsendTeamInviteEmail — links remain intact");

  await test("signup link is a well-formed URL with the recipient email encoded", async () => {
    await sendTeamInviteEmail({ to: "a+test@example.com", teamName: "Engineering", inviterName: "Alex" });
    assert.ok(lastMail.html.includes(`href="http://localhost:3000/register?email=a%2Btest%40example.com"`), "href missing or malformed");
    assert.ok(lastMail.text.includes("http://localhost:3000/register?email=a%2Btest%40example.com"), "plaintext link missing or malformed");
  });

  console.log("\nsendVerificationEmail — regression (already escaped prior to this phase)");

  await test("script tag in name is escaped in HTML body, subject stays static", async () => {
    await sendVerificationEmail({ to: "victim@example.com", name: ANGLE_QUOTE_NAME + "<script>x</script>", token: "abc123" });
    assert.ok(!lastMail.html.includes("<script>x</script>"), "raw <script> tag leaked into HTML");
    assert.strictEqual(lastMail.subject, "Confirm your email for TeamFlow");
  });

  await test("verification link encodes the token safely and is not attribute-breaking", async () => {
    await sendVerificationEmail({ to: "victim@example.com", name: "Alex", token: `"><script>alert(1)</script>` });
    assert.ok(!lastMail.html.includes(`"><script>alert(1)</script>`), "raw token characters broke out of the href attribute");
    assert.ok(lastMail.html.includes(encodeURIComponent(`"><script>alert(1)</script>`)), "token was not properly URL-encoded");
  });

  nodemailer.createTransport = originalCreateTransport;
  summary();
})();
