import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import Team from "@/models/Team";
import Project from "@/models/Project";
import Invitation from "@/models/Invitation";
import PasswordResetToken from "@/models/PasswordResetToken";
import AutoLoginToken from "@/models/AutoLoginToken";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateRequiredString } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { MAX_USER_NAME_LENGTH } from "@/lib/fieldLimits";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { requireCurrentPassword } from "@/lib/accountAuth";
import { removeUserFromTeams } from "@/lib/teamMembership";
import { invalidateSessionCache } from "@/lib/sessionRevocationCache";

// Profile: the only editable field is the display name. The email is the
// login identity and is verified; changing it needs a re-verification flow
// that this app doesn't have, so it is deliberately not editable here.
export async function PATCH(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const nameResult = validateRequiredString(body.name, { field: "Name", maxLength: MAX_USER_NAME_LENGTH });
  if (nameResult.error) return NextResponse.json({ error: nameResult.error }, { status: 400 });

  await connectDB();

  return withMongoErrorHandling(async () => {
    // The id comes from the session, never from the request body.
    const user = await User.findByIdAndUpdate(session.user.id, { $set: { name: nameResult.value } }, { new: true }).lean();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    // H1: the session reads the display name from the cached lookup; drop it
    // so the new name shows up at once in this process.
    invalidateSessionCache(session.user.id);
    return NextResponse.json({ name: user.name, email: user.email });
  });
}

// Account deletion. Requires the current password AND the account's email
// typed back as `confirmEmail`.
//
// Ownership: a team's manager owns the team, its projects and everyone's
// work in them, and this app has no ownership transfer. So an account that
// still manages a team (or any project) is refused with a message naming
// them: the person deletes those teams first (DELETE /api/teams/[id], which
// is its own explicit, typed confirmation). Nothing shared with other people
// is ever deleted or handed over silently by this endpoint.
//
// What is removed once nothing is managed: the user from every team they are
// a member of (with the same access/assignment cleanup as leaving a team),
// pending invitations addressed to their email or sent by them, their unused
// reset/auto-login tokens, and the user document last. Other people's data is
// untouched. Sessions end by themselves: the jwt callback (lib/auth.js)
// rejects any token whose user no longer exists.
export async function DELETE(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  await connectDB();

  const check = await requireCurrentPassword(userId, body.password);
  if (check.response) return check.response;
  const { user } = check;

  if (typeof body.confirmEmail !== "string" || normalizeEmail(body.confirmEmail) !== user.email) {
    return NextResponse.json({ error: "Type your email address exactly to confirm" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    const blockers = await findOwnershipBlockers(userId);
    if (blockers) return blockers;

    const outcome = await withOptionalTransaction(async (dbSession) => {
      const options = dbSession ? { session: dbSession } : undefined;

      const memberOf = await Team.find({ members: userId }, { _id: 1 }).session(dbSession ?? null).lean();
      await removeUserFromTeams(memberOf.map((t) => t._id), userId, dbSession);

      await Invitation.deleteMany({ $or: [{ email: user.email }, { invitedBy: userId }] }, options);
      await PasswordResetToken.deleteMany({ userId }, options);
      await AutoLoginToken.deleteMany({ userId }, options);

      // Re-checked right before the user document goes, so a team or project
      // created in another tab since the check above can't be left pointing at
      // a user who no longer exists.
      if (await Team.exists({ manager: userId }).session(dbSession ?? null)) return "blocked";
      if (await Project.exists({ manager: userId }).session(dbSession ?? null)) return "blocked";

      await User.deleteOne({ _id: userId }, options);
      return "deleted";
    });

    if (outcome === "blocked") return (await findOwnershipBlockers(userId)) ?? NextResponse.json({ error: "Please try again" }, { status: 409 });
    // H1: the user document is gone; a cached entry must not keep the
    // session alive for the rest of its TTL.
    invalidateSessionCache(userId);
    return NextResponse.json({ ok: true });
  });
}

// A 409 response listing what the user still manages, or null if nothing.
async function findOwnershipBlockers(userId) {
  const teams = await Team.find({ manager: userId }, { name: 1 }).lean();
  const projectCount = await Project.countDocuments({ manager: userId });
  if (teams.length === 0 && projectCount === 0) return null;

  const shown = teams.slice(0, 5).map((t) => `“${t.name}”`).join(", ");
  const more = teams.length > 5 ? ` and ${teams.length - 5} more` : "";
  const error =
    teams.length > 0
      ? `You still manage ${teams.length === 1 ? "a team" : `${teams.length} teams`}: ${shown}${more}. Delete ${teams.length === 1 ? "it" : "them"} first, then delete your account.`
      : "You still manage projects. Delete them first, then delete your account.";
  return NextResponse.json({ error }, { status: 409 });
}
