import nodemailer from "nodemailer";

// NEXTAUTH_URL is meant to be an absolute origin (e.g. "https://app.example.com").
// Validate it rather than trusting it blindly into a link we email out —
// a malformed value falls back to localhost instead of producing a broken
// or unexpectedly-scoped link.
function getAppUrl() {
  const configured = process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn(`[email] NEXTAUTH_URL "${configured}" is not a valid URL — falling back to localhost.`);
    }
  }
  return "http://localhost:3000";
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
function getTransport() {
  const { EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD } = process.env;
  if (!EMAIL_SERVER_HOST) return null;

  return nodemailer.createTransport({
    host: EMAIL_SERVER_HOST,
    port: Number(EMAIL_SERVER_PORT) || 587,
    secure: Number(EMAIL_SERVER_PORT) === 465,
    auth: EMAIL_SERVER_USER ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD } : undefined,
  });
}

// No SMTP configured (e.g. local dev without a mail provider set up yet) —
// don't fail the whole request, just skip sending and log it so the
// calling code (registration, invites) can still proceed.
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
  await transport.sendMail({
    to,
    from: process.env.EMAIL_FROM || "TeamFlow <no-reply@teamflow.app>",
    subject,
    text,
    html,
  });
  return { sent: true };
}

export async function sendTeamInviteEmail({ to, teamName, inviterName }) {
  const appUrl = getAppUrl();
  const signupUrl = `${appUrl}/register?email=${encodeURIComponent(to)}`;

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
  const text = `${inviterName} invited you to join the team "${teamName}" on TeamFlow.\n\nCreate an account to join automatically:\n${signupUrl}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; color: #221F2E; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:#A8752E;">.</span></p>
      <p><strong>${safeHtmlInviterName}</strong> invited you to join the team <strong>${safeHtmlTeamName}</strong> on TeamFlow.</p>
      <p>
        <a href="${signupUrl}" style="display:inline-block; background:#A8752E; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Create your account
        </a>
      </p>
      <p style="color:#786F94; font-size: 13px;">You'll be added to "${safeHtmlTeamName}" automatically as soon as you sign up with this email address.</p>
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
    <div style="font-family: sans-serif; color: #221F2E; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:#A8752E;">.</span></p>
      <p>Hi ${safeName},</p>
      <p>Confirm your email address to activate your account and sign in.</p>
      <p>
        <a href="${verifyUrl}" style="display:inline-block; background:#A8752E; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Verify my email
        </a>
      </p>
      <p style="color:#786F94; font-size: 13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}
