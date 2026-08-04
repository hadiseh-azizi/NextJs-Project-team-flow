import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import Task from "@/models/Task";
import Team from "@/models/Team";
import Column from "@/models/Column";
import { toProjectDTO } from "@/lib/serialize";
import ProgressChart from "@/components/ProgressChart";
import OverviewStats from "@/components/OverviewStats";
import Link from "next/link";
import { Box, Card, CardContent, Typography, Button, Stack } from "@mui/material";

const TEAM_POPULATE = { path: "team", populate: [{ path: "manager", select: "name email" }, { path: "members", select: "name email" }] };

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const userId = session.user.id;

  await connectDB();

  const myTeams = await Team.find({ members: userId }).select("_id").lean();
  const teamIds = myTeams.map((t) => t._id);

  const projects = await Project.find({ $or: [{ manager: userId }, { team: { $in: teamIds } }] })
    .populate("manager", "name email")
    .populate(TEAM_POPULATE)
    .sort({ createdAt: -1 })
    .lean();

  const projectIds = projects.map((p) => p._id);
  const [allColumns, allTasks] = await Promise.all([
    Column.find({ project: { $in: projectIds } }).lean(),
    Task.find({ project: { $in: projectIds } }).populate("assignees", "name").lean(),
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
      <Typography variant="overline" color="primary">
        Dashboard
      </Typography>
      <Typography variant="h4" sx={{ mb: 4 }}>
        Overview
      </Typography>

      {/* Each stat below is a button — clicking it opens the matching list
          right underneath (active projects / completed tasks / your open
          tasks) instead of being purely decorative. */}
      <OverviewStats projects={serialized} userId={userId} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Project progress
          </Typography>
          <ProgressChart projects={serialized} />
        </CardContent>
      </Card>

      {serialized.length === 0 && (
        <Stack alignItems="center" spacing={1} sx={{ mt: 6 }}>
          <Typography color="text.secondary" variant="body2">
            You don't have any projects yet.
          </Typography>
          <Button component={Link} href="/dashboard/projects" variant="contained" size="large">
            Create your first project
          </Button>
        </Stack>
      )}
    </Box>
  );
}
