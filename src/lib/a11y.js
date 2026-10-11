// Text that screen readers read but nothing shows. Used where a visible label
// ("3") needs a spoken completion ("3 attached files"): hidden text becomes
// part of the accessible name, unlike `aria-label` on a plain <div>/<span>,
// which has no role to name and is ignored by assistive technology.
export const visuallyHiddenSx = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
};
