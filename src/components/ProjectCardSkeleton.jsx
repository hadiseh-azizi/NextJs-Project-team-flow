"use client";

import { Box, Skeleton } from "@mui/material";
import {
  PROJECT_TAB_HEIGHT,
  PROJECT_CARD_RADIUS,
  PROJECT_BODY_PADDING,
  PROJECT_BODY_MIN_HEIGHT,
} from "@/lib/projectGrid";

// A placeholder shaped like ProjectCard: the team tab at the top-left, a
// name line, two description lines, and under a hairline the progress
// label, the bar and the "x of y done" line. Every size comes from
// lib/projectGrid.js (the same file the real card reads), and the frame,
// border, radius and shadow are the card's own, so the card replaces it in
// place without the grid moving.
//
// Decorative: the list that holds these carries the "loading" label.
export default function ProjectCardSkeleton() {
  return (
    <Box aria-hidden sx={{ display: "flex" }}>
      <Box sx={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", pt: `${PROJECT_TAB_HEIGHT - 1}px` }}>
        <Box
          sx={(theme) => ({
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1,
            width: "42%",
            maxWidth: 120,
            height: PROJECT_TAB_HEIGHT,
            display: "flex",
            alignItems: "center",
            px: "12px",
            pt: "2px",
            boxSizing: "border-box",
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: theme.palette.line.main,
            borderBottom: "none",
            borderRadius: "7px 20px 0 0",
          })}
        >
          <Skeleton animation="wave" variant="rounded" width="100%" height={10} />
        </Box>

        <Box
          sx={(theme) => ({
            flex: 1,
            boxSizing: "border-box",
            minHeight: PROJECT_BODY_MIN_HEIGHT,
            display: "flex",
            flexDirection: "column",
            p: PROJECT_BODY_PADDING,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: theme.palette.line.main,
            borderRadius: `0 ${PROJECT_CARD_RADIUS}px ${PROJECT_CARD_RADIUS}px ${PROJECT_CARD_RADIUS}px`,
            boxShadow: theme.tf.shadow.card,
          })}
        >
          {/* Same line boxes as the real name (1rem x 1.3) and description (body2). */}
          <Box sx={{ height: 21, display: "flex", alignItems: "center" }}>
            <Skeleton animation="wave" variant="rounded" width="68%" height={14} />
          </Box>
          <Box sx={{ mt: "6px", flexGrow: 1 }}>
            <Box sx={{ height: 21, display: "flex", alignItems: "center" }}>
              <Skeleton animation="wave" variant="rounded" width="100%" height={10} />
            </Box>
            <Box sx={{ height: 21, display: "flex", alignItems: "center" }}>
              <Skeleton animation="wave" variant="rounded" width="55%" height={10} />
            </Box>
          </Box>

          <Box sx={{ mt: "10px", pt: "10px", borderTop: "1px solid", borderColor: "divider" }}>
            <Box sx={{ height: 18, mb: 0.75, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Skeleton animation="wave" variant="rounded" width={52} height={9} />
              <Skeleton animation="wave" variant="rounded" width={26} height={9} />
            </Box>
            <Skeleton animation="wave" variant="rounded" width="100%" height={4} sx={{ borderRadius: 2 }} />
            <Box sx={{ height: 18, mt: 0.75, display: "flex", alignItems: "center" }}>
              <Skeleton animation="wave" variant="rounded" width={72} height={9} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
