"use client";

import { Box, Skeleton, Typography } from "@mui/material";
import PageHeader from "@/components/PageHeader";

// Placeholder for the team page's member list (and, for a manager, the
// invite form and the pending-invitations list), drawn from the team's
// remembered shape (lib/loadShapeCache.js).
//
// The panel, heading, rows and measurements are the page's own: `panelSx`,
// `rowSx` and `listSx` are exported from here and used by the real page
// too, so the placeholder and the real list cannot drift apart. A row is
// the real row: a 28px avatar circle, a name line, and, for a manager, a
// "Remove" button slot. The static headings ("Team members", "Pending
// invitations") are real text, not data, so they are shown as they are.
//
// No names, emails or images are drawn. Name bars cycle through a few
// fixed widths purely so the list does not read as a column of identical
// bars. Decorative: the page wraps this in a labelled status region.

export const rowSx = { display: "flex", alignItems: "center", gap: 1.5, py: 1.25, borderBottom: "1px solid", borderColor: "divider", minHeight: 52 };
export const listSx = { listStyle: "none", m: 0, p: 0, borderTop: "1px solid", borderColor: "divider", "& > li:last-of-type": { borderBottom: "none" } };

// Member and invitation lists each sit on a panel: opaque surface, brand
// wash at the top edge, gradient hairline.
export const panelSx = {
  bgcolor: "background.paper",
  backgroundImage: "var(--brand-panel-wash)",
  border: "1px solid",
  borderColor: "divider",
  borderRadius: 1,
  boxShadow: "var(--brand-shadow-card)",
  overflow: "hidden",
  px: { xs: 2, sm: 3 },
  pt: { xs: 2.5, sm: 3 },
  pb: 1,
  maxWidth: 520,
};

// The page header above the panels, drawn with the page's own PageHeader
// ("Teams" link, title, the "Managed by" line, and the Rename button a
// manager has) so the form and panels start at the same height before and
// after loading. Used when the team's shape is remembered; otherwise the
// page keeps its plain three-bar placeholder.
export function TeamHeaderSkeleton({ shape }) {
  return (
    <PageHeader
      back={{ href: "/dashboard/teams", label: "Teams" }}
      title={<Skeleton animation="wave" width={200} sx={{ maxWidth: "100%" }} />}
      description={<Skeleton animation="wave" width={160} />}
      // The real page passes no actions at all to a non-manager (no empty box).
      actions={shape.manager ? <Skeleton animation="wave" variant="rounded" width={106.5} height={36} /> : undefined}
    />
  );
}

const NAME_WIDTHS = ["42%", "34%", "48%", "38%"];
const EMAIL_WIDTHS = ["64%", "52%", "70%", "58%"];
const WAVE = { animation: "wave" };

export default function TeamMembersSkeleton({ shape }) {
  const { manager, members, invites, managerRow } = shape;
  return (
    <>
      {manager && (
        // Same box as the invite form: a field (label above, 40px input) and the button.
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-end", mb: 3, flexWrap: "wrap", maxWidth: 520 }}>
          <Box sx={{ flex: "1 1 240px" }}>
            {/* Same label box as FormField's: 13px text, 6px below. */}
            <Box sx={{ display: "block", mb: 0.75, fontSize: "0.8125rem", lineHeight: 1.3 }}>
              <Skeleton {...WAVE} width={120} />
            </Box>
            <Skeleton {...WAVE} variant="rounded" height={40} />
          </Box>
          <Skeleton {...WAVE} variant="rounded" height={36} sx={{ width: { xs: "100%", sm: 108 } }} />
        </Box>
      )}

      <Box component="section" className="tf-topline" sx={{ ...panelSx, mb: invites > 0 ? 3 : 0 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Team members
        </Typography>
        <Box component="ul" sx={listSx}>
          {Array.from({ length: members }, (_, i) => (
            <Box component="li" key={i} sx={rowSx}>
              <Skeleton {...WAVE} variant="circular" width={28} height={28} sx={{ flexShrink: 0 }} />
              <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0 }}>
                <Skeleton {...WAVE} width={NAME_WIDTHS[i % NAME_WIDTHS.length]} />
              </Typography>
              {/* A small button (30px) with its text: the Remove slot. Not shown for the manager's own row. */}
              {manager && i !== managerRow && <Skeleton {...WAVE} variant="rounded" width={62} height={30} sx={{ flexShrink: 0 }} />}
            </Box>
          ))}
        </Box>
      </Box>

      {invites > 0 && (
        <Box component="section" className="tf-topline" sx={panelSx}>
          <Typography variant="h6" component="h2">
            Pending invitations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            These people have been invited by email but haven't created an account yet.
          </Typography>
          <Box component="ul" sx={listSx}>
            {Array.from({ length: invites }, (_, i) => (
              <Box component="li" key={i} sx={rowSx}>
                <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0 }}>
                  <Skeleton {...WAVE} width={EMAIL_WIDTHS[i % EMAIL_WIDTHS.length]} />
                </Typography>
                <Skeleton {...WAVE} variant="rounded" width={118} height={30} sx={{ flexShrink: 0 }} />
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}
