"use client";

import Link from "next/link";
import { Card, CardActionArea, Box, Typography, AvatarGroup, Avatar } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useThemeMode } from "@/components/ThemeModeContext";
import { pastelForString } from "@/lib/pastelColor";
import { teamColorForId } from "@/lib/entityColor";
import TeamName from "@/components/TeamName";
import { avatarInitial } from "@/lib/avatarInitial";
import { staggerDelay } from "@/lib/staggerDelay";

// One team as a circle. Teams are circles and projects are squares (see
// ProjectCard) so the two lists are never confused with each other.
//
// Everything is sized in container-query units (cqw = 1% of the circle's
// own width), so the type and spacing scale with the circle and
// the same layout holds from a ~150px circle on a phone to a ~270px one on
// a wide screen. Content sits in a column ~64% of the diameter wide, which
// is what keeps text inside the curve at the top and bottom of the stack.
//
// The name leads the card; its first letter is set larger and painted in the
// team's identity color (see TeamName). The same color shows in a thin inner
// ring and the hover shadow. The outer edge stays neutral.
//
// `index` only feeds the entrance stagger.
export default function TeamCard({ team, index = 0 }) {
  const { mode } = useThemeMode();
  const dark = mode === "dark";
  const accent = teamColorForId(team.id, mode);
  const memberCount = team.members.length;

  return (
    <Box
      className="tf-settle-in"
      sx={{
        width: "100%",
        maxWidth: 272,
        justifySelf: "center",
        animationDelay: `${staggerDelay(index, 35)}ms`,
      }}
    >
      <Card
        sx={(theme) => ({
          position: "relative",
          aspectRatio: "1 / 1",
          borderRadius: "50%",
          overflow: "visible",
          containerType: "inline-size",
          boxShadow: theme.tf.shadow.card,
          // The circle's surface: opaque paper with a soft team-colored
          // glow rising from the lower edge, like light inside the ring.
          backgroundImage: `radial-gradient(90% 70% at 50% 110%, ${alpha(accent, dark ? 0.2 : 0.11)}, transparent 70%)`,
          transition: "box-shadow .18s ease, border-color .15s ease, transform .18s ease",
          // The inner ring: same center, inset from the edge, in the team color.
          "&::before": {
            content: '""',
            position: "absolute",
            inset: "3.5cqw",
            borderRadius: "50%",
            border: "4px solid",
            borderColor: alpha(accent, dark ? 0.5 : 0.42),
            pointerEvents: "none",
            transition: "border-color .15s ease, box-shadow .15s ease",
          },
          "&:hover": {
            borderColor: "var(--brand-border-hover)",
            boxShadow: `0 8px 26px ${alpha(accent, dark ? 0.32 : 0.2)}, 0 0 0 1px ${alpha(accent, dark ? 0.25 : 0.15)}`,
            transform: "scale(1.02)",
            "&::before": { borderColor: accent },
          },
          "@media (prefers-reduced-motion: reduce)": { "&:hover": { transform: "none" } },
        })}
      >
        <CardActionArea
          component={Link}
          href={`/dashboard/teams/${team.id}`}
          focusRipple={false}
          sx={{
            height: "100%",
            borderRadius: "50%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            px: "18cqw",
            "& .MuiCardActionArea-focusHighlight": { display: "none" },
            "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 4 },
          }}
        >
          <Typography
            variant="subtitle1"
            component="h2"
            sx={{
              width: "100%",
              fontFamily: "'Fraunces', Georgia, serif",
              fontWeight: 500,
              fontSize: "clamp(0.9375rem, 8.5cqw, 1.5rem)",
              lineHeight: 3.7,
              letterSpacing: "-0.01em",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: { xs: 2, sm: 3 },
              overflow: "hidden",
            }}
          >
            <TeamName name={team.name} accent={accent} mode={mode} scale={1.5} />
          </Typography>

          <Typography
            color="text.secondary"
            sx={{
              mt: "1.5cqw",
              width: "100%",
              fontSize: "clamp(0.6875rem, 4.6cqw, 0.8125rem)",
              lineHeight: 1.3,
              overflowWrap: "anywhere",
              // Two lines on a phone-size circle, one line where there is room.
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: { xs: 2, sm: 1 },
              overflow: "hidden",
            }}
          >
            Managed by {team.manager?.name}
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75, mt: "3cqw", maxWidth: "100%" }}>
            <AvatarGroup
              max={4}
              sx={{
                display: { xs: "none", sm: "flex" },
                "& .MuiAvatar-root": { width: 22, height: 22, fontSize: 11, borderColor: "background.paper" },
              }}
            >
              {team.members.map((m) => (
                <Avatar key={m.id} aria-label={m.name} sx={{ bgcolor: pastelForString(m.id, mode) }}>
                  {avatarInitial(m.name)}
                </Avatar>
              ))}
            </AvatarGroup>
            <Typography
              color="text.secondary"
              noWrap
              sx={{ fontSize: "clamp(0.6875rem, 4.6cqw, 0.75rem)", fontVariantNumeric: "tabular-nums" }}
            >
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </Typography>
          </Box>
        </CardActionArea>
      </Card>
    </Box>
  );
}
