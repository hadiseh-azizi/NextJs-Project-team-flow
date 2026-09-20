import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Team from "@/models/Team";
import User from "@/models/User";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Invitation from "@/models/Invitation";
import { toTeamDTO } from "@/lib/serialize";
import { sendTeamInviteEmail } from "@/lib/email";
import { isValidObjectId } from "@/lib/objectId";
import { isTeamManager } from "@/lib/authz";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { validateEmailInput } from "@/lib/validation";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { withOptionalTransaction } from "@/lib/mongoTransaction";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

// Only the "no account yet" branch below actually sends mail — adding an
// existing user to a team is just a membership write with no external
// side effect, so it's left ungated (the manager-only authorization check
// above already limits who can trigger it). Two identities are checked
// together for the email-sending branch: per-manager (across any team
// they manage) stops one compromised or malicious manager account from
// mass-emailing regardless of which team it targets, and per-team stops
// one team's invite flow from being flooded regardless of who's driving
// it. Both limits are deliberately generous — bulk-onboarding a large
// team in one sitting should never trip them — this exists to stop
// automated abuse, not normal admin use, and the numbers are sized off
// the same "reasonable admin action, not a script" assumption
// AUTH_SECURITY_AUDIT.md used for the auth endpoints' limits. IP is a
// third, looser net: useful defense-in-depth if a manager's session is
// compromised and driven from a script, but never the only thing
// standing between an attacker and sending mail — see clientIp.js for
// why a client can, in some deployments, choose its own IP identity;
// even then the manager/team limits above still hold.
const INVITE_MANAGER_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };
const INVITE_TEAM_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };
const INVITE_IP_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 };

