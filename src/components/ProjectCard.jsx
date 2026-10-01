"use client";

import Link from "next/link";
import { CardActionArea, Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useThemeMode } from "@/components/ThemeModeContext";
import GradientProgress from "@/components/GradientProgress";
import { projectColorForId, projectTabForId } from "@/lib/entityColor";
import { projectProgress } from "@/lib/taskCompletion";
import { avatarInitial } from "@/lib/avatarInitial";
import { staggerDelay } from "@/lib/staggerDelay";

// Height of the team tab. It is drawn 1px taller than the space reserved
// for it above the card, so its bottom row sits on top of the card's top
// border and the tab reads as attached to the card, not floating above it.
const TAB_HEIGHT = 30;
const CARD_RADIUS = 30;

const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

// One project as a square card with its team's name on a tab at the
// top-left, like a folder. The tab and the card share a surface color and
// a continuous border, so the tab is part of the card rather than a badge
// on it. Team color lives on the tab (a colored top edge); project color
// lives inside the card (the monogram and the progress bar), which is how
// the team -> project relationship reads without any extra labels.
//
// The whole thing — tab included — is one link to the project. Progress
// sits at the bottom behind a hairline, so cards line up across a row
// however much description they carry. If a name or description is long
// enough that the content needs more room than a square gives it, the card
// grows a little rather than clipping.
//
// `index` only feeds the entrance stagger; the tab enters with its card.
export default function ProjectCard({ project, index = 0 }) {
  const { mode } = useThemeMode();
  const dark = mode === "dark";
  const { total, done, pct } = projectProgress(project.tasks);
  const projectAccent = projectColorForId(project.id, mode).strong;
  const tab = projectTabForId(project.id, mode);
  const tabGradient = (stops) => `linear-gradient(120deg, ${stops[0]}, ${stops[1]})`;

  return (
    <Box className="tf-settle-in" sx={{ animationDelay: `${staggerDelay(index, 35)}ms` }}>
      <CardActionArea
        component={Link}
        href={`/dashboard/projects/${project.id}`}
        focusRipple={false}
        sx={(theme) => {
          const edge = theme.palette.line.main;
          const ring = theme.palette.primary.main;
          return {
            display: "block",
            borderRadius: 0,
            overflow: "visible",
            "& .MuiCardActionArea-focusHighlight": { display: "none" },
            "&.Mui-focusVisible": { outline: "none" },

            "& .tf-project-frame": {
              position: "relative",
              paddingTop: `${TAB_HEIGHT - 1}px`,
              transition: "transform .18s ease",
            },
            "& .tf-project-tab": {
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 1,
              boxSizing: "border-box",
              height: TAB_HEIGHT,
              maxWidth: "75%",
              display: "flex",
              alignItems: "center",
              px: "12px",
              pt: "2px",
              backgroundImage: tabGradient(tab.rest),
              color: tab.ink,
              border: "1px solid",
              borderColor: tab.edge,
              borderBottom: "none",
              borderRadius: `7px 20px 0 0`,
              boxShadow: `0 -1px 3px ${alpha(dark ? theme.palette.surface.sunken : theme.palette.text.primary, dark ? 0.6 : 0.08)}`,
              transition: "border-color .15s ease",
              // Hover: a slightly stronger version of the same gradient fades
              // in over the resting one (a gradient cannot be transitioned
              // directly). Text sits above it.
              "&::before": {
                content: '""',
                position: "absolute",
                inset: 0,
                borderRadius: "inherit",
                backgroundImage: tabGradient(tab.hover),
                opacity: 0,
                transition: "opacity .18s ease",
                pointerEvents: "none",
              },
              "& > .MuiTypography-root": { position: "relative" },
            },
            "& .tf-project-body": {
              position: "relative",
              boxSizing: "border-box",
              // Square from tablet up; a touch wider than tall in the single
              // phone column, where a full-width square would be mostly empty.
              aspectRatio: { xs: "6 / 5", sm: "1 / 1" },
              display: "flex",
              flexDirection: "column",
              textAlign: "left",
              p: "18px",
              bgcolor: theme.palette.background.paper,
              // A faint corner wash in the project's own color, fading out
              // well before the text; the surface underneath stays opaque.
              backgroundImage: `radial-gradient(120% 70% at 0% 0%, ${alpha(projectAccent, dark ? 0.16 : 0.09)}, transparent 60%)`,
              border: "1px solid",
              borderColor: edge,
              // Top-left corner stays square: that is where the tab joins.
              borderRadius: `0 ${CARD_RADIUS}px ${CARD_RADIUS}px ${CARD_RADIUS}px`,
              boxShadow: theme.tf.shadow.card,
              transition: "box-shadow .18s ease, border-color .15s ease",
            },

            "&:hover .tf-project-frame": { transform: "translateY(-2px)" },
            "&:hover .tf-project-tab::before": { opacity: 1 },
            "&:hover .tf-project-body": { borderColor: "var(--brand-border-hover)" },
            "&:hover .tf-project-body": { boxShadow: `${theme.tf.shadow.raised}, 0 8px 24px ${alpha(projectAccent, dark ? 0.18 : 0.12)}` },

            // Keyboard focus: the same 1px border turns accent-colored and
            // gains one more pixel outside, on the tab and the card alike, so
            // the ring follows the tab-plus-card outline instead of boxing it.
            "&.Mui-focusVisible .tf-project-body": { borderColor: ring, boxShadow: `0 0 0 1px ${ring}` },
            "&.Mui-focusVisible .tf-project-tab": {
              borderColor: ring,
              boxShadow: `-1px -1px 0 0 ${ring}, 1px -1px 0 0 ${ring}`,
            },

            "@media (prefers-reduced-motion: reduce)": { "&:hover .tf-project-frame": { transform: "none" } },
          };
        }}
      >
        <Box className="tf-project-frame">
          <Box className="tf-project-tab" title={project.team.name}>
            <Box component="span" sx={VISUALLY_HIDDEN}>
              Team:{" "}
            </Box>
            <Typography component="span" noWrap sx={{ fontSize: "0.8rem", fontWeight: 600, lineHeight: 1.2, color: "inherit" }}>
              {project.team.name}
            </Typography>
          </Box>

          <Box className="tf-project-body">

            <Typography
              variant="subtitle1"
              component="h2"
              title={project.name}
              sx={{
                mt: "10px",
                fontSize: "1rem",
                lineHeight: 1.3,
                overflowWrap: "anywhere",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {project.name}
            </Typography>

            {/* The grown box and the clamped text are separate elements: a
                line-clamp on a box that has been stretched taller than its
                clamp lets part of the next line show underneath. */}
            <Box sx={{ mt: "6px", flexGrow: 1, minHeight: 0 }}>
              {project.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}
                >
                  {project.description}
                </Typography>
              )}
            </Box>

            <Box sx={{ mt: "12px", pt: "12px", borderTop: "1px solid", borderColor: "divider" }}>
              <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary">
                  Progress
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {pct}%
                </Typography>
              </Box>
              <GradientProgress value={pct} accent={projectAccent} done={pct === 100} label={`${project.name} progress`} />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, fontVariantNumeric: "tabular-nums" }}>
                {total === 0 ? "No tasks yet" : `${done} of ${total} done`}
              </Typography>
            </Box>
          </Box>
        </Box>
      </CardActionArea>
    </Box>
  );
}
