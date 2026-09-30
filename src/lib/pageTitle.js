// Browser-tab title convention: "Page Name | Team Flow", or just "Team Flow"
// for the landing page. Static routes get their title from Next.js metadata
// (the root layout's `title.template` applies this same format); this helper
// is only used by pages whose title depends on client-loaded data (project
// and team detail pages, the shared board), via lib/useDocumentTitle.js.
//
// Plain JS on purpose so it can be unit-tested under Node without a JSX
// transform. See __manual_test__/32-page-titles.test.cjs.
export const APP_NAME = "Team Flow";
export const MAX_TITLE_NAME_LENGTH = 60;

const SUFFIX_RE = /(?:\s*\|\s*Team\s*Flow)+\s*$/i;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

// Returns a browser-title-safe version of `name`, or "" if it can't be used
// (not a string, empty, looks like a raw ObjectId, or the literal strings
// "undefined"/"null"). Only affects the tab title — never the stored/shown name.
export function cleanTitleName(name) {
  if (typeof name !== "string") return "";
  let text = name.replace(CONTROL_CHARS_RE, " ").replace(/\s+/g, " ").trim();
  text = text.replace(SUFFIX_RE, "").trim(); // never "X | Team Flow | Team Flow"
  if (!text || OBJECT_ID_RE.test(text)) return "";
  if (text.toLowerCase() === APP_NAME.toLowerCase()) return ""; // would render "Team Flow | Team Flow"
  if (text === "undefined" || text === "null" || text === "[object Object]") return "";

  // Truncate by code point so Persian/emoji/surrogate pairs aren't split.
  const chars = Array.from(text);
  if (chars.length > MAX_TITLE_NAME_LENGTH) {
    text = chars.slice(0, MAX_TITLE_NAME_LENGTH - 1).join("").trimEnd() + "…";
  }
  return text;
}

// createPageTitle("Dashboard") -> "Dashboard | Team Flow"
// createPageTitle(undefined, "Project") -> "Project | Team Flow"
// createPageTitle() -> "Team Flow"
export function createPageTitle(name, fallback) {
  const clean = cleanTitleName(name) || cleanTitleName(fallback);
  return clean ? `${clean} | ${APP_NAME}` : APP_NAME;
}
