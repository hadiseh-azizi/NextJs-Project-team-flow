"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Box, Paper, Typography, TextField, Button, Alert } from "@mui/material";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", { email, password, redirect: false });

    setLoading(false);
    if (res?.error) {
      setError("Incorrect email or password");
      return;
    }
    router.push("/dashboard");
  }

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
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 380, p: 4 }}>
        <Typography
          component={Link}
          href="/"
          sx={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "1.1rem", textDecoration: "none", color: "text.primary", display: "block", mb: 3 }}
        >
          TeamFlow<Box component="span" sx={{ color: "primary.main" }}>.</Box>
        </Typography>

        <Typography variant="overline" color="primary" fontWeight={700}>
          Sign in
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
          Welcome back to TeamFlow
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            sx={{ mb: 3 }}
          />
          <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 3 }}>
          Don't have an account?{" "}
          <Link href="/register" style={{ color: "inherit", fontWeight: 600 }}>
            Sign up
          </Link>
        </Typography>
      </Paper>
    </Box>
  );
}
