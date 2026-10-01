import { Box } from "@mui/material";
import { BRAND, mixHex } from "@/lib/brand";

// A team's name with its first letter set larger. The letter is part of the
// name's own text (one span inside the same run), not a separate badge, so
// the name still copies, wraps, truncates and reads aloud as one word.
//
// `accent` (a team identity color) paints the letter with a short gradient
// from that color toward brand blue; both ends are dark enough on paper to
// clear 3:1 at this size. Without `accent` the letter inherits the text
// color, which is what the project tab uses (its background is already a
// gradient, so the letter stays solid there).
//
// `scale` is the letter's size relative to the rest of the name. Its line
// height is pulled in so a larger letter does not make the first line of a
// wrapped name taller than the others.
export default function TeamName({
  name,
  accent,
  scale = 1.5,
  weight = 700,
  mode = "light",
}) {

  const painted = accent
    ? {
        color: accent,
        backgroundImage: `linear-gradient(135deg, ${accent}, ${mixHex(accent, BRAND[mode === "dark" ? "dark" : "light"].primary, 0.55)})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }
    : {};

  return (
    <>
      <Box
        component="span"
        className="tf-team-initial"
        sx={{
          fontSize: `${scale}em`,
          fontWeight: weight,
          lineHeight: 0.8,
          ...painted,
        }}
      >
        {name}
      </Box>
      
    </>
  );
}
