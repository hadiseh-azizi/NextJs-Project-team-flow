"use client";

import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";
import PageHeader from "@/components/PageHeader";
import { COLLAPSED_COLUMN_WIDTH, readCollapsedColumns } from "@/lib/collapsedColumns";
import { columnContentWidthSx } from "@/lib/columnWidth";

// Placeholder for KanbanBoard, drawn from the board's remembered shape
// (lib/loadShapeCache.js): the same columns, each holding the same number
// of task cards, inside the board's own scroller and column panels.
//
// Every box here copies the real one in KanbanBoard.jsx / TaskCard.jsx —
// the flex-basis of a column (84% on phones, 288px from `sm` up), its
// panel (border, radius, tint, 160px floor), the 8px inner padding, the
// 32px header row, the 6px gap between cards, the card's own Card +
// 10px/12px padding, and the real line boxes of the title (body2), the
// description (caption) and the footer (22px row). Text lines are
// Skeleton "text" bars inside the same Typography variants, so a line is
// as tall as a real line. Collapsed columns (a per-browser choice kept in
// localStorage) are drawn collapsed.
//
// The board also ends where the real one does: the "New column" tile an
// editor gets after the last column, so the scroll extent (and, on a phone,
// the strip of it peeking in at the edge) is the same before and after.
//
// Nothing here carries data: no titles, names or images. Decorative, so
// it is hidden from assistive tech; the page wraps it in a labelled
// status region.

const WAVE = { animation: "wave" };

// Widths of the project page's four manager buttons (icon + label + padding),
// as rendered: Rename, Manage access, Share, Delete project. Their height is
// the theme's 36px button. Used so the header wraps exactly like the real one.
const MANAGER_BUTTON_WIDTHS = [106.5, 154.7, 90.9, 120.6];

// Everything above the board on the project page, drawn with the page's
// own PageHeader and the same progress / people row, so the board starts
// at the same height before and after loading. The "Projects" link is the
// real one (it is not data); the title, team name, description, counts and
// names are bars. A header that is not remembered keeps the page's plain
// three-bar placeholder instead (see the page), so nothing is guessed.
export function ProjectHeaderSkeleton({ shape }) {
  const { manager, title, description, people } = shape.header;
  return (
    <>
      <PageHeader
        back={{ href: "/dashboard/projects", label: "Projects" }}
        // Fixed widths, not percentages: the title is a shrink-to-fit flex item, where a
        // percentage would collapse to nothing. A wrapped title's lines are wide enough that
        // the team name no longer fits beside the first one and drops to its own row, as in
        // the real header.
        title={Array.from({ length: title }, (_, i) => (
          <Skeleton
            key={i}
            {...WAVE}
            sx={{ width: title === 1 ? 220 : i === title - 1 ? { xs: 180, sm: 300 } : { xs: 280, sm: 600 }, maxWidth: "100%" }}
          />
        ))}
        subtitle={<Skeleton {...WAVE} width={72} />}
        description={
          description > 0
            ? Array.from({ length: description }, (_, i) => (
                <Skeleton key={i} {...WAVE} width={i === description - 1 && description > 1 ? "60%" : "100%"} />
              ))
            : undefined
        }
        sx={{ mb: 3 }}
        actions={
          <>
            {manager > 0 &&
              MANAGER_BUTTON_WIDTHS.map((w) => <Skeleton key={w} {...WAVE} variant="rounded" width={w} height={36} />)}
          </>
        }
      />

      {/* Same row as the page: progress bar + count, then the people and "Managed by". */}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 1.5, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Skeleton {...WAVE} variant="rounded" width={140} height={4} />
          <Typography variant="body2" component="div">
            <Skeleton {...WAVE} width={110} />
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          {/* AvatarGroup: 24px avatars with a 2px border (content-box), overlapped by 8px. */}
          <Box sx={{ display: "flex", flexShrink: 0, pl: "8px" }}>
            {Array.from({ length: people }, (_, i) => (
              <Skeleton
                key={i}
                {...WAVE}
                variant="circular"
                width={24}
                height={24}
                sx={{ ml: "-8px", border: "2px solid", borderColor: "background.default", boxSizing: "content-box" }}
              />
            ))}
          </Box>
          <Typography variant="body2" component="div">
            <Skeleton {...WAVE} width={150} />
          </Typography>
        </Box>
      </Box>

      {!shape.edit && (
        // "You can view this project but not edit it. … controls who can edit." (wraps on a phone)
        <Typography variant="body2" component="div" sx={{ mb: 2 }}>
          <Skeleton {...WAVE} width="72%" />
          <Box sx={{ display: { xs: "block", sm: "none" } }}>
            <Skeleton {...WAVE} width="40%" />
          </Box>
        </Typography>
      )}
    </>
  );
}

