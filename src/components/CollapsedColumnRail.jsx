"use client";

import { ButtonBase, Tooltip, Typography, Box } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

// The narrow strip a collapsed Kanban column turns into: expand chevron,
// task count, and the column name set vertically. The whole strip is one
// real <button>, so a click anywhere on the column (or Enter/Space when
// focused) expands it. It only renders the strip; KanbanBoard owns the
// state and the width/height transition.
export default function CollapsedColumnRail({ column, taskCount, onExpand }) {
  const taskLabel = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  return (
    <Tooltip title="Expand column" placement="right" enterDelay={500}>
      <ButtonBase
        type="button"
        onClick={onExpand}
        data-collapse-toggle={column.id}
        aria-expanded={false}
        aria-label={`Expand column ${column.name}, ${taskLabel}`}
        sx={(theme) => ({
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 1,
          width: "100%",
          height: "100%",
          py: 1,
          color: "text.secondary",
          textAlign: "center",
          "&:hover": { bgcolor: theme.palette.action.hover, color: "text.primary" },
          // The theme's press feedback would scale the whole column.
          "&:active:not(.Mui-disabled)": { transform: "none" },
          // Inset ring: the column clips anything drawn outside it.
          "&.Mui-focusVisible": { outlineOffset: "-2px" },
        })}
      >
        <ChevronRightIcon sx={{ fontSize: 18 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {taskCount}
        </Typography>
        {column.isDoneColumn && <CheckCircleIcon aria-hidden="true" sx={{ fontSize: 16, color: "success.main" }} />}
        <Typography
          component="span"
          variant="subtitle2"
          title={column.name}
          sx={{
            color: "text.primary",
            writingMode: "vertical-rl",
            maxHeight: 168,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {column.name}
        </Typography>
        <Box component="span" sx={{ flexGrow: 1 }} />
      </ButtonBase>
    </Tooltip>
  );
}
