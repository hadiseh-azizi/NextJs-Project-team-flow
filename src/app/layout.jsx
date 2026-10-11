import { headers } from "next/headers";
import ThemeRegistry from "@/components/ThemeRegistry";
import { brandCssVariables } from "@/lib/brand";
import "./globals.css";

export const metadata = {
  // `template` gives every child route's plain title ("Sign In") the
  // "Page | Team Flow" format; `default` is the landing page's bare title.
  title: { default: "Team Flow", template: "%s | Team Flow" },
  description: "Kanban boards, multi-project management, and team progress reports",
  // Symbol-only icons; the wordmark never appears at favicon size.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Runs before hydration so the correct theme is on screen from the very
// first paint. It only ever touches `data-theme-mode` on <html> (an
// attribute React itself never renders), so it can't cause a hydration
// mismatch — that's also why the <html> tag below carries
// suppressHydrationWarning, scoped to just this one attribute.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("teamflow-theme-mode");
    var mode = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme-mode", mode);
  } catch (e) {
    document.documentElement.setAttribute("data-theme-mode", "light");
  }
  // The background/accent picker was removed; drop the value it left behind.
  try { localStorage.removeItem("teamflow-appearance-theme"); } catch (e) {}
})();
`;

export default async function RootLayout({ children }) {
  // The per-request CSP nonce set by src/middleware.js (see lib/csp.js).
  // Reading request headers is also what makes every page render per
  // request, which a nonce requires. The browser hides the nonce attribute
  // from the DOM after parsing, so these elements opt out of the hydration
  // attribute comparison.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <style id="brand-tokens" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: brandCssVariables() }} />
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeRegistry nonce={nonce}>
          {children}
        </ThemeRegistry>
      </body>
    </html>
  );
}
