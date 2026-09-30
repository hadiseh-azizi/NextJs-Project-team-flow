"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Box, Container, Typography, LinearProgress, Alert, Button, Skeleton, Chip } from "@mui/material";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import TeamFlowBrand from "@/components/TeamFlowBrand";
import SharedBoardView from "@/components/SharedBoardView";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { cacheBoardSnapshot, readCachedBoard, clearCachedBoard } from "@/lib/sharedBoardCache";

const NOT_CACHED_MESSAGE = "This board hasn't been cached yet. Connect to the internet once to load the board.";

export default function SharedBoardPage() {
  const { token } = useParams();
  const [board, setBoard] = useState(null);
  useDocumentTitle(board?.projectName, "Shared Board");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  // Read inside load() instead of the `board` state directly, so the
  // online/offline event listeners (registered once, see below) always
  // see the latest value rather than whatever `board` happened to be the
  // render they were attached in.
  const boardRef = useRef(null);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  async function load() {
    try {
      const res = await fetch(`/api/shared/board/${token}`, { cache: "no-store" });
      if (!res.ok) {
        let message = "This board isn't available.";
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // Non-JSON error body — fall back to the generic message above.
        }
        setOffline(false);
        if (res.status === 404 || res.status === 403) {
          // An authoritative "no" from the server — an invalid, disabled,
          // or revoked link — so any previously cached copy for this
          // token is retired too, rather than letting a later offline
          // visit keep showing a board that's no longer meant to be
          // shared.
          clearCachedBoard(token);
          setBoard(null);
          setLoadError(message);
        } else if (!boardRef.current) {
          // A transient server-side problem (rate limited, momentarily
          // unavailable) with nothing already on screen to fall back to.
          setLoadError(message);
        }
        // Otherwise: a transient error, but we already have a board on
        // screen from an earlier successful load — leave it as-is rather
        // than replacing a working view with an error banner.
        return;
      }

      const data = await res.json();
      setBoard(data);
      setOffline(false);
      setCachedAt(null);
      setLoadError("");
      cacheBoardSnapshot(token, data);
    } catch {
      // fetch() itself threw — no network, not a server response of any
      // kind. This, and only this, is when a cached copy is appropriate.
      const cached = await readCachedBoard(token);
      if (cached) {
        setBoard(cached.data);
        setCachedAt(cached.cachedAt);
        setOffline(true);
        setLoadError("");
      } else if (!boardRef.current) {
        setOffline(true);
        setLoadError(NOT_CACHED_MESSAGE);
      } else {
        setOffline(true);
      }
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Registered once per page visit — only for this route, never from the
  // root layout — so the rest of the app never even knows a service
  // worker exists. See public/sw.js for what it actually caches.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A blocked/unsupported registration just means no offline app
        // shell — the board-data caching above still works independently.
      });
    }
  }, []);

  // Reconnecting re-checks the server for a newer version (requirement:
  // refresh cached data when appropriate, never overwrite the server from
  // this read-only client — which is trivially true here, since this page
  // never sends anything but GET requests). Going offline flips the
  // indicator immediately rather than waiting for the next failed fetch.
  useEffect(() => {
    function handleOnline() {
      load();
    }
    function handleOffline() {
      setOffline(true);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1.5 }}>
        <Container maxWidth="lg" sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <TeamFlowBrand href="/" />
          <Chip
            size="small"
            variant="outlined"
            icon={<VisibilityOutlinedIcon sx={{ fontSize: 15 }} />}
            label={offline ? "Read Only • Offline" : "Read Only"}
            color={offline ? "warning" : "default"}
            sx={{ fontWeight: 500 }}
          />
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ pt: { xs: 3, md: 4 }, pb: { xs: 6, md: 8 } }}>
        {initialLoading ? (
          <Box aria-busy="true" aria-label="Loading shared board">
            <Skeleton variant="text" width="40%" height={44} />
            <Skeleton variant="text" width="60%" height={22} sx={{ mb: 3 }} />
            <Box sx={{ display: "flex", gap: 2, overflow: "hidden" }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="rounded" height={220} sx={{ flex: "0 0 288px", borderRadius: 2 }} />
              ))}
            </Box>
          </Box>
        ) : loadError && !board ? (
          <Alert
            severity={offline ? "warning" : "error"}
            icon={offline ? <WifiOffIcon /> : undefined}
            action={
              <Button color="inherit" size="small" onClick={load}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : board ? (
          <>
            <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
              {board.projectName}
            </Typography>
            {board.projectDescription && (
              <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 620, overflowWrap: "anywhere" }}>
                {board.projectDescription}
              </Typography>
            )}

            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3, rowGap: 1, mt: 2, mb: 3 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <LinearProgress
                  variant="determinate"
                  value={board.progress.pct}
                  color={board.progress.pct === 100 ? "success" : "primary"}
                  aria-label="Project progress"
                  sx={{ width: 140 }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {board.progress.done} of {board.progress.total} tasks done
                </Typography>
              </Box>
              {offline && cachedAt && (
                <Typography variant="caption" color="text.secondary">
                  Showing a cached copy from {new Date(cachedAt).toLocaleString()}
                </Typography>
              )}
            </Box>

            {loadError && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {loadError}
              </Alert>
            )}

            <SharedBoardView columns={board.columns} tasks={board.tasks} />
          </>
        ) : null}
      </Container>
    </Box>
  );
}
