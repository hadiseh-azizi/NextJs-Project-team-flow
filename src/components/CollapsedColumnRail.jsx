"use client";

import { ButtonBase, Tooltip, Typography } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

// What a collapsed Kanban column turns into: a short, narrower panel that
// is just the column's header row — the name on one horizontal line (cut
// with an ellipsis when it doesn't fit; the full name is in the tooltip and
// the accessible label), the task count, and an expand chevron. The name
// is never rotated or stacked.
//
// The whole panel is one real <button>, so a click anywhere on it (or
// Enter/Space when focused) expands the column. It only renders the
// panel; KanbanBoard owns the state and the width/height transition.
export default function CollapsedColumnRail({ column, taskCount, onExpand }) {
  const taskLabel = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  return (
    <Tooltip title="Expand column" placement="bottom-start" enterDelay={500}>
      <ButtonBase
        type="button"
        onClick={onExpand}
        data-collapse-toggle={column.id}
        aria-expanded={false}
        aria-label={`Expand column ${column.name}, ${taskLabel}`}
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          width: "100%",
          // Same 48px as the expanded column's header (8px padding + 32px row),
          // so the title doesn't shift vertically when the column opens.
          height: 48,
          px: 1.5,
          color: "text.secondary",
          textAlign: "left",
          "&:hover": { bgcolor: theme.palette.action.hover, color: "text.primary" },
          // The theme's press feedback would scale the whole column.
          "&:active:not(.Mui-disabled)": { transform: "none" },
          // Inset ring: the column clips anything drawn outside it.
          "&.Mui-focusVisible": { outlineOffset: "-2px" },
        })}
      >
        <Typography
          component="span"
          variant="subtitle2"
          noWrap
          title={column.name}
          sx={{ flexGrow: 1, minWidth: 0, color: "text.primary" }}
        >
          {column.name}
        </Typography>
        <Typography variant="caption" component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {taskCount}
        </Typography>
        <ChevronRightIcon aria-hidden="true" sx={{ fontSize: 20, flexShrink: 0 }} />
      </ButtonBase>
    </Tooltip>
  );
}
