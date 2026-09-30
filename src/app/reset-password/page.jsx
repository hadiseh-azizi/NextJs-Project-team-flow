"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Typography,
  Button,
  Alert,
  Link as MuiLink,
  IconButton,
  InputAdornment,
  LinearProgress,
  Box,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import AuthShell from "@/components/AuthShell";
import Field from "@/components/FormField";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";
import { scorePasswordStrength } from "@/lib/passwordStrength";

const MIN_PASSWORD_LENGTH = 6;
const STRENGTH_COLORS = ["error", "error", "warning", "info", "success"];

function PasswordField({ label, value, onChange, autoComplete, sx }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      required
      value={value}
      onChange={onChange}
      sx={sx}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible((v) => !v)}
              edge="end"
              size="small"
            >
              {visible ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const isMounted = useIsMounted();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // A missing token means the link itself was malformed — no point
  // rendering a form that can never submit successfully.
  const [invalidLink, setInvalidLink] = useState(!token);

  const strength = useMemo(() => scorePasswordStrength(password), [password]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      if (isMounted()) setSuccess(true);
    } catch (err) {
      if (!isMounted()) return;
      // The API returns the same generic message for a missing, malformed,
      // expired, or already-used token — treat all of them the same way
      // here too, by switching to the dedicated invalid-link state rather
      // than showing it as an inline form error.
      if (err?.status === 400 && /invalid or has expired/i.test(err.message)) {
        setInvalidLink(true);
      } else {
        setError(errorMessage(err, "Something went wrong. Please try again."));
      }
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  if (invalidLink) {
    return (
      <>
        <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
          Link expired
        </Typography>
        <Alert severity="error" sx={{ mb: 3 }}>
          This password reset link is invalid or has expired.
        </Alert>
        <Button component={Link} href="/forgot-password" variant="contained" fullWidth size="large">
          Request a new link
        </Button>
      </>
    );
  }

  if (success) {
    return (
      <>
        <Typography variant="h5" component="h1" sx={{ mb: 1.5 }}>
          Password changed
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Your password has been changed successfully. You can now sign in with your new password.
        </Typography>
        <Button component={Link} href="/login" variant="contained" fullWidth size="large">
          Sign in
        </Button>
      </>
    );
  }

  return (
    <>
      <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
        Choose a new password
      </Typography>

      {error && (
        <Alert severity="error" className="tf-shake" sx={{ mb: 2.5 }}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ mb: password ? 1 : 2.5 }}
        />
        {password && (
          <Box sx={{ mb: 2.5 }}>
            <LinearProgress
              variant="determinate"
              value={(strength.score / 4) * 100}
              color={STRENGTH_COLORS[strength.score]}
              sx={{ mb: 0.75 }}
            />
            <Typography variant="caption" color="text.secondary">
              {strength.label}
            </Typography>
          </Box>
        )}
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          sx={{ mb: 3 }}
        />
        <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
          {loading ? "Resetting..." : "Reset password"}
        </Button>
      </form>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
        <MuiLink component={Link} href="/login" color="inherit" sx={{ fontWeight: 600 }}>
          Back to sign in
        </MuiLink>
      </Typography>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
