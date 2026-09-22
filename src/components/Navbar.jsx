"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { AppBar, Toolbar, Button, Box, Avatar, Typography } from "@mui/material";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import ViewKanbanOutlinedIcon from "@mui/icons-material/ViewKanbanOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import { useThemeMode } from "@/components/ThemeModeContext";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import Wordmark from "@/components/Wordmark";
import { pastelForString } from "@/lib/pastelColor";
import { avatarInitial } from "@/lib/avatarInitial";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardOutlinedIcon },
  { href: "/dashboard/projects", label: "Projects", icon: ViewKanbanOutlinedIcon },
  { href: "/dashboard/teams", label: "Teams", icon: GroupsOutlinedIcon },
];

export default function Navbar({ userName }) {
  const pathname = usePathname();
  const { mode } = useThemeMode();
  const [signingOut, setSigningOut] = useState(false);

  // "Projects" stays lit while you are inside a project, "Teams" inside a
  // team; the dashboard root only matches itself.
  function isActive(href) {
    return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  function handleSignOut() {
    // signOut() navigates away, but that redirect isn't instant — without
    // this guard a fast double-click fires the request twice.
    if (signingOut) return;
    setSigningOut(true);
    signOut({ callbackUrl: "/" });
  }

  return (
    <AppBar position="sticky" component="header">
      <Toolbar
        component="nav"
        aria-label="Main"
        disableGutters
        sx={{ maxWidth: 1200, mx: "auto", width: "100%", px: { xs: 2, sm: 3 }, minHeight: { xs: 52, sm: 56 }, gap: { xs: 0.5, sm: 3 } }}
      >
        <Box sx={{ display: { xs: "none", sm: "block" } }}>
          <Wordmark href="/dashboard" />
        </Box>
        <Box sx={{ display: { xs: "block", sm: "none" }, mr: 0.5 }}>
          <Wordmark href="/dashboard" compact />
        </Box>

        <Box sx={{ display: "flex", alignSelf: "stretch", flexGrow: 1, gap: { xs: 0, sm: 0.5 } }}>
          {LINKS.map((l) => {
            const active = isActive(l.href);
            const Icon = l.icon;
            return (
              <Box
                key={l.href}
                component={Link}
                href={l.href}
                aria-label={l.label}
                aria-current={active ? "page" : undefined}
                sx={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  px: { xs: 1.25, sm: 1.5 },
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 500,
                  color: active ? "text.primary" : "text.secondary",
                  textDecoration: "none",
                  transition: "color .12s ease",
                  "&:hover": { color: "text.primary" },
                  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2, borderRadius: 0.5 },
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    left: { xs: 8, sm: 12 },
                    right: { xs: 8, sm: 12 },
                    bottom: -1,
                    height: 2,
                    bgcolor: "primary.main",
                    opacity: active ? 1 : 0,
                    transition: "opacity .12s ease",
                  },
                }}
              >
                <Icon sx={{ fontSize: 20, display: { xs: "block", sm: "none" } }} />
                <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{l.label}</Box>
              </Box>
            );
          })}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.5, sm: 1 }, flexShrink: 0 }}>
          <ThemeToggleButton />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: { xs: 0.5, sm: 1 } }}>
            <Avatar sx={{ width: 26, height: 26, fontSize: 12, bgcolor: pastelForString(userName, mode) }}>
              {avatarInitial(userName)}
            </Avatar>
            <Typography variant="body2" noWrap sx={{ display: { xs: "none", md: "block" }, maxWidth: 160, fontWeight: 500 }}>
              {userName}
            </Typography>
          </Box>
          <Button
            size="small"
            color="inherit"
            disabled={signingOut}
            aria-label="Sign out"
            onClick={handleSignOut}
            sx={{ minWidth: 0, px: { xs: 1, sm: 1.25 }, color: "text.secondary", "&:hover": { color: "text.primary" } }}
          >
            <LogoutIcon sx={{ fontSize: 18, display: { xs: "block", sm: "none" } }} />
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>Sign out</Box>
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