function TaskCardSkeleton({ task, canEdit }) {
  const [titleLines, descLines, hasDue, hasFiles, people] = task;
  const hasFooter = hasDue || hasFiles || people > 0;
  return (
    <Card
      sx={(theme) => ({
        borderColor: "divider",
        boxShadow: theme.tf.shadow.card,
      })}
    >
      <CardContent sx={{ p: "10px 12px !important" }}>
        {/* Same row as TaskCard: complete toggle, title, delete button. */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 0.5 }}>
          <Box sx={{ p: 0.5, mt: -0.25, ml: -0.5, display: "flex" }}>
            <Skeleton {...WAVE} variant="circular" width={18} height={18} />
          </Box>
          <Typography variant="body2" component="div" sx={{ flexGrow: 1, minWidth: 0, lineHeight: 1.4 }}>
            {Array.from({ length: titleLines }, (_, i) => (
              <Skeleton key={i} {...WAVE} width={i === titleLines - 1 && titleLines > 1 ? "55%" : "85%"} />
            ))}
          </Typography>
          {/* The real delete button is 23px wide (15px icon + 4px padding each side). */}
          {canEdit && <Box sx={{ width: 23, height: 23, mt: -0.5, mr: -0.75, flexShrink: 0 }} />}
        </Box>

        {descLines > 0 && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
            {Array.from({ length: descLines }, (_, i) => (
              <Skeleton key={i} {...WAVE} width={i === descLines - 1 && descLines > 1 ? "60%" : "100%"} />
            ))}
          </Typography>
        )}

        {hasFooter && (
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, mt: 1.25, minHeight: 22 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
              {hasDue > 0 && <Skeleton {...WAVE} variant="rounded" width={56} height={10} />}
              {hasFiles > 0 && <Skeleton {...WAVE} variant="rounded" width={26} height={10} />}
            </Box>
            {people > 0 && (
              // AvatarGroup: 22px avatars with a 2px border (content-box), overlapped by 8px.
              <Box sx={{ display: "flex", flexShrink: 0, pl: "8px" }}>
                {Array.from({ length: people }, (_, i) => (
                  <Skeleton
                    key={i}
                    {...WAVE}
                    variant="circular"
                    width={22}
                    height={22}
                    sx={{ ml: "-8px", border: "2px solid", borderColor: "background.paper", boxSizing: "content-box" }}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function ExpandedColumn({ column, canEdit, columnCount }) {
  const hasHandle = canEdit && columnCount > 1;
  return (
    <Box sx={{ ...columnContentWidthSx, boxSizing: "border-box", p: 1 }}>
      {/* Header row: 32px, handle / name / count / collapse / options. */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1, pl: hasHandle ? 0.25 : 1, pr: 0.25, minHeight: 32 }}>
        {hasHandle && <Skeleton {...WAVE} variant="rounded" width={18} height={18} sx={{ ml: "3px", mr: "3px", flexShrink: 0 }} />}
        <Typography variant="subtitle2" component="span" sx={{ flexGrow: 1, minWidth: 0 }}>
          <Skeleton {...WAVE} width="55%" />
        </Typography>
        <Skeleton {...WAVE} variant="rounded" width={12} height={10} sx={{ mx: "2px", flexShrink: 0 }} />
        <Skeleton {...WAVE} variant="circular" width={20} height={20} sx={{ m: "5px", flexShrink: 0 }} />
        {canEdit && <Skeleton {...WAVE} variant="circular" width={20} height={20} sx={{ m: "5px", flexShrink: 0 }} />}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {column.tasks.map((task, i) => (
          <TaskCardSkeleton key={i} task={task} canEdit={canEdit} />
        ))}
        {column.tasks.length === 0 && (
          // Same box as the real "No tasks yet" line.
          <Typography variant="caption" component="div" sx={{ px: 1, py: 1.5 }}>
            <Skeleton {...WAVE} width={72} />
          </Typography>
        )}
      </Box>

      {canEdit && (
        // The real "Add task" button: small = 30px high, mt 4px.
        <Box sx={{ mt: 0.5, height: 30, display: "flex", alignItems: "center", px: "10px" }}>
          <Skeleton {...WAVE} variant="rounded" width={64} height={10} />
        </Box>
      )}
    </Box>
  );
}

function CollapsedColumn({ column }) {
  // Same 48px bar as CollapsedColumnRail: name, count, chevron.
  return (
    <Box sx={{ width: COLLAPSED_COLUMN_WIDTH - 2, height: 48, display: "flex", alignItems: "center", gap: 0.75, px: 1.5, boxSizing: "border-box" }}>
      <Typography variant="subtitle2" component="span" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Skeleton {...WAVE} width="60%" />
      </Typography>
      <Skeleton {...WAVE} variant="rounded" width={12} height={10} sx={{ flexShrink: 0 }} />
      <Skeleton {...WAVE} variant="circular" width={20} height={20} sx={{ flexShrink: 0 }} />
    </Box>
  );
}

export default function KanbanBoardSkeleton({ shape, projectId }) {
  // Read synchronously: this only renders on the client, after a project
  // fetch has started, so there is no server markup to mismatch.
  const collapsed = new Set(readCollapsedColumns(projectId));
  const canEdit = shape.edit;

  return (
    <Box
      aria-hidden
      sx={{
        position: "relative",
        isolation: "isolate",
        containerType: "inline-size",
        display: "flex",
        gap: 1.5,
        overflowX: "auto",
        pb: 1.5,
        alignItems: "flex-start",
        "&::-webkit-scrollbar": { height: 8 },
        "&::-webkit-scrollbar-thumb": { bgcolor: "line.strong", borderRadius: 4 },
      }}
    >
      {shape.columns.map((column) => {
        const isCollapsed = collapsed.has(column.id);
        return (
          <Box key={column.id} sx={{ flex: isCollapsed ? `0 0 ${COLLAPSED_COLUMN_WIDTH}px` : { xs: "0 0 84%", sm: "0 0 288px" }, minWidth: 0 }}>
            <Box
              sx={(theme) => ({
                overflow: "hidden",
                minHeight: isCollapsed ? 0 : 160,
                borderRadius: 2,
                bgcolor: "var(--brand-surface-tint)",
                border: "1px solid",
                borderColor: theme.palette.divider,
              })}
            >
              {isCollapsed ? (
                <CollapsedColumn column={column} />
              ) : (
                <ExpandedColumn column={column} canEdit={canEdit} columnCount={shape.columns.length} />
              )}
            </Box>
          </Box>
        );
      })}

      {canEdit && (
        // The real "New column" button: 40px high, 240px wide from `sm` up (84% on phones).
        <Box sx={{ flex: { xs: "0 0 84%", sm: "0 0 240px" }, minWidth: 0 }}>
          <Box sx={{ height: 40, display: "flex", alignItems: "center", px: 1.5 }}>
            <Skeleton {...WAVE} variant="rounded" width={88} height={10} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
