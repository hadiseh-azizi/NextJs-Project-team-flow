"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Box, Typography, Button, Alert } from "@mui/material";
import PageHeader from "@/components/PageHeader";
import Field from "@/components/FormField";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";
import { panelSx } from "@/components/TeamMembersSkeleton";
import { apiFetch, errorMessage } from "@/lib/apiFetch";
import { useIsMounted } from "@/lib/clientAsync";
import { MAX_USER_NAME_LENGTH } from "@/lib/fieldLimits";
import { PASSWORD_MIN_LENGTH } from "@/lib/passwordPolicy";

const sectionSx = { ...panelSx, pb: 3, mb: 3 };

export default function AccountPage() {
  const router = useRouter();
  const isMounted = useIsMounted();
  const { data: session, update } = useSession();
  const email = session?.user?.email || "";

  // Profile
  const [name, setName] = useState(session?.user?.name || "");
  const [savedName, setSavedName] = useState(session?.user?.name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwChanged, setPwChanged] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleSaveName(e) {
    e.preventDefault();
    if (nameSaving || !name.trim() || name.trim() === savedName) return;
    setNameSaving(true);
    setNameError("");
    setNameSaved(false);
    try {
      const data = await apiFetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!isMounted()) return;
      setName(data.name);
      setSavedName(data.name);
      setNameSaved(true);
      // Refetch the session (the server reads the new name into it) and
      // re-render the layout so the navbar shows it.
      await update();
      router.refresh();
    } catch (err) {
      if (isMounted()) setNameError(errorMessage(err, "Couldn't save your name. Please try again."));
    } finally {
      if (isMounted()) setNameSaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwSaving) return;
    setPwError("");
    if (newPassword !== confirmPassword) {
      setPwError("The new passwords don't match");
      return;
    }
    setPwSaving(true);
    try {
      await apiFetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!isMounted()) return;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwChanged(true);
    } catch (err) {
      if (isMounted()) setPwError(errorMessage(err, "Couldn't change your password. Please try again."));
    } finally {
      if (isMounted()) setPwSaving(false);
    }
  }

  return (
    <Box>
      <PageHeader title="Account" description={email} />

      <Box component="section" aria-labelledby="account-profile-heading" sx={sectionSx}>
        <Typography id="account-profile-heading" variant="h6" component="h2" sx={{ mb: 2 }}>
          Profile
        </Typography>
        <Box component="form" onSubmit={handleSaveName}>
          <Field
            label="Name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameSaved(false);
            }}
            inputProps={{ maxLength: MAX_USER_NAME_LENGTH }}
            autoComplete="name"
            sx={{ mb: 2 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your email address is your sign-in and can't be changed here.
          </Typography>
          {nameError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {nameError}
            </Alert>
          )}
          {nameSaved && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Name updated.
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={nameSaving || !name.trim() || name.trim() === savedName}>
            {nameSaving ? "Saving..." : "Save"}
          </Button>
        </Box>
      </Box>

      <Box component="section" aria-labelledby="account-password-heading" sx={sectionSx}>
        <Typography id="account-password-heading" variant="h6" component="h2" sx={{ mb: 2 }}>
          Password
        </Typography>
        {pwChanged ? (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>
              Password changed. For your security you've been signed out on all devices. Sign in again with the new password.
            </Alert>
            <Button variant="contained" onClick={() => signOut({ callbackUrl: "/login" })}>
              Go to sign in
            </Button>
          </>
        ) : (
          <Box component="form" onSubmit={handleChangePassword}>
            <Field
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              helperText={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              sx={{ mb: 2 }}
            />
            <Field
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              sx={{ mb: 2 }}
            />
            {pwError && (
              <Alert severity="error" className="tf-shake" sx={{ mb: 2 }}>
                {pwError}
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword}>
              {pwSaving ? "Updating..." : "Update password"}
            </Button>
          </Box>
        )}
      </Box>

      <Box component="section" aria-labelledby="account-delete-heading" sx={sectionSx}>
        <Typography id="account-delete-heading" variant="h6" component="h2" sx={{ mb: 1 }}>
          Delete account
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Permanently deletes your account. If you manage a team, delete the team first.
        </Typography>
        <Button color="error" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </Box>

      <DeleteAccountDialog open={deleteOpen} email={email} onClose={() => setDeleteOpen(false)} />
    </Box>
  );
}
