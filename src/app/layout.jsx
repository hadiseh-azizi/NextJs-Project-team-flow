import AuthProvider from "@/components/AuthProvider";
import ThemeRegistry from "@/components/ThemeRegistry";
import "./globals.css";

export const metadata = {
  title: "TeamFlow — Project & Team Management",
  description: "Kanban boards, multi-project management, and team progress reports",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <ThemeRegistry>
          <AuthProvider>{children}</AuthProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
