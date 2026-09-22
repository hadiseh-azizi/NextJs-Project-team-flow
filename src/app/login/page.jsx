"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Typography, Button, Alert, Link as MuiLink } from "@mui/material";
import AuthShell from "@/components/AuthShell";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

export default function LoginPage() {
  const router = useRouter();
  const isMounted = useIsMounted();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setNeedsVerification(false);
    setResent(false);
    setLoading(true);

    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!isMounted()) return;
      if (res?.error) {
        if (res.error === "EmailNotVerified") {
          setNeedsVerification(true);
        } else if (res.error === "TooManyAttempts") {
          setError("Too many sign-in attempts. Please wait a few minutes and try again.");
        } else {
          setError("Incorrect email or password");
        }
        return;
      }
      router.push("/dashboard");
    } catch {
      if (isMounted()) setError("Something went wrong. Please try again.");
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  async function handleResend() {
    if (resending) return;
    setResending(true);
    try {
      await apiFetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (isMounted()) setResent(true);
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Couldn't resend the verification email. Please try again."));
    } finally {
      if (isMounted()) setResending(false);
    }
  }

  return (
    <AuthShell>
      <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
        Sign in to TeamFlow
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }}>
          {error}
        </Alert>
      )}

      {needsVerification && (
        <Alert
          severity="warning"
          sx={{ mb: 2.5 }}
          action={
            !resent && (
              <Button color="inherit" size="small" onClick={handleResend} disabled={resending}>
                {resending ? "Sending..." : "Resend"}
              </Button>
            )
          }
        >
          {resent
            ? "Verification email resent — check your inbox."
            : "Please verify your email before signing in."}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          sx={{ mb: 2.5 }}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ mb: 3 }}
        />
        <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
        Don't have an account?{" "}
        <MuiLink component={Link} href="/register" color="inherit" sx={{ fontWeight: 600 }}>
          Sign up
        </MuiLink>
      </Typography>
    </AuthShell>
  );
}
