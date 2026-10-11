import crypto from "crypto";
import nodemailer from "nodemailer";
import { BRAND } from "@/lib/brand";

// Email clients ignore CSS variables, so the templates inline the light-mode
// brand tokens from lib/brand.js instead of carrying colors of their own.
const MAIL = {
  text: BRAND.light.text,
  muted: BRAND.light.textSecondary,
  primary: BRAND.light.primary,
  onPrimary: BRAND.light.onPrimary,
};

// Every failure from this module is an EmailError, so callers (and logs) see
// one consistent shape instead of whatever nodemailer or the URL parser threw.
// `code` is one of:
//   EMAIL_CONFIG    — the app is misconfigured (e.g. no usable NEXTAUTH_URL in
//                     production); nothing was sent
//   SMTP_TIMEOUT    — the server was too slow (see SMTP_TIMEOUTS_MS below)
//   SMTP_CONNECTION — could not reach or talk to the SMTP server
//   SMTP_AUTH       — the server rejected the SMTP credentials
//   SMTP_REJECTED   — the server refused the message or recipient
//   SMTP_ERROR      — anything else from the SMTP layer
// Messages never include credentials, the recipient, or the raw library
// error, so it is safe for callers to log them as-is.
export class EmailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EmailError";
    this.code = code;
  }
}

const DEV_APP_URL = "http://localhost:3000";

function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

let warnedInsecureProductionUrl = false;

// NEXTAUTH_URL is the public origin of the app (e.g. "https://app.example.com")
// and is what every emailed link (verification, password reset, invitation)
// is built from. A link pointing somewhere the recipient can't open is worse
// than no email, so:
//   - development / test: a missing or malformed value falls back to
//     http://localhost:3000, which is what `npm run dev` serves;
//   - production: a missing, malformed, non-http(s) or loopback value throws
//     an EmailError before anything is sent. Called lazily (at send time,
//     never at import) so `next build` still works without it.
// The offending value is deliberately not echoed back in the error.
export function getAppUrl() {
  const isProduction = process.env.NODE_ENV === "production";
  const configured = (process.env.NEXTAUTH_URL || "").trim();

  if (!configured) {
    if (!isProduction) return DEV_APP_URL;
    throw new EmailError(
      "EMAIL_CONFIG",
      "NEXTAUTH_URL is not set. In production it must be the public origin of this app (e.g. https://app.example.com); emailed links cannot be built without it."
    );
  }

  let url;
  try {
    url = new URL(configured);
  } catch {
    url = null;
  }
  const usable = url && (url.protocol === "https:" || url.protocol === "http:");

  if (!usable) {
    if (!isProduction) {
      console.warn("[email] NEXTAUTH_URL is not a valid http(s) URL — falling back to http://localhost:3000.");
      return DEV_APP_URL;
    }
    throw new EmailError(
      "EMAIL_CONFIG",
      "NEXTAUTH_URL is not a valid http(s) URL. In production it must be the public origin of this app (e.g. https://app.example.com)."
    );
  }

  if (isProduction) {
    if (isLoopbackHost(url.hostname)) {
      throw new EmailError(
        "EMAIL_CONFIG",
        "NEXTAUTH_URL points at a local address. In production it must be the public origin of this app, otherwise emailed links cannot be opened by recipients."
      );
    }
    if (url.protocol === "http:" && !warnedInsecureProductionUrl) {
      warnedInsecureProductionUrl = true;
      console.warn("[email] NEXTAUTH_URL uses http:// in production — emailed verification and reset links will not be encrypted in transit.");
    }
  }

  return url.origin;
}

