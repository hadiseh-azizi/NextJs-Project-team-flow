import { redirectIfSignedIn } from "@/lib/redirectIfSignedIn";

export const metadata = { title: "Sign In" };

export default async function Layout({ children }) {
  await redirectIfSignedIn();
  return children;
}
