"use client";

import Link from "next/link";
import { Button, Typography } from "@mui/material";
import EmptyState from "@/components/EmptyState";

// Shown by the error.jsx boundaries when a page fails to render. It never
// displays the error's own message: in production Next replaces server
// errors with a generic one anyway, and a raw message (a driver or query
// error, say) is not something to show a user. `digest` is the opaque id
// Next attaches so the matching server log line can be found.
export default function RouteError({ error, reset, homeHref = "/dashboard", homeLabel = "Go to dashboard" }) {
  return (
    <>
    <EmptyState
      title="Something went wrong"
      description="This page couldn't be loaded. Try again; if it keeps happening, come back in a few minutes."
      action={
        <>
          <Button variant="contained" onClick={() => reset()}>
            Try again
          </Button>
          <Button component={Link} href={homeHref} color="inherit">
            {homeLabel}
          </Button>
        </>
      }
    />
    {error?.digest && (
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 1.5 }}>
        Reference: {error.digest}
      </Typography>
    )}
    </>
  );
}
