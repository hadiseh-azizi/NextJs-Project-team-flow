import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import PasswordResetToken from "@/models/PasswordResetToken";
import AutoLoginToken from "@/models/AutoLoginToken";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { validatePassword } from "@/lib/passwordPolicy";
import { hashPassword } from "@/lib/passwordHash";
import { requireCurrentPassword } from "@/lib/accountAuth";
import { invalidateSessionCache } from "@/lib/sessionRevocationCache";

// Change the password while signed in. Needs the current password (see
// lib/accountAuth.js) and a new one that passes the same policy as
// registration and reset. "Forgot password" is a separate route and is
// untouched.
//
// Sessions: the write also bumps `tokenVersion`, which is exactly how the
// reset flow revokes sessions (lib/auth.js's jwt callback compares it on every
// request). That signs out every device, including this one, so the person
// signs in again with the new password. Re-issuing a token for the current
// browser instead would need a way to accept an old token once, which anyone
// holding a stolen old token could use too. Outstanding reset links are
// deleted as well, so a link emailed before the change can't undo it.
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const passwordResult = validatePassword(body.newPassword);
  if (passwordResult.error) return NextResponse.json({ error: passwordResult.error }, { status: 400 });

  await connectDB();

  const check = await requireCurrentPassword(userId, body.currentPassword);
  if (check.response) return check.response;
  const { user } = check;

  if (body.newPassword === body.currentPassword) {
    return NextResponse.json({ error: "Choose a password different from your current one" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    const passwordHash = await hashPassword(body.newPassword);

    const changed = await withOptionalTransaction(async (dbSession) => {
      const options = dbSession ? { session: dbSession } : undefined;
      // Matching on the hash we just verified means two simultaneous changes
      // can't both succeed from the same starting password.
      const result = await User.updateOne(
        { _id: userId, passwordHash: user.passwordHash },
        { $set: { passwordHash }, $inc: { tokenVersion: 1 } },
        options
      );
      if (!result.modifiedCount) return false;
      await PasswordResetToken.deleteMany({ userId }, options);
      await AutoLoginToken.deleteMany({ userId }, options);
      return true;
    });

    if (!changed) {
      return NextResponse.json({ error: "Your password was changed elsewhere. Please try again." }, { status: 409 });
    }
    // H1: the tokenVersion bump has committed; drop the cached copy so the
    // old sessions are rejected immediately in this process.
    invalidateSessionCache(userId);
    return NextResponse.json({ ok: true });
  });
}
