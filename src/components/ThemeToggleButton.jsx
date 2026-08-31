"use client";

import { Box, IconButton, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { useThemeMode } from "@/components/ThemeModeContext";

export default function ThemeToggleButton() {
  const { mode, toggleMode } = useThemeMode();
  const isDark = mode === "dark";

  return (
    <Tooltip title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
      <IconButton
        onClick={toggleMode}
        size="small"
        aria-label="Toggle dark mode"
        sx={(theme) => ({
          position: "relative",
          width: 34,
          height: 34,
          color: "text.secondary",
          transition: "transform .25s cubic-bezier(.4,0,.2,1), background-color .2s",
          "&:hover": { transform: "scale(1.08)", bgcolor: alpha(theme.palette.primary.main, 0.08) },
          "&:active": { transform: "scale(0.94)" },
        })}
      >
        {/* Sun and moon are stacked on top of each other and cross-fade
            with a quarter-turn rotate — only one is ever visible/opaque,
            which is what makes the swap read as one smooth transition
            instead of an instant icon swap. */}
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform .5s cubic-bezier(.4,0,.2,1), opacity .35s ease",
            transform: isDark ? "rotate(0deg) scale(1)" : "rotate(-100deg) scale(0.4)",
            opacity: isDark ? 1 : 0,
          }}
        >
          <LightModeOutlinedIcon sx={{ fontSize: 19 }} />
        </Box>
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform .5s cubic-bezier(.4,0,.2,1), opacity .35s ease",
            transform: isDark ? "rotate(100deg) scale(0.4)" : "rotate(0deg) scale(1)",
            opacity: isDark ? 0 : 1,
          }}
        >
          <DarkModeOutlinedIcon sx={{ fontSize: 19 }} />
        </Box>
      </IconButton>
    </Tooltip>
  );
}
