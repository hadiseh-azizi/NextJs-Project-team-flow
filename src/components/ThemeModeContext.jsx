"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const ThemeModeContext = createContext({ mode: "light", toggleMode: () => {} });

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export const STORAGE_KEY = "teamflow-theme-mode";

// Keeps the <html data-theme-mode> attribute (set synchronously by the
// blocking script in layout.jsx, before hydration, to avoid a flash of the
// wrong theme) in sync whenever mode changes afterwards.
function applyHtmlAttr(mode) {
  document.documentElement.setAttribute("data-theme-mode", mode);
}

export function ThemeModeProvider({ children }) {
  // Starts "light" for the very first client render so it matches what the
  // server sent (avoiding a hydration mismatch on any mode-dependent text
  // or attributes React itself owns) then corrects itself immediately on
  // mount from the attribute the inline script already set on <html> —
  // either the person's saved preference or their system preference. The
  // inline script runs before paint, so the *visible* colors never flash;
  // this state only needs to catch up for React-rendered content.
  const [mode, setMode] = useState("light");
  const [manualOverride, setManualOverride] = useState(false);
  // A plain module/component-scoped ref instead of a bare `window` global
  // for the transition-class timeout — avoids leaking a property onto
  // `window` that another script could collide with or read.
  const transitionTimeout = useRef(null);

  useEffect(() => {
    const initial = document.documentElement.getAttribute("data-theme-mode");
    if (initial === "light" || initial === "dark") {
      setMode(initial);
      setManualOverride(localStorage.getItem(STORAGE_KEY) != null);
    }

    // Keep following the system unless/until the person explicitly toggles.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => {
      if (localStorage.getItem(STORAGE_KEY) != null) return; // manual choice wins
      const next = e.matches ? "dark" : "light";
      setMode(next);
      applyHtmlAttr(next);
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  useEffect(() => () => window.clearTimeout(transitionTimeout.current), []);

  const toggleMode = () => {
    // Briefly flags <html> so the CSS in globals.css can transition colors
    // smoothly across the whole page during the switch, then removes the
    // flag so it doesn't slow down normal hover/interaction transitions.
    document.documentElement.classList.add("theme-transitioning");
    window.clearTimeout(transitionTimeout.current);
    transitionTimeout.current = window.setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 500);

    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyHtmlAttr(next);
      setManualOverride(true);
      return next;
    });
  };

  const value = useMemo(() => ({ mode, toggleMode, manualOverride }), [mode, manualOverride]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}
