"use client";

import { useId, useState } from "react";
import { IconButton, Tooltip, Popover, Box, Typography } from "@mui/material";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import CheckIcon from "@mui/icons-material/Check";
import { APPEARANCE_THEMES } from "@/lib/appearanceThemes";
import { useAppearanceTheme } from "@/components/AppearanceThemeContext";
import { useThemeMode } from "@/components/ThemeModeContext";

// A background, here, is a flat canvas tint paired with one accent color
// — not an image — so a swatch just needs two colors to represent it
// fully: a square of the canvas with a small accent dot in the corner.
export default function AppearancePickerButton() {
  const { appearanceTheme, setAppearanceTheme } = useAppearanceTheme();
  const { mode } = useThemeMode();
  const [anchorEl, setAnchorEl] = useState(null);
  const popoverId = useId();
  const open = Boolean(anchorEl);

  return (
    <>
      <Tooltip title="Background">
        <IconButton
          size="small"
          aria-label="Change background"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ width: 34, height: 34 }}
        >
          <PaletteOutlinedIcon sx={{ fontSize: 19 }} />
        </IconButton>
      </Tooltip>
      <Popover
        id={popoverId}
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 1.5, width: 236 } } }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 0.5, mb: 1 }}>
          Background
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25 }}>
          {APPEARANCE_THEMES.map((t) => {
            const swatch = t[mode];
            const selected = appearanceTheme === t.id;
            return (
              <Tooltip key={t.id} title={t.label}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setAppearanceTheme(t.id)}
                  aria-label={t.label}
                  aria-pressed={selected}
                  sx={{
                    position: "relative",
                    width: 40,
                    height: 40,
                    p: 0,
                    borderRadius: 1.5,
                    cursor: "pointer",
                    bgcolor: swatch.canvas,
                    border: "1.5px solid",
                    borderColor: selected ? "primary.main" : "line.strong",
                    boxShadow: "inset 0 0 0 1px rgba(30,27,22,0.08)",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "flex-end",
                    transition: "border-color .12s ease",
                    "&:hover": { borderColor: selected ? "primary.main" : "text.secondary" },
                    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: swatch.accent, m: 0.5 }}
                  />
                  {selected && (
                    <CheckIcon
                      aria-hidden
                      sx={{
                        position: "absolute",
                        top: 3,
                        left: 3,
                        fontSize: 13,
                        color: "primary.main",
                        bgcolor: "background.paper",
                        borderRadius: "50%",
                        p: "1px",
                      }}
                    />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}
