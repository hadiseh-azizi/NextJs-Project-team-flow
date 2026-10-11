// Touch target sizing (M17).
//
// On touch screens an interactive control should be at least 44x44 CSS px
// (Apple HIG; WCAG 2.5.5, and well above the WCAG 2.2 AA floor of 24px in
// 2.5.8). Most controls in the board are denser than that on purpose for
// mouse users, so nothing changes for a fine pointer: everything here sits
// inside `@media (pointer: coarse)`.
//
// Two ways to get there, picked per control:
//  - touchHitAreaSx: grow only the clickable area, with an invisible
//    ::after box. Layout does not move at all. Use it where neighbours leave
//    room (a card's complete/delete buttons, a column header's icon buttons).
//  - touchMinSizeSx: grow the control itself. Use it for full-width buttons
//    where the extra height is harmless.

export const TOUCH_TARGET_MIN = 44;

const COARSE = "@media (pointer: coarse)";

// How far to extend each side of a control that is `size` px along one axis.
export function hitAreaExtent(size) {
  return Math.max(0, (TOUCH_TARGET_MIN - size) / 2);
}

// `size` is the control's current width/height in px. `sides` overrides the
// extent per side (px) where a neighbour sits closer than the default allows,
// e.g. two adjacent icon buttons that must not claim the same pixels.
export function touchHitAreaSx(size, sides = {}) {
  const e = hitAreaExtent(size);
  const { top = e, right = e, bottom = e, left = e } = sides;
  return {
    [COARSE]: {
      "&::after": {
        content: '""',
        position: "absolute",
        top: -top,
        right: -right,
        bottom: -bottom,
        left: -left,
      },
    },
  };
}

export const touchMinSizeSx = {
  [COARSE]: { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN },
};

export const touchMinHeightSx = {
  [COARSE]: { minHeight: TOUCH_TARGET_MIN },
};
