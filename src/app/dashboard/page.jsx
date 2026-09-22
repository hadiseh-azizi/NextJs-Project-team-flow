import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Column from "@/models/Column";
import { toProjectDTO } from "@/lib/serialize";
import { accessibleTeamIds } from "@/lib/authz";
import ProgressChart from "@/components/ProgressChart";
import OverviewStats from "@/components/OverviewStats";
import Link from "next/link";
import { Box, Grid, Typography, Button } from "@mui/material";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const userId = session.user.id;

  await connectDB();

  const teamIds = await accessibleTeamIds(userId);

  const projects = await Project.find({ $or: [{ manager: userId }, { team: { $in: teamIds } }] })
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .sort({ createdAt: -1 })
    .lean();

  const projectIds = projects.map((p) => p._id);
  const [allColumns, allTasks] = await Promise.all([
    Column.find({ project: { $in: projectIds } }).lean(),
    // "-attachments.data" excludes the base64 file contents: this page
    // only ever renders task titles/status/progress via toProjectDTO(),
    // which never includes attachment bytes, so there's no reason to
    // pull potentially several MB of base64 out of MongoDB per task just
    // to discard it while building the dashboard.
    Task.find({ project: { $in: projectIds } })
      .select("-attachments.data")
      .populate("assignees", "name")
      .lean(),
  ]);

  const serialized = projects.map((p) =>
    toProjectDTO(
      p,
      allColumns.filter((c) => String(c.project) === String(p._id)),
      allTasks.filter((t) => String(t.project) === String(p._id))
    )
  );

  return (
    <Box>
      <PageHeader title="Overview" />

      {serialized.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="A project is a board that belongs to a team. Create one to start tracking tasks."
          action={
            <>
              <Button component={Link} href="/dashboard/projects?new=1" variant="contained">
                Create your first project
              </Button>
              <Button component={Link} href="/dashboard/teams" color="inherit">
                Go to teams
              </Button>
            </>
          }
        />
      ) : (
        <Grid container columnSpacing={{ md: 8 }} rowSpacing={{ xs: 5, md: 0 }}>
          {/* Each stat is a switch — choosing one lists what is behind it
              underneath (my open tasks / completed tasks / projects). */}
          <Grid item xs={12} md={7}>
            <OverviewStats projects={serialized} userId={userId} />
          </Grid>
          <Grid item xs={12} md={5}>
            <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
              Project progress
            </Typography>
            <ProgressChart projects={serialized} />
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
