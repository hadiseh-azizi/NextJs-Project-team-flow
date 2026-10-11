// Width of a Kanban column's content (sx fragment, spread into a Box).
//
// On phones a column is `flex: 0 0 84%` of the board. Its inner content
// box is sized to that same width with container units (84cqw, the board
// being an inline-size container) rather than a percentage, so the
// content keeps its width while the column animates between expanded and
// collapsed. From `sm` up both are a fixed 288px.
//
// Browsers without container-query units (before Chrome/Edge 105, Safari
// 16, Firefox 110) drop a declaration containing `cqw`, which used to
// leave the content with no width at all. The plain `100%` below is the
// fallback: the content simply fills the 84%-wide column it sits in, which
// is the same size, minus only the no-reflow-during-the-collapse-animation
// nicety. `@supports` is what upgrades it where `cqw` works, so there is
// no JavaScript feature detection and the supported layout is unchanged.
export const columnContentWidthSx = {
  width: { xs: "100%", sm: 288 },
  "@supports (width: 1cqw)": {
    width: { xs: "84cqw", sm: 288 },
  },
};
