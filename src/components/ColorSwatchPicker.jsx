"use client";

import { Box, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { TASK_COLORS } from "@/lib/taskColors";
import { useThemeMode } from "@/components/ThemeModeContext";

export default function ColorSwatchPicker({ value, onChange }) {
  const { mode } = useThemeMode();

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      <Tooltip title="No color">
        <Box
          onClick={() => onChange(null)}
          sx={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "1.5px solid",
            borderColor: !value ? "primary.main" : "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "text.disabled",
          }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </Box>
      </Tooltip>
      {TASK_COLORS.map((c) => (
        <Tooltip key={c.key} title={c.label}>
          <Box
            onClick={() => onChange(c.key)}
            sx={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              bgcolor: mode === "dark" ? c.dark : c.light,
              border: "2px solid",
              borderColor: value === c.key ? "primary.main" : "transparent",
              boxShadow: value === c.key ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.08)",
              cursor: "pointer",
              transition: "transform .1s",
              "&:hover": { transform: "scale(1.1)" },
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
