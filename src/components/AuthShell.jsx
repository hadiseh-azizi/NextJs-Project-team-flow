"use client";

import { Box } from "@mui/material";
import TeamFlowBrand from "@/components/TeamFlowBrand";

// Sign-in, sign-up and verification share one frame: the brand top-left and
// a single narrow column on a quiet surface. The page atmosphere (from
// globals.css) supplies the color; the form sits on an opaque panel with a
// thin gradient line on top, so inputs and text never sit on a tint.
export default function AuthShell({ children, width = 400 }) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Box component="header" sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <TeamFlowBrand size="lg" />
      </Box>
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "center",
          px: 2,
          pt: { xs: 2, sm: 0 },
          pb: { xs: 6, sm: 10 },
        }}
      >
        <Box
          className="tf-topline"
          sx={(theme) => ({
            width: "100%",
            maxWidth: width,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            boxShadow: theme.tf.shadow.raised,
            px: { xs: 2.5, sm: 4 },
            pt: { xs: 3.5, sm: 4.5 },
            pb: { xs: 3, sm: 4 },
            overflow: "hidden",
          })}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