// Minimal HTML-escaping for user-supplied text (e.g. a display name or team
// name) that gets interpolated into an HTML email body. Order matters: `&`
// must be escaped first, or the ampersands introduced by the later
// replacements would themselves get escaped.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Defense-in-depth for text that flows into a header (currently: the
// invite email's Subject line, which embeds a user-controlled team name and
// inviter name). Nodemailer already collapses \r\n in header values before
// it writes them to the wire, so this isn't reachable as a real header
// injection today — but the subject shouldn't silently render a newline the
// sender never intended, and building the subject shouldn't depend on a
// downstream library's escaping to stay safe. Collapses any run of
// whitespace (including newlines) to a single space and trims the ends.
function sanitizeForHeader(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

// Uses plain SMTP so it works with whatever the person already has access
// to — a Gmail account with an app password, a free Mailtrap/SendGrid SMTP
// relay, etc. — rather than locking the project into one specific email API.
//
// Nodemailer's own defaults are a 2-minute connect timeout, a 30-second
// greeting timeout and a 10-minute socket timeout — far longer than a
// serverless function is allowed to run, so a slow or black-holed SMTP host
// would hold the request open until the platform kills it. These are
// code constants rather than env vars on purpose: they only need to be
// tighter than the platform's limit, not tuned per deployment.
//   - connection / greeting / dns: each phase of establishing the session
//   - socket: max silence once connected (it measures inactivity, so a
//     server that trickles bytes could outlast it — hence the deadline below)
//   - SEND_DEADLINE_MS: hard ceiling on the whole send, whatever phase it is in
const SMTP_TIMEOUTS_MS = {
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  dnsTimeout: 5000,
  socketTimeout: 8000,
};
const SEND_DEADLINE_MS = 10000;

// The transport is built once per server instance and reused for as long as
// the SMTP settings stay the same, instead of being re-created for every
// email. This is not a connection pool (`pool: true` is deliberately off):
// a serverless instance is frozen between requests, so a pooled idle socket
// would come back dead. Each message still opens its own short-lived
// connection, which is the right behavior there. The settings are compared
// through a hash so the password isn't kept as a second plaintext copy.
let cachedTransport = null; // { key, transport }

function getTransport() {
  const { EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD } = process.env;
  if (!EMAIL_SERVER_HOST) return null;

  const port = Number(EMAIL_SERVER_PORT) || 587;
  const key = crypto
    .createHash("sha256")
    .update(JSON.stringify([EMAIL_SERVER_HOST, port, EMAIL_SERVER_USER || "", EMAIL_SERVER_PASSWORD || ""]))
    .digest("hex");
  if (cachedTransport?.key === key) return cachedTransport.transport;

  const transport = nodemailer.createTransport({
    host: EMAIL_SERVER_HOST,
    port,
    secure: port === 465,
    auth: EMAIL_SERVER_USER ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD } : undefined,
    ...SMTP_TIMEOUTS_MS,
  });
  cachedTransport = { key, transport };
  return transport;
}

// Maps whatever nodemailer threw onto an EmailError with a message that is
// safe to log (no credentials, no recipient, no raw server response).
function toEmailError(err) {
  const smtpCode = typeof err?.code === "string" ? err.code : "";
  const reply = Number(err?.responseCode) || 0;
  const target = `${process.env.EMAIL_SERVER_HOST}:${Number(process.env.EMAIL_SERVER_PORT) || 587}`;

  if (err instanceof EmailError) return err;
  if (smtpCode === "ETIMEDOUT" || /time(d)? ?out/i.test(String(err?.message || ""))) {
    return new EmailError("SMTP_TIMEOUT", `SMTP server ${target} did not respond in time.`);
  }
  if (smtpCode === "EAUTH") {
    return new EmailError("SMTP_AUTH", `SMTP server ${target} rejected the configured credentials.`);
  }
  if (["ECONNECTION", "ESOCKET", "EDNS", "ETLS", "EPROTOCOL", "EREQUIRETLS", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"].includes(smtpCode)) {
    return new EmailError("SMTP_CONNECTION", `Could not connect to SMTP server ${target} (${smtpCode}).`);
  }
  if (smtpCode === "EENVELOPE" || smtpCode === "EMESSAGE" || (reply >= 400 && reply < 600)) {
    return new EmailError("SMTP_REJECTED", `SMTP server ${target} rejected the message${reply ? ` (reply ${reply})` : ""}.`);
  }
  return new EmailError("SMTP_ERROR", `SMTP send failed${smtpCode ? ` (${smtpCode})` : ""}.`);
}

// Rejects with SMTP_TIMEOUT if `promise` hasn't settled within `ms`. The
// timer is always cleared, and the abandoned promise gets a no-op catch so a
// late rejection from nodemailer can't surface as an unhandled rejection.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new EmailError("SMTP_TIMEOUT", `SMTP server ${process.env.EMAIL_SERVER_HOST} did not finish sending within ${ms / 1000}s.`));
    }, ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// No SMTP configured (e.g. local dev without a mail provider set up yet) —
