"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Box, Typography, Button, CircularProgress, Alert } from "@mui/material";
import AuthShell from "@/components/AuthShell";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const isMounted = useIsMounted();
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [error, setError] = useState("");
  // The verification token is single-use (see tokenVersion), so this must
  // fire at most once per token even if the effect re-runs (e.g. React
  // Strict Mode's dev double-invoke, or a parent re-render) — a second
  // call would hit an already-consumed token and misreport a real success
  // as a failure.
  const attemptedToken = useRef(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }
    if (attemptedToken.current === token) return;
    attemptedToken.current = token;

    apiFetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(() => {
        if (isMounted()) setStatus("success");
      })
      .catch((err) => {
        if (!isMounted()) return;
        setStatus("error");
        setError(errorMessage(err, "Verification failed."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <>
      {status === "verifying" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }} role="status">
          <CircularProgress size={20} aria-hidden />
          <Typography color="text.secondary">Verifying your email...</Typography>
        </Box>
      )}

      {status === "success" && (
        <>
          <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
            Email verified
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Your account is active — you can sign in now.
          </Typography>
          <Button component={Link} href="/login" variant="contained" fullWidth size="large">
            Sign in
          </Button>
        </>
      )}

      {status === "error" && (
        <>
          <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
            Verification failed
          </Typography>
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
          <Button component={Link} href="/login" variant="outlined" color="inherit" fullWidth size="large">
            Back to sign in
          </Button>
        </>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <VerifyEmailInner />
      </Suspense>
    </AuthShell>
  );
}
