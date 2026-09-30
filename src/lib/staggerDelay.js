// Pure helper behind FadeInStagger's entrance animation — kept in its own
// plain-JS file (rather than inline in the .jsx component) specifically so
// it can be unit-tested directly under Node, without needing a JSX
// transform in the test harness. See __manual_test__/29-motion-stagger-delay.test.cjs.
//
// Caps the per-item delay so a long list doesn't take longer to finish
// appearing than a short one (see FadeInStagger.jsx and the "Staggered
// List Animations" requirement it implements).
export const MAX_STAGGER_DELAY_MS = 240;

export function staggerDelay(index, base = 30) {
  return Math.min(Math.max(index, 0) * Math.max(base, 0), MAX_STAGGER_DELAY_MS);
}
