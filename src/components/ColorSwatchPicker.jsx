"use client";

import { Box, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import { TASK_COLORS } from "@/lib/taskColors";
import { useThemeMode } from "@/components/ThemeModeContext";

// Shared reset + focus style so these read as plain circular swatches
// while still being real, keyboard-operable <button> elements.
const swatchBaseSx = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  p: 0,
  cursor: "pointer",
  font: "inherit",
  transition: "box-shadow .12s ease, border-color .12s ease",
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
};

export default function ColorSwatchPicker({ value, onChange, disabled = false }) {
  const { mode } = useThemeMode();

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, opacity: disabled ? 0.5 : 1 }}>
      <Tooltip title="No color">
        <Box
          component="button"
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          aria-label="No color"
          aria-pressed={!value}
          sx={{
            ...swatchBaseSx,
            cursor: disabled ? "default" : "pointer",
            border: "1.5px solid",
            borderColor: !value ? "primary.main" : "line.strong",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "transparent",
            color: "text.secondary",
            "&:hover": disabled ? undefined : { borderColor: "text.secondary" },
          }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </Box>
      </Tooltip>
      {TASK_COLORS.map((c) => (
        <Tooltip key={c.key} title={c.label}>
          <Box
            component="button"
            type="button"
            disabled={disabled}
            onClick={() => onChange(c.key)}
            aria-label={c.label}
            aria-pressed={value === c.key}
            sx={{
              ...swatchBaseSx,
              cursor: disabled ? "default" : "pointer",
              bgcolor: mode === "dark" ? c.dark : c.light,
              border: "2px solid",
              borderColor: value === c.key ? "primary.main" : "transparent",
              boxShadow: (theme) => `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.14)}`,
              "&:hover": disabled ? undefined : { borderColor: value === c.key ? "primary.main" : "line.strong" },
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
