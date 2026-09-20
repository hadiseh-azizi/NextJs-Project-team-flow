"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Box, Paper, Typography, TextField, Button, Alert } from "@mui/material";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
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
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 380, p: 4, textAlign: "center" }}>
        <MarkEmailReadIcon color="primary" sx={{ fontSize: 48, mb: 1 }} />
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
          Check your email
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          We sent a verification link to <strong>{registeredEmail}</strong>. Click it to activate your
          account, then come back and sign in.
        </Typography>
        <Button component={Link} href="/login" variant="contained" fullWidth size="large">
          Go to sign in
        </Button>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ width: "100%", maxWidth: 380, p: 4 }}>
      <Typography
        component={Link}
        href="/"
        sx={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "1.1rem", textDecoration: "none", color: "text.primary", display: "block", mb: 3 }}
      >
        TeamFlow<Box component="span" sx={{ color: "primary.main" }}>.</Box>
      </Typography>

      <Typography variant="overline" color="primary" fontWeight={700}>
        Sign up
      </Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Create your account
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <TextField
          label="Name"
          fullWidth
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Email"
          type="email"
          fullWidth
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Password"
          type="password"
          fullWidth
          required
          inputProps={{ minLength: 6 }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ mb: 3 }}
        />
        <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
          {loading ? "Creating account..." : "Sign up"}
        </Button>
      </form>

      <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 3 }}>
        Already have an account?{" "}
        <Link href="/login" style={{ color: "inherit", fontWeight: 600 }}>
          Sign in
        </Link>
      </Typography>
    </Paper>
  );
}

export default function RegisterPage() {
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
        <RegisterForm />
      </Suspense>
    </Box>
  );
}