// Only the team manager can add or remove members — this is the boundary
// that keeps one team's roster from being edited by outsiders.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  await connectDB();

  const team = await Team.findById(id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (!isTeamManager(team, userId)) {
    return NextResponse.json({ error: "Only the team manager can add members" }, { status: 403 });
  }

  const body = await parseJsonBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const emailResult = validateEmailInput(body.email);
  if (emailResult.error) return NextResponse.json({ error: emailResult.error }, { status: 400 });
  const email = emailResult.value;

  return withMongoErrorHandling(async () => {
    // invitedBy is always the authenticated session user, and we've
    // already confirmed above that they manage this team — both sides of
    // an Invitation record are trustworthy by construction here.
    const invitedUser = await User.findOne({ email }).lean();

    // No account with this email yet — record a pending invitation and email
    // them a sign-up link. They'll be added to the team automatically the
    // moment they register with this same address.
    if (!invitedUser) {
      // Checked before the existing-invite lookup below so that an
      // attacker rotating through many different target addresses (which
      // would never trip the per-(email,team) duplicate check, since
      // each one is "new") still gets capped by manager/team/IP identity
      // instead of being able to send unlimited invitation emails.
      const inviteIp = getClientIp(req.headers);
      const [managerLimit, teamLimit, ipLimit] = await Promise.all([
        checkRateLimit(`invite:manager:${userId}`, INVITE_MANAGER_LIMIT),
        checkRateLimit(`invite:team:${id}`, INVITE_TEAM_LIMIT),
        inviteIp === "unknown" ? null : checkRateLimit(`invite:ip:${inviteIp}`, INVITE_IP_LIMIT),
      ]);
      if (managerLimit.limited || teamLimit.limited || ipLimit?.limited) {
        const retryAfterMs = Math.max(managerLimit.retryAfterMs, teamLimit.retryAfterMs, ipLimit?.retryAfterMs || 0);
        return NextResponse.json(
          { error: "Too many invitations sent. Please try again later." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
        );
      }

      const existingInvite = await Invitation.findOne({ email, team: id }).lean();
      if (existingInvite) {
        // A live invitation blocks a duplicate; an expired one is stale
        // and safe to replace with a fresh one (new expiry, same intent).
        if (existingInvite.expiresAt && existingInvite.expiresAt.getTime() > Date.now()) {
          return NextResponse.json({ error: "This email has already been invited" }, { status: 409 });
        }
        await Invitation.deleteOne({ _id: existingInvite._id });
      }

      const manager = await User.findById(userId).select("name").lean();
      // The unique (email, team) index is the real backstop against a
      // duplicate invite race; a collision here surfaces through
      // withMongoErrorHandling as the same 409 as the check above.
      await Invitation.create({ email, team: id, invitedBy: userId });

      // Sending the email is best-effort: the invitation record is the
      // source of truth, and a transient SMTP failure shouldn't turn an
      // already-successful invite into a 500 (which would leave the
      // manager thinking it failed while a retry would just 409 on the
      // duplicate they can't see).
      try {
        await sendTeamInviteEmail({ to: email, teamName: team.name, inviterName: manager.name });
      } catch (err) {
        console.error("[teams/members] Failed to send invitation email:", err);
      }

      return NextResponse.json({ status: "invited", email }, { status: 201 });
    }

    if (team.members.some((m) => String(m) === String(invitedUser._id))) {
      return NextResponse.json({ error: "This user is already a team member" }, { status: 409 });
    }

    // $addToSet (rather than push+save) closes the race between the check
    // above and this write: two concurrent invites for the same user can
    // no longer both succeed and leave a duplicate id in `members`.
    const updateResult = await Team.updateOne(
      { _id: team._id },
      { $addToSet: { members: invitedUser._id } }
    );
    if (updateResult.modifiedCount === 0) {
      return NextResponse.json({ error: "This user is already a team member" }, { status: 409 });
    }

    const populated = await Team.findById(team._id)
      .populate("manager", "name email")
      .populate("members", "name email")
      .lean();

    return NextResponse.json({ status: "added", team: toTeamDTO(populated) }, { status: 201 });
  });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  if (!isValidObjectId(id)) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const removeUserId = searchParams.get("userId");
  if (!isValidObjectId(removeUserId)) {
    return NextResponse.json({ error: "A valid userId query parameter is required" }, { status: 400 });
  }

  await connectDB();

  const team = await Team.findById(id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (!isTeamManager(team, userId)) {
    return NextResponse.json({ error: "Only the team manager can remove members" }, { status: 403 });
  }
  if (removeUserId === String(team.manager)) {
    return NextResponse.json({ error: "The team manager cannot be removed" }, { status: 400 });
  }

  return withMongoErrorHandling(async () => {
    // Removing a member and un-assigning them from that team's tasks must
    // happen together: a member who no longer has access to a project
    // shouldn't remain a task assignee there (they'd show up on a board
    // they can't open), and a crash between the two writes shouldn't be
    // able to leave one done without the other. Uses withOptionalTransaction
    // (see lib/mongoTransaction.js) instead of a raw
    // mongoose.startSession()/session.withTransaction() pair — the raw
    // form throws on a standalone (non-replica-set) MongoDB instead of
    // falling back, which contradicted what README.md documents for this
    // exact operation. Both writes are `$pull`, which is naturally
    // idempotent (pulling an id that's already gone is a no-op), so a
    // driver-level retry of this callback, or the no-session fallback
    // path running the two writes without isolation, can't double-apply
    // or corrupt state.
    await withOptionalTransaction(async (session) => {
      await Team.updateOne(
        { _id: team._id },
        { $pull: { members: removeUserId } },
        { session: session ?? undefined }
      );

      const projects = await Project.find({ team: team._id }, { _id: 1 })
        .session(session ?? null)
        .lean();
      const projectIds = projects.map((p) => p._id);

      if (projectIds.length > 0) {
        await Task.updateMany(
          { project: { $in: projectIds } },
          { $pull: { assignees: removeUserId } },
          { session: session ?? undefined }
        );
      }
    });

    const populated = await Team.findById(team._id)
      .populate("manager", "name email")
      .populate("members", "name email")
      .lean();

    return NextResponse.json(toTeamDTO(populated));
  });
}
