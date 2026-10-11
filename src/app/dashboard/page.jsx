import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { loadDashboardData } from "@/lib/dashboardData";
import { findAccessibleProjects } from "@/lib/projectQueries";
import ProgressChart from "@/components/ProgressChart";
import OverviewStats from "@/components/OverviewStats";
import { Suspense } from "react";
import Link from "next/link";
import { Box, Grid, Typography, Button } from "@mui/material";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import TeamFlowLoader from "@/components/TeamFlowLoader";

// Access is decided by lib/authz.js from the project's manager, its member
// list and its team's member list — ids are enough for all three, so only
// the team's `members` is populated (as ids) and nothing else is. The
// overview never shows people.
const TEAM_ACCESS_POPULATE = { path: "team", select: "members" };

export const metadata = { title: "Dashboard" };

// The page frame renders immediately; the part that waits on the database
// streams in behind a loading state, so a slow query shows a loader under
// the heading instead of a blank page.
export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const userId = session.user.id;

  return (
    <Box>
      <PageHeader title="Overview" />
      <Suspense fallback={<TeamFlowLoader label="Loading overview" />}>
        <OverviewContent userId={userId} />
      </Suspense>
    </Box>
  );
}

async function OverviewContent({ userId }) {
  await connectDB();

  // Only the projects this user can access — see findAccessibleProjects().
  const projects = await findAccessibleProjects(userId, [TEAM_ACCESS_POPULATE]);

  // H2: counts come from the database and the two task lists are bounded,
  // so what is loaded and sent to the browser no longer grows with every
  // task in every project. See lib/dashboardData.js.
  const { projects: serialized, counts, openTasks, completedTasks } = await loadDashboardData(projects, userId);

  return (
    <>
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
        <Grid container columnSpacing={{ md: 4 }} rowSpacing={{ xs: 3, md: 0 }}>
          {/* Each stat is a switch — choosing one lists what is behind it
              underneath (my open tasks / completed tasks / projects). */}
          <Grid item xs={12} md={7} className="tf-fade-up">
            <OverviewStats projects={serialized} counts={counts} openTasks={openTasks} completedTasks={completedTasks} />
          </Grid>
          <Grid item xs={12} md={5} className="tf-fade-up" sx={{ animationDelay: "60ms" }}>
            <Box
              className="tf-topline"
              sx={{
                bgcolor: "background.paper",
                backgroundImage: "var(--brand-panel-wash)",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                boxShadow: "var(--brand-shadow-card)",
                overflow: "hidden",
                p: { xs: 2, sm: 3 },
              }}
            >
              <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
                Project progress
              </Typography>
              <ProgressChart projects={serialized} />
            </Box>
          </Grid>
        </Grid>
      )}
    </>
  );
}
