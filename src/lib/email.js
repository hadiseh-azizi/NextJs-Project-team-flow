import nodemailer from "nodemailer";

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
  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const signupUrl = `${appUrl}/register?email=${encodeURIComponent(to)}`;

  const subject = `${inviterName} invited you to join "${teamName}" on TeamFlow`;
  const text = `${inviterName} invited you to join the team "${teamName}" on TeamFlow.\n\nCreate an account to join automatically:\n${signupUrl}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; color: #1C1B19; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:#B54A2C;">.</span></p>
      <p><strong>${inviterName}</strong> invited you to join the team <strong>${teamName}</strong> on TeamFlow.</p>
      <p>
        <a href="${signupUrl}" style="display:inline-block; background:#B54A2C; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Create your account
        </a>
      </p>
      <p style="color:#78716C; font-size: 13px;">You'll be added to "${teamName}" automatically as soon as you sign up with this email address.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export async function sendVerificationEmail({ to, name, token }) {
  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const subject = "Confirm your email for TeamFlow";
  const text = `Hi ${name},\n\nConfirm your email address to activate your TeamFlow account:\n${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; color: #1C1B19; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 18px; font-weight: 700;">TeamFlow<span style="color:#B54A2C;">.</span></p>
      <p>Hi ${name},</p>
      <p>Confirm your email address to activate your account and sign in.</p>
      <p>
        <a href="${verifyUrl}" style="display:inline-block; background:#B54A2C; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">
          Verify my email
        </a>
      </p>
      <p style="color:#78716C; font-size: 13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}
