"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Box, Typography, Button, Skeleton, Alert, Avatar, AvatarGroup, Tooltip,
} from "@mui/material";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { projectColorForId } from "@/lib/entityColor";
import { avatarInitial } from "@/lib/avatarInitial";
import GradientProgress from "@/components/GradientProgress";
import KanbanBoard from "@/components/KanbanBoard";
import ConfirmDialog from "@/components/ConfirmDialog";
import RenameDialog from "@/components/RenameDialog";
import ProjectMembersDialog from "@/components/ProjectMembersDialog";
import ShareProjectDialog from "@/components/ShareProjectDialog";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted, useLatestRequest } from "@/lib/clientAsync";
import { projectProgress } from "@/lib/taskCompletion";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import * as projectState from "@/lib/projectState";
import KanbanBoardSkeleton, { ProjectHeaderSkeleton } from "@/components/KanbanBoardSkeleton";
import TeamFlowLoader from "@/components/TeamFlowLoader";
import { boardShapeFromProject, readRememberedShape, readStoredShape, rememberShape } from "@/lib/loadShapeCache";

// The branded loader only appears if loading is still going after this
// long, so a fast response does not flash a spinner for a few frames.
const LOADER_DELAY_MS = 200;

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { mode } = useThemeMode();
  const isMounted = useIsMounted();
  const nextRequest = useLatestRequest();
  const [project, setProject] = useState(null);
  useDocumentTitle(project?.name, "Project");
  const [loadError, setLoadError] = useState("");
  // The project doesn't exist, or this person can't open it. The API says
  // 404 or 403; the page treats both as "not found" so it doesn't confirm
  // whether a project they can't see exists.
  const [notFoundState, setNotFoundState] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const userId = session?.user?.id;
  // How this board looked the last time it loaded (this tab, this account):
  // its columns and the tasks in each. null when there is nothing to go on.
  const [storedShape, setRememberedShape] = useState(() => readRememberedShape("board", userId, id));
  // A project with no columns has no board to draw (the real page shows
  // its "No board yet" state), so it is treated as not remembered.
  const rememberedShape = storedShape && storedShape.columns.length > 0 ? storedShape : null;
  const [showLoader, setShowLoader] = useState(false);
  // Set once a placeholder board has been drawn, so the real board can
  // take its place without replaying its entrance animation.
  const skeletonShown = useRef(false);

  // The full reload. The board no longer calls it after every change: a
  // mutation that returns the entity it changed is applied locally (see
  // applyLocal below). What still reaches it: the first load, Retry, a
  // reload because a local change could not be applied safely, and the
  // board's own recovery after a conflict (409). Reloads can still overlap
  // — a slow response to an earlier one should never overwrite state from
  // a faster, more recent one — so each call is tagged and only the latest
  // is allowed to apply its result.
  const loadsInFlight = useRef(0);
  async function load() {
    const isCurrent = nextRequest();
    loadsInFlight.current += 1;
    try {
      const data = await apiFetch(`/api/projects/${id}`);
      if (!isMounted() || !isCurrent()) return;
      setProject(data);
      setLoadError("");
      setNotFoundState(false);
    } catch (err) {
      if (!isMounted() || !isCurrent()) return;
      if (err.status === 401) {
        router.push("/login");
        return;
      }
      if (err.status === 404 || err.status === 403) {
        setNotFoundState(true);
        return;
      }
      setLoadError(errorMessage(err, "Couldn't load this project. Please try again."));
    } finally {
      loadsInFlight.current -= 1;
    }
  }

  // Applies a change the server has already confirmed to this page's copy
  // of the project, instead of refetching the whole project. `update` is
  // one of the pure functions in lib/projectState.js. Only called after a
  // successful response, so a failed request never reaches it and the UI
  // is never updated as if it had succeeded.
  //
  // If a reload is already on its way it may have been read before this
  // change, and applying the change now could be undone when it lands, so
  // that case reloads again instead (which also makes the earlier reload
  // stale — see load()).
  const projectRef = useRef(null);
  projectRef.current = project;
  function applyLocal(update) {
    if (loadsInFlight.current > 0) {
      load();
      return;
    }
    setProject((prev) => (prev ? update(prev) : prev));
  }

  // A saved task change (title, description, due date, color, assignees,
  // completion, attachments): only the fields that save touched are
  // replaced, so two quick saves to different fields can't undo each other.
  function patchTask(taskId, fields) {
    applyLocal((p) => projectState.patchTask(p, taskId, fields));
  }

  // A created task. If its column isn't on this board (it was removed
  // here meanwhile, or the board is out of step) the board is reloaded
  // rather than showing a task with no column.
  function taskCreated(task) {
    if (!projectState.hasColumn(projectRef.current, task.columnId)) {
      load();
      return;
    }
    applyLocal((p) => projectState.addTask(p, task));
  }

  function taskRemoved(taskId) {
    applyLocal((p) => projectState.removeTask(p, taskId));
  }

  // A move: the moved task's column and order, plus any siblings the
  // server had to renumber (carried on the response).
  function taskMoved(moved) {
    if (!projectState.hasColumn(projectRef.current, moved.columnId)) {
      load();
      return;
    }
    applyLocal((p) => projectState.applyTaskMove(p, moved));
  }

  function columnAdded(column) {
    applyLocal((p) => projectState.addColumn(p, column));
  }

  function columnPatched(columnId, fields) {
    applyLocal((p) => projectState.patchColumn(p, columnId, fields));
  }

  function columnRemoved(columnId) {
    applyLocal((p) => projectState.removeColumn(p, columnId));
  }

  function columnsReordered(columns) {
    applyLocal((p) => projectState.applyColumnOrder(p, columns));
  }

  // The project name, editing mode, member list or editor list changed
  // (rename, "Manage access" dialog). `scope` says which of them, and only
  // those are taken from the response — see ACCESS_SCOPES.
  function accessChanged(data, scope, options) {
    applyLocal((p) => projectState.applyAccessResult(p, data, scope, options));
  }

  useEffect(() => {
    setNotFoundState(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isManagerNow = !!project && userId === project.manager.id;
  const canEditNow =
    !!project &&
    (isManagerNow ||
      project.editingMode !== "manager_approval" ||
      project.editors.some((e) => e.id === userId));

  // After a full reload the in-memory shape is gone but the tab's
  // sessionStorage copy is not; read it once the user id is known (never
  // during render, which would not match the server).
  useEffect(() => {
    skeletonShown.current = false;
    setRememberedShape(readStoredShape("board", userId, id));
  }, [userId, id]);

  // Remember the shape after every successful load and change.
  useEffect(() => {
    if (project && userId) {
      rememberShape("board", userId, id, boardShapeFromProject(project, canEditNow, isManagerNow, window.innerWidth));
    }
  }, [project, userId, id, canEditNow, isManagerNow]);

  // A placeholder board is on screen: remember it, so the real board can
  // appear in its place without replaying its entrance animation.
  useEffect(() => {
    if (!project && rememberedShape) skeletonShown.current = true;
  }, [project, rememberedShape]);

  // Delay the branded loader slightly (see LOADER_DELAY_MS). While the
  // session is still loading the user id is unknown, so a remembered shape
  // cannot be looked up yet: wait for it rather than flash the loader and
  // then swap it for the placeholder board.
  const waitingWithoutShape = !project && !loadError && !rememberedShape && sessionStatus !== "loading";
  useEffect(() => {
    if (!waitingWithoutShape) {
      setShowLoader(false);
      return undefined;
    }
    const t = setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => clearTimeout(t);
  }, [waitingWithoutShape]);

  async function confirmDeleteProject() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      router.push("/dashboard/projects");
    } catch (err) {
      // Stay open with the reason visible, same pattern used for every
      // other destructive action in the app (task/column/member delete) —
      // closing here would surface the error on the page underneath,
      // which the dialog had been covering.
      if (!isMounted()) return;
      setDeleteError(errorMessage(err, "Couldn't delete this project. Please try again."));
      setDeleting(false);
    }
  }

  async function handleRenameProject(newName) {
    if (renaming) return;
    setRenaming(true);
    setRenameError("");
    try {
      const data = await apiFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!isMounted()) return;
      // The route returns the access summary; only the name is taken from
      // it, and it shows up immediately without a reload.
      accessChanged(data, "rename");
      setRenameOpen(false);
    } catch (err) {
      if (!isMounted()) return;
      setRenameError(errorMessage(err, "Couldn't rename the project. Please try again."));
    } finally {
      if (isMounted()) setRenaming(false);
    }
  }

  if (notFoundState) {
    return (
      <EmptyState
        title="Project not found"
        description="It may have been deleted, or you may not have access to it."
        action={
          <Button component={Link} href="/dashboard/projects" variant="contained">
            Back to projects
          </Button>
        }
      />
    );
  }

  if (loadError && !project) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
        {loadError}
      </Alert>
    );
  }

  // Permissions are worked out from the signed-in user, so nothing that
  // depends on them is drawn until the session is known (the dashboard
  // layout normally hands it over already, so this is a safety net).
  if (!project || sessionStatus === "loading") {
    return (
      <Box>
        {rememberedShape ? (
          <ProjectHeaderSkeleton shape={rememberedShape} />
        ) : (
          <Box aria-hidden>
            <Skeleton variant="text" width={64} height={20} />
            <Skeleton variant="text" width="40%" height={44} />
            <Skeleton variant="text" width="60%" height={22} sx={{ mb: 3 }} />
          </Box>
        )}
        {rememberedShape ? (
          // Shape remembered from the last load -> the same columns with
          // the same number of tasks in each, drawn like the real cards.
          // Not known -> the Team Flow loader (after a short delay) and no
          // placeholders: we do not guess.
          <Box role="status" aria-busy="true" aria-label="Loading project" className="tf-fade-in">
            <KanbanBoardSkeleton shape={rememberedShape} projectId={id} />
          </Box>
        ) : showLoader ? (
          <TeamFlowLoader label="Loading project" />
        ) : (
          <Box aria-busy="true" sx={{ minHeight: 240 }} />
        )}
      </Box>
    );
  }

  const { total, done, pct } = projectProgress(project.tasks);
  const isManager = session?.user?.id === project.manager.id;
  // `project.members` is `null` for a project that predates per-project
  // access (every team member currently has access to it) and an array
  // otherwise (only the manager and whoever's listed) — see
  // lib/serialize.js. Assignable people always match who can actually see
  // the project, so a task is never handed to someone who can't open it.
  const projectRoster = project.members ?? project.team.members;
  const assignableUsers = [
    project.manager,
    ...projectRoster.filter((m) => m.id !== project.manager.id),
  ];
  // Whether the current user can directly edit tasks/columns here, as
  // opposed to only being able to view them — mirrors
  // lib/authz.js's canEditProject exactly, using the same DTO fields.
  const canEdit =
    isManager ||
    project.editingMode !== "manager_approval" ||
    project.editors.some((e) => e.id === session?.user?.id);

  return (
    <Box>
      <PageHeader
        back={{ href: "/dashboard/projects", label: "Projects" }}
        accent={projectColorForId(project.id, mode).strong}
        title={project.name}
        subtitle={project.team.name}
        description={project.description}
        sx={{ mb: 3 }}
        actions={
          <>
            {isManager && (
              <Button
                color="inherit"
                startIcon={<EditOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => {
                  setRenameError("");
                  setRenameOpen(true);
                }}
              >
                Rename
              </Button>
            )}
            {isManager && (
              <Button
                color="inherit"
                startIcon={<GroupOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => setMembersOpen(true)}
              >
                Manage access
              </Button>
            )}
            {isManager && (
              <Button
                color="inherit"
                startIcon={<ShareOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => setShareOpen(true)}
              >
                Share
              </Button>
            )}
            {isManager && (
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                Delete project
              </Button>
            )}
          </>
        }
      />

      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 1.5, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <GradientProgress value={pct} done={pct === 100} label="Project progress" width={140} />
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {done} of {total} tasks done
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <AvatarGroup max={6} sx={{ "& .MuiAvatar-root": { width: 24, height: 24, fontSize: 11, borderColor: "background.default" } }}>
            {assignableUsers.map((m) => (
              <Tooltip key={m.id} title={m.id === project.manager.id ? `${m.name} (manager)` : m.name}>
                <Avatar aria-label={m.name} sx={{ bgcolor: pastelForString(m.id, mode) }}>
                  {avatarInitial(m.name)}
                </Avatar>
              </Tooltip>
            ))}
          </AvatarGroup>
          <Typography variant="body2" color="text.secondary">
            Managed by {project.manager.name}
          </Typography>
        </Box>
      </Box>

      {!canEdit && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You can view this project but not edit it. {project.manager.name} controls who can edit.
        </Typography>
      )}

      <KanbanBoard
        projectId={project.id}
        columns={project.columns}
        tasks={project.tasks}
        onChanged={load}
        onTaskPatched={patchTask}
        onTaskCreated={taskCreated}
        onTaskMoved={taskMoved}
        onTaskRemoved={taskRemoved}
        onColumnAdded={columnAdded}
        onColumnPatched={columnPatched}
        onColumnRemoved={columnRemoved}
        onColumnsReordered={columnsReordered}
        assignableUsers={assignableUsers}
        canEdit={canEdit}
        animateEntrance={!skeletonShown.current}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project"
        message={`“${project.name}” and all of its tasks will be permanently deleted — this can't be undone. Are you sure?`}
        onConfirm={confirmDeleteProject}
        onClose={() => {
          setConfirmDelete(false);
          setDeleteError("");
        }}
        loading={deleting}
        error={deleteError}
      />

      <RenameDialog
        open={renameOpen}
        title="Rename project"
        label="Project name"
        value={project.name}
        onSave={handleRenameProject}
        onClose={() => {
          setRenameOpen(false);
          setRenameError("");
        }}
        loading={renaming}
        error={renameError}
      />

      {isManager && (
        <ProjectMembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          projectId={project.id}
          manager={project.manager}
          teamMembers={project.team.members}
          projectMembers={project.members}
          editingMode={project.editingMode}
          editors={project.editors}
          onChanged={accessChanged}
        />
      )}

      {isManager && (
        <ShareProjectDialog open={shareOpen} onClose={() => setShareOpen(false)} projectId={project.id} />
      )}

    </Box>
  );
}
