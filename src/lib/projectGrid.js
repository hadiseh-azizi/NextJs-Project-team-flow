// Layout numbers shared by ProjectCard and ProjectCardSkeleton, and the
// grid both are placed in. They live in one file so the placeholder and the
// real card cannot drift apart: if the card gets 2px taller, so does the
// skeleton, and the page does not jump when the data arrives.

// The team tab sits above the card's own edge. It is drawn 1px taller than
// the space reserved for it, so its bottom row lands on the card's top
// border and the tab reads as attached to the card.
export const PROJECT_TAB_HEIGHT = 30;

// Soft enough for a card this size; 30px on a ~270px card read as a pill.
export const PROJECT_CARD_RADIUS = 22;

export const PROJECT_BODY_PADDING = "14px 16px";

// Shortest a card body gets (a one-line name and no description). A name
// and description at their clamps come out at about this height anyway, so
// most cards are the same height and the grid reads as even rows. The
// skeleton uses the same floor.
export const PROJECT_BODY_MIN_HEIGHT = 164;

// Column count steps up with the viewport; the columns themselves are equal
// fractions of the page container, which stops at 1200px, so a card is never
// wider than about 330px however big the screen is (and it is never narrower
// than about 220px). A grid with fewer cards than columns just leaves the
// rest empty rather than stretching the cards to fill it.
//   <520px: 1 column (full width, and short)   520-699: 2
//   700-1023: 3                                1024 and up: 4
export const PROJECT_GRID_SX = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  columnGap: { xs: 1.5, sm: 2, md: 2.5 },
  rowGap: { xs: 1.5, sm: 2, md: 2.5 },
  "@media (min-width:520px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  "@media (min-width:700px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
  "@media (min-width:1024px)": { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
};