// don't fail the whole request, just skip sending and log it so the
// calling code (registration, invites) can still proceed.
//
// Throws EmailError when SMTP *is* configured but sending fails. Every
// caller sends after its database write has committed and treats a failure
// as best-effort (logs it, still answers with the committed result), so an
// SMTP problem never rolls back or misreports the write that came before it.
async function send({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    // No SMTP configured — most likely local dev without a mail provider
    // set up yet. Print the actual message (which includes the link) so
    // whoever's testing can still copy it out of the terminal instead of
    // being locked out entirely.
    console.warn(`\n[email] SMTP not configured — printing message instead of sending it.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { sent: false };
  }
  try {
    await withDeadline(
      transport.sendMail({
        to,
        from: process.env.EMAIL_FROM || "TeamFlow <no-reply@teamflow.app>",
        subject,
        text,
        html,
      }),
      SEND_DEADLINE_MS
    );
  } catch (err) {
    throw toEmailError(err);
  }
  return { sent: true };
}

export async function sendTeamInviteEmail({ to, teamName, inviterName }) {
  const appUrl = getAppUrl();
  const signupUrl = `${appUrl}/register?email=${encodeURIComponent(to)}`;
  const loginUrl = `${appUrl}/login`;

  // teamName and inviterName are both user-supplied (a team's name is set
  // by whoever created it; a display name is set at registration), so
  // every place either one is interpolated needs the escaping appropriate
  // to that context: header-safe text for the subject, HTML-escaped for
  // the HTML body. The plaintext body needs neither — it's rendered as-is
  // by the mail client, so raw text is correct there.
  const safeSubjectTeamName = sanitizeForHeader(teamName);
  const safeSubjectInviterName = sanitizeForHeader(inviterName);
  const safeHtmlTeamName = escapeHtml(teamName);
  const safeHtmlInviterName = escapeHtml(inviterName);

  const subject = `${safeSubjectInviterName} invited you to join "${safeSubjectTeamName}" on TeamFlow`;
  const text = `${inviterName} invited you to join the team "${teamName}" on TeamFlow.\n\nNew to TeamFlow? Create an account with this email address and you'll be added automatically:\n${signupUrl}\n\nAlready have an account? Sign in and accept the invitation from your Teams page:\n${loginUrl}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; color: ${MAIL.text}; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:${MAIL.primary};">.</span></p>
      <p><strong>${safeHtmlInviterName}</strong> invited you to join the team <strong>${safeHtmlTeamName}</strong> on TeamFlow.</p>
      <p>
        <a href="${signupUrl}" style="display:inline-block; background:${MAIL.primary}; color:${MAIL.onPrimary}; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Create your account
        </a>
      </p>
      <p style="color:${MAIL.muted}; font-size: 13px;">You'll be added to "${safeHtmlTeamName}" automatically as soon as you sign up with this email address. Already have an account? <a href="${loginUrl}" style="color:${MAIL.muted};">Sign in</a> and accept the invitation from your Teams page.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export async function sendPasswordResetEmail({ to, name, token }) {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name);

  const subject = "Reset Your Password";
  const text = `Hi ${name},\n\nWe received a request to reset the password for your TeamFlow account. Use the link below to choose a new password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password won't be changed.`;
  const html = `
    <div style="font-family: sans-serif; color: ${MAIL.text}; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:${MAIL.primary};">.</span></p>
      <p>Hi ${safeName},</p>
      <p>We received a request to reset the password for your account. Click below to choose a new one.</p>
      <p>
        <a href="${resetUrl}" style="display:inline-block; background:${MAIL.primary}; color:${MAIL.onPrimary}; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Reset my password
        </a>
      </p>
      <p style="color:${MAIL.muted}; font-size: 13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export async function sendVerificationEmail({ to, name, token }) {
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name);

  const subject = "Confirm your email for TeamFlow";
  const text = `Hi ${name},\n\nConfirm your email address to activate your TeamFlow account:\n${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; color: ${MAIL.text}; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:${MAIL.primary};">.</span></p>
      <p>Hi ${safeName},</p>
      <p>Confirm your email address to activate your account and sign in.</p>
      <p>
        <a href="${verifyUrl}" style="display:inline-block; background:${MAIL.primary}; color:${MAIL.onPrimary}; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Verify my email
        </a>
      </p>
      <p style="color:${MAIL.muted}; font-size: 13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}
