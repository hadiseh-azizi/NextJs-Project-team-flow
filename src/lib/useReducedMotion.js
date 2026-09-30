"use client";

import { useEffect, useState } from "react";

// globals.css already forces every CSS transition/animation to ~0 under
// prefers-reduced-motion, which covers all of this app's own motion — but
// recharts drives its own bar/line entrance animation via JavaScript, not
// CSS, so that one spot needs to ask the same media query directly.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const handler = (e) => setReduced(e.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  return reduced;
}
