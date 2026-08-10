"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeModeContext = createContext({ mode: "light", toggleMode: () => {} });

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

const STORAGE_KEY = "teamflow-theme-mode";

export function ThemeModeProvider({ children }) {
  // Starts "light" on the server (and on the very first client render, to
  // avoid a hydration mismatch) then corrects itself immediately after
  // mount — either to whatever the person picked before, or to their
  // system preference if they've never toggled it manually.
  const [mode, setMode] = useState("light");
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      setMode(stored);
      setManualOverride(true);
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setMode(media.matches ? "dark" : "light");

    // Keep following the system unless/until the person explicitly toggles.
    const handler = (e) => setMode(e.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const toggleMode = () => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      setManualOverride(true);
      return next;
    });
  };

  const value = useMemo(() => ({ mode, toggleMode, manualOverride }), [mode, manualOverride]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}
