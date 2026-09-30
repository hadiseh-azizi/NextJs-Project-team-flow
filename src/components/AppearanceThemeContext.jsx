"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_APPEARANCE_THEME } from "@/lib/appearanceThemes";

const AppearanceThemeContext = createContext({
  appearanceTheme: DEFAULT_APPEARANCE_THEME,
  setAppearanceTheme: () => {},
});

export function useAppearanceTheme() {
  return useContext(AppearanceThemeContext);
}

export const STORAGE_KEY = "teamflow-appearance-theme";

// Same pattern as ThemeModeContext: the blocking script in layout.jsx sets
// `data-appearance-theme` on <html> before hydration (so the first paint
// already has the right canvas color), and this provider only needs to
// read that attribute back on mount to match it — no flash, no
// server/client mismatch.
function applyHtmlAttr(id) {
  document.documentElement.setAttribute("data-appearance-theme", id);
}

export function AppearanceThemeProvider({ children }) {
  // Starts at the default for the first client render, matching what the
  // server sent, then corrects itself immediately on mount from the
  // attribute the inline script already set on <html> — same two-step
  // hydration-safe approach as ThemeModeProvider's `mode`.
  const [appearanceTheme, setAppearanceThemeState] = useState(DEFAULT_APPEARANCE_THEME);
  // Same transition-class timeout pattern as ThemeModeContext's toggleMode
  // — a plain ref instead of a bare `window` global.
  const transitionTimeout = useRef(null);

  useEffect(() => {
    const initial = document.documentElement.getAttribute("data-appearance-theme");
    if (initial) setAppearanceThemeState(initial);
  }, []);

  useEffect(() => () => window.clearTimeout(transitionTimeout.current), []);

  function setAppearanceTheme(id) {
    // Same page-wide crossfade the dark/light toggle uses in
    // globals.css's `.theme-transitioning` rule — a background switch
    // recolors just as many surfaces (canvas, cards, borders) as a
    // light/dark switch does, so it gets the same smoothing rather than
    // an instant recolor.
    document.documentElement.classList.add("theme-transitioning");
    window.clearTimeout(transitionTimeout.current);
    transitionTimeout.current = window.setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 500);

    setAppearanceThemeState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private browsing / storage disabled — the choice still applies
      // for this session, it just won't persist past a refresh.
    }
    applyHtmlAttr(id);
  }

  const value = useMemo(() => ({ appearanceTheme, setAppearanceTheme }), [appearanceTheme]);

  return <AppearanceThemeContext.Provider value={value}>{children}</AppearanceThemeContext.Provider>;
}
