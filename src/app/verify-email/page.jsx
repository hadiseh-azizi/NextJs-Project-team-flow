"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Box, Paper, Typography, Button, CircularProgress, Alert } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(data.error || "Verification failed.");
          return;
        }
        setStatus("success");
      })
      .catch(() => {
        setStatus("error");
        setError("Something went wrong. Please try again.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <Paper variant="outlined" sx={{ width: "100%", maxWidth: 400, p: 4, textAlign: "center" }}>
      <Typography
        component={Link}
        href="/"
        sx={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "1.1rem", textDecoration: "none", color: "text.primary", display: "block", mb: 3 }}
      >
        TeamFlow<Box component="span" sx={{ color: "primary.main" }}>.</Box>
      </Typography>

      {status === "verifying" && (
        <>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography color="text.secondary">Verifying your email...</Typography>
        </>
      )}

      {status === "success" && (
        <>
          <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
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
          <ErrorOutlineIcon color="error" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Verification failed
          </Typography>
          <Alert severity="error" sx={{ mb: 3, textAlign: "left" }}>
            {error}
          </Alert>
          <Button component={Link} href="/login" variant="outlined" fullWidth>
            Back to sign in
          </Button>
        </>
      )}
    </Paper>
  );
}

export default function VerifyEmailPage() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        bgcolor: "background.default",
      }}
    >
      <Suspense fallback={null}>
        <VerifyEmailInner />
      </Suspense>
    </Box>
  );
}
