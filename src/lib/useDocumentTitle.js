"use client";

import { useEffect } from "react";
import { createPageTitle } from "./pageTitle";

// Sets the tab title for pages whose name is only known after a client-side
// fetch. Each such route also has a server layout exporting the same
// `fallback` as metadata, so the tab is correct before/without JS; this hook
// then swaps in the real name once it's available. It runs on mount with
// the fallback too, so a stale name from a previously viewed project/team
// can never linger while the next one loads (or if it fails to load).
export function useDocumentTitle(name, fallback) {
  const title = createPageTitle(name, fallback);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
