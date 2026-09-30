"use client";

import { useState } from "react";
import Link from "next/link";
import { Typography, Button, Alert, Link as MuiLink } from "@mui/material";
import AuthShell from "@/components/AuthShell";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

export default function ForgotPasswordPage() {
  const isMounted = useIsMounted();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // The API always responds { ok: true } regardless of whether the
      // address is registered — see forgot-password/route.js — so this
      // branch is the only outcome for a well-formed request; a thrown
      // error below means the request itself was malformed or the network
      // failed, not that the email doesn't exist.
      if (isMounted()) setSubmitted(true);
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
          Check your email
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          If an account exists for <strong>{email}</strong>, a password reset link has been sent. The
          link expires in 1 hour.
        </Typography>
        <Button component={Link} href="/login" variant="contained" fullWidth size="large">
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
        Reset your password
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Enter the email address on your account and we'll send you a link to reset your password.
      </Typography>

      {error && (
        <Alert severity="error" className="tf-shake" sx={{ mb: 2.5 }}>
          {error}
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
          sx={{ mb: 3 }}
        />
        <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
        <MuiLink component={Link} href="/login" color="inherit" sx={{ fontWeight: 600 }}>
          Back to sign in
        </MuiLink>
      </Typography>
    </AuthShell>
  );
}
