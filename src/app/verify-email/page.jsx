"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Box, Typography, Button, CircularProgress, Alert } from "@mui/material";
import AuthShell from "@/components/AuthShell";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMounted = useIsMounted();
  // verifying -> the token POST is in flight.
  // signing-in -> verification succeeded and the automatic signIn() call
  //   (using the one-time autoLoginToken the API returned) is in flight.
  // manual-fallback -> verification succeeded but automatic sign-in
  //   didn't (no token issued, or signIn() itself failed) — the person
  //   still needs to sign in themselves, but their email IS verified.
  // error -> the verification token itself was missing/invalid/expired/
  //   already used; no sign-in was ever attempted.
  const [status, setStatus] = useState("verifying");
  const [error, setError] = useState("");
  // The verification token is single-use (see tokenVersion), so this must
  // fire at most once per token even if the effect re-runs (e.g. React
  // Strict Mode's dev double-invoke, or a parent re-render) — a second
  // call would hit an already-consumed token and misreport a real success
  // as a failure. Because the whole verify -> auto-sign-in sequence below
  // runs inside this single guarded call, the signIn() step is equally
  // protected from firing twice.
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
      .then(async (data) => {
        if (!isMounted()) return;

        // The email IS verified at this point no matter what happens
        // next — a missing token or a failed signIn() below is an
        // auto-sign-in problem, not a verification one, and must never
        // be reported through the "error" (verification failed) state.
        if (!data?.autoLoginToken) {
          setStatus("manual-fallback");
          return;
        }

        setStatus("signing-in");
        let res;
        try {
          res = await signIn("credentials", { autoLoginToken: data.autoLoginToken, redirect: false });
        } catch {
          res = null;
        }
        if (!isMounted()) return;
        if (!res?.ok || res.error) {
          setStatus("manual-fallback");
          return;
        }
        router.push("/dashboard");
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
      {(status === "verifying" || status === "signing-in") && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }} role="status">
          <CircularProgress size={20} aria-hidden />
          <Typography color="text.secondary">
            {status === "verifying" ? "Verifying your email..." : "Email verified. Signing you in..."}
          </Typography>
        </Box>
      )}

      {status === "manual-fallback" && (
        <>
          <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
            Email verified
          </Typography>
          <Alert severity="warning" sx={{ mb: 3 }}>
            Your email was verified successfully, but we couldn't sign you in automatically. Please sign in manually.
          </Alert>
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
