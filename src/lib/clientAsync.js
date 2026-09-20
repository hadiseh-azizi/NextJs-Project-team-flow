"use client";

import { useCallback, useEffect, useRef } from "react";

// Tracks whether the calling component is still mounted. Async handlers
// that call setState after an `await` should check this first — otherwise
// a slow request resolving after the user has navigated away or closed a
// dialog triggers a "state update on an unmounted component" warning (and,
// in edge cases, briefly re-shows a value the unmounted UI shouldn't).
export function useIsMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

// Guards against an older, slower request overwriting state set by a newer
// one. Call `next()` right before starting a request to get back an
// `isCurrent()` check; only the most recently started call's `isCurrent()`
// returns true, so a stale response can check it before applying its
// result. Useful whenever a reload/search can be re-triggered before the
// previous one has resolved (id changes, retries, rapid consecutive edits).
export function useLatestRequest() {
  const ticket = useRef(0);
  return useCallback(() => {
    const id = ++ticket.current;
    return () => id === ticket.current;
  }, []);
}
