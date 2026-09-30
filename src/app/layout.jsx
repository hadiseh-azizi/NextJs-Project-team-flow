import AuthProvider from "@/components/AuthProvider";
import ThemeRegistry from "@/components/ThemeRegistry";
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
  try {
    var storedAppearance = localStorage.getItem("teamflow-appearance-theme");
    document.documentElement.setAttribute("data-appearance-theme", storedAppearance || "default");
  } catch (e) {
    document.documentElement.setAttribute("data-appearance-theme", "default");
  }
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeRegistry>
          <AuthProvider>{children}</AuthProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
