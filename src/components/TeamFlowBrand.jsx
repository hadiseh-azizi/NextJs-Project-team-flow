"use client";

import Link from "next/link";
import { Box } from "@mui/material";
import { WORDMARK } from "@/lib/brand";

// The one place the Team Flow identity is rendered. Every logo in the app
// comes from here, from the same source image (public/brand/symbol.png).
//
//   variant="full"   symbol + "Team Flow"
//   variant="icon"   symbol only (narrow toolbars, favicon-sized contexts)
//
//   size="md"        navigation bars
//   size="lg"        landing and authentication pages
//
// Pass href={null} to render the brand without a link. Pass
// collapseOnNarrow to drop the wordmark (symbol stays) below 400px, for
// headers that share a row with buttons; the symbol keeps its 333:276
// proportions at every size.
const SIZES = {
  md: { symbol: 28, font: "1.125rem", gap: 1 },
  lg: { symbol: 36, font: "1.5rem", gap: 1.25 },
};

// Symbol proportions of public/brand/symbol.png (333 x 276).
const SYMBOL_RATIO = 333 / 276;

// "Flow" runs blue -> violet-blue -> cyan -> mint, sampled from the reference.
// The light-theme stops are a step deeper so the letters hold against paper.
// The values are the official wordmark colors and live in lib/brand.js.
const FLOW_GRADIENT = WORDMARK.gradient;

export default function TeamFlowBrand({ variant = "full", size = "md", href = "/", collapseOnNarrow = false }) {
  const s = SIZES[size] || SIZES.md;
  const iconOnly = variant === "icon";

  const symbol = (
    <Box
      component="img"
      src="/brand/symbol.png"
      alt=""
      width={Math.round(s.symbol * SYMBOL_RATIO)}
      height={s.symbol}
      draggable={false}
      sx={{ display: "block", height: s.symbol, width: "auto", flexShrink: 0 }}
    />
  );

  const content = (
    <>
      {symbol}
      {!iconOnly && (
        <Box
          component="span"
          aria-hidden
          sx={(theme) => ({
            fontFamily: "'Plus Jakarta Sans', Roboto, Arial, sans-serif",
            fontWeight: 800,
            fontSize: s.font,
            lineHeight: 1,
            letterSpacing: "-0.025em",
            whiteSpace: "nowrap",
            color: "text.primary",
            ...(collapseOnNarrow && { "@media (max-width:399.95px)": { display: "none" } }),
            "& .tf-brand-flow": {
              // Negative tracking shrinks the box below the last glyph;
              // without this the gradient clip shaves the edge off the "w".
              display: "inline-block",
              paddingRight: "0.08em",
              marginRight: "-0.08em",
              color: WORDMARK.fallback[theme.palette.mode === "dark" ? "dark" : "light"], // fallback if clip is unsupported
              backgroundImage: FLOW_GRADIENT[theme.palette.mode === "dark" ? "dark" : "light"],
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            },
          })}
        >
          Team <span className="tf-brand-flow">Flow</span>
        </Box>
      )}
    </>
  );

  const shared = {
    display: "inline-flex",
    alignItems: "center",
    gap: s.gap,
    flexShrink: 0,
    borderRadius: 0.5,
    textDecoration: "none",
    userSelect: "none",
  };

  if (href === null) {
    return (
      <Box role="img" aria-label="Team Flow" sx={shared}>
        {content}
      </Box>
    );
  }

  return (
    <Box component={Link} href={href} aria-label="Team Flow" sx={shared}>
      {content}
    </Box>
  );
}
