import AuthProvider from "@/components/AuthProvider";
import ThemeRegistry from "@/components/ThemeRegistry";
import "./globals.css";

export const metadata = {
  title: "TeamFlow — Project & Team Management",
  description: "Kanban boards, multi-project management, and team progress reports",
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
