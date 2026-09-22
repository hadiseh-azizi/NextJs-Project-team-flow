"use client";

import { Box } from "@mui/material";
import Wordmark from "@/components/Wordmark";

// Sign-in, sign-up and verification share one frame: the wordmark top-left
// and a single narrow column of content on the page itself — no card.
export default function AuthShell({ children, width = 360 }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      <Box component="header" sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Wordmark />
      </Box>
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "center",
          px: 2,
          pt: { xs: 3, sm: 0 },
          pb: { xs: 6, sm: 10 },
        }}
      >
        <Box sx={{ width: "100%", maxWidth: width }}>{children}</Box>
      </Box>
    </Box>
  );
}
