"use client";

import * as React from "react";
import createCache from "@emotion/cache";
import { useServerInsertedHTML } from "next/navigation";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { buildTheme } from "@/lib/theme";
import { ThemeModeProvider, useThemeMode } from "@/components/ThemeModeContext";

// Standard MUI + Next.js App Router setup (see MUI's Next.js integration
// guide) for correctly server-rendering Emotion's CSS-in-JS output.
function EmotionRegistry({ children }) {
  const [{ cache, flush }] = React.useState(() => {
    const cache = createCache({ key: "mui" });
    cache.compat = true;
    const prevInsert = cache.insert;
    let inserted = [];
    cache.insert = (...args) => {
      const serialized = args[1];
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name);
      }
      return prevInsert(...args);
    };
    const flush = () => {
      const prevInserted = inserted;
      inserted = [];
      return prevInserted;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) {
      styles += cache.inserted[name];
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return <CacheProvider value={cache}>{children}</CacheProvider>;
}

function MuiThemeBridge({ children }) {
  const { mode } = useThemeMode();
  const theme = React.useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export default function ThemeRegistry({ children }) {
  return (
    <EmotionRegistry>
      <ThemeModeProvider>
        <MuiThemeBridge>{children}</MuiThemeBridge>
      </ThemeModeProvider>
    </EmotionRegistry>
  );
}
