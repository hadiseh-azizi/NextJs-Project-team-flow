"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { AppBar, Toolbar, Typography, Button, Stack, Box, Avatar } from "@mui/material";
import { alpha } from "@mui/material/styles";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import GroupsIcon from "@mui/icons-material/Groups";
import LogoutIcon from "@mui/icons-material/Logout";
import { useThemeMode } from "@/components/ThemeModeContext";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";

export default function Navbar({ userName }) {
  const pathname = usePathname();
  const { mode } = useThemeMode();
  const [signingOut, setSigningOut] = useState(false);

  const links = [
    { href: "/dashboard", label: "Dashboard", icon: <DashboardIcon sx={{ fontSize: 18 }} /> },
    { href: "/dashboard/projects", label: "Projects", icon: <ViewKanbanIcon sx={{ fontSize: 18 }} /> },
    { href: "/dashboard/teams", label: "Teams", icon: <GroupsIcon sx={{ fontSize: 18 }} /> },
  ];

  function handleSignOut() {
    // signOut() navigates away, but that redirect isn't instant — without
    // this guard a fast double-click fires the request twice.
    if (signingOut) return;
    setSigningOut(true);
    signOut({ callbackUrl: "/" });
  }

  return (
    <AppBar position="sticky" color="transparent" elevation={0}>
      <Toolbar sx={{ maxWidth: 1152, mx: "auto", width: "100%", gap: { xs: 0.25, sm: 0.5 }, py: 1 }}>
        <Typography
          component={Link}
          href="/dashboard"
          sx={{
            fontFamily: "'Fraunces', serif",
            fontWeight: 700,
            fontSize: "1.15rem",
            textDecoration: "none",
            color: "text.primary",
            ml: { xs: 1, sm: 4 },
            flexShrink: 0,
          }}
        >
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>TeamFlow</Box>
          <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>T</Box>
          <Box component="span" sx={{ color: "primary.main" }}>.</Box>
        </Typography>

        <Stack direction="row" spacing={{ xs: 0, sm: 0.5 }} sx={{ flexGrow: 1, overflow: "hidden" }}>
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Button
                key={l.href}
                component={Link}
                href={l.href}
                disableRipple
                aria-label={l.label}
                aria-current={active ? "page" : undefined}
                sx={(theme) => ({
                  minWidth: 0,
                  px: { xs: 1, sm: 2 },
                  color: active ? "primary.main" : "text.secondary",
                  bgcolor: active ? alpha(theme.palette.primary.main, 0.1) : "transparent",
                  fontWeight: active ? 700 : 500,
                  "&:hover": { bgcolor: active ? alpha(theme.palette.primary.main, 0.14) : theme.palette.action.hover },
                })}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  {l.icon}
                  <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>{l.label}</Box>
                </Box>
              </Button>
            );
          })}
        </Stack>

        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.25, sm: 1 }, flexShrink: 0 }}>
          <ThemeToggleButton />

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ pl: 0.5, pr: { xs: 0, sm: 1 }, borderRight: { xs: "none", sm: "1px solid" }, borderColor: "divider" }}
          >
            <Avatar sx={{ width: 26, height: 26, fontSize: 12, bgcolor: pastelForString(userName, mode), color: mode === "dark" ? "#F1EEFB" : "#221F2E" }}>
              {avatarInitial(userName)}
            </Avatar>
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ display: { xs: "none", sm: "block" }, maxWidth: 160 }}
            >
              {userName}
            </Typography>
          </Stack>
          <Button
            size="small"
            color="inherit"
            disableRipple
            disabled={signingOut}
            aria-label="Sign out"
            sx={{ minWidth: 0, px: { xs: 1, sm: 2 }, color: "text.secondary", "&:hover": { color: "error.main", bgcolor: "transparent" } }}
            onClick={handleSignOut}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <LogoutIcon sx={{ fontSize: 16 }} />
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>Sign out</Box>
            </Box>
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
