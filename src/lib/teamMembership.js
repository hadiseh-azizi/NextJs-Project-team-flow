import Team from "@/models/Team";
import Project from "@/models/Project";
import Task from "@/models/Task";

// Takes one user out of one or more teams and removes everything that
// granted them access to those teams' projects. Used by every path that
// ends a membership: the manager removing a member, a member leaving, and
// account deletion. Keeping it in one place means the three can't drift
// apart (the C2 fix in DELETE /api/teams/[id]/members is exactly this
// cleanup).
//
// Runs inside the caller's transaction (`session` may be null on a
// standalone MongoDB). Every write is a `$pull`, so a retry or the
// no-session fallback can't double-apply anything, and every write is
// scoped to the given teams' projects only: the user's access to any other
// team's projects is untouched. `$pull` on a legacy project with no
// `members` field is a no-op and does not create one, so legacy
// (unrestricted) projects keep their semantics. No document is deleted.
export async function removeUserFromTeams(teamIds, userId, session) {
  // Always an object (session undefined without a transaction), as before.
  const options = { session: session ?? undefined };

  // One team at a time, with the same queries the manager-removal route has
  // always used. Callers pass one team (remove / leave) or the handful a
  // person belongs to (account deletion), so this is a few round trips.
  for (const teamId of teamIds) {
    await Team.updateOne({ _id: teamId }, { $pull: { members: userId } }, options);

    const projects = await Project.find({ team: teamId }, { _id: 1 })
      .session(session ?? null)
      .lean();
    const projectIds = projects.map((p) => p._id);

    if (projectIds.length > 0) {
      await Task.updateMany({ project: { $in: projectIds } }, { $pull: { assignees: userId } }, options);
    }

    // Drops the user from each project's explicit access list and from its
    // individually granted editors, in one bulk write.
    await Project.updateMany({ team: teamId }, { $pull: { members: userId, editors: userId } }, options);
  }
}
