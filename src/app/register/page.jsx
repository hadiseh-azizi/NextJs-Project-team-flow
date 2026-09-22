"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Typography, Button, Alert, Link as MuiLink } from "@mui/material";
import AuthShell from "@/components/AuthShell";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";

function RegisterForm() {
  const searchParams = useSearchParams();
  const isMounted = useIsMounted();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");

  // Coming from a team invitation email prefills the address so it matches
  // exactly what was invited — that's what makes the auto-join on signup work.
  useEffect(() => {
    const invited = searchParams.get("email");
    if (invited) setEmail(invited);
  }, [searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      // Sign-in is blocked until the email is confirmed, so there's no point
      // trying to log them in right away — just tell them to check their inbox.
      if (isMounted()) setRegisteredEmail(email);
    } catch (err) {
      if (isMounted()) setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  if (registeredEmail) {
    return (
      <>
        <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
          Check your email
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3, overflowWrap: "anywhere" }}>
          We sent a verification link to <strong>{registeredEmail}</strong>. Click it to activate your
          account, then come back and sign in.
        </Typography>
        <Button component={Link} href="/login" variant="contained" fullWidth size="large">
          Go to sign in
        </Button>
      </>
    );
  }

  return (
    <>
      <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
        Create your account
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Field
          label="Name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 2.5 }}
        />
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
          autoComplete="new-password"
          required
          inputProps={{ minLength: 6 }}
          helperText="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ mb: 3 }}
        />
        <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
          {loading ? "Creating account..." : "Sign up"}
        </Button>
      </form>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
        Already have an account?{" "}
        <MuiLink component={Link} href="/login" color="inherit" sx={{ fontWeight: 600 }}>
          Sign in
        </MuiLink>
      </Typography>
    </>
  );
}

export default function RegisterPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
