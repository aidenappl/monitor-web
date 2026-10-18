"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function getSnapshot(): boolean {
  return document.visibilityState !== "hidden";
}

// The server has no tab to hide. Rendering as visible keeps the first client
// pass identical to the server's; the store corrects itself after hydration.
function getServerSnapshot(): boolean {
  return true;
}

/**
 * Whether this tab is currently visible, re-rendering when that changes.
 *
 * ⚠️ EVERY BACKGROUND POLL IN THIS APP IS GATED ON IT. A tab left open on a
 * dashboard overnight used to ask its zone for /health every ten seconds, and
 * AutoRefresh kept re-running every panel's ClickHouse query, for a screen
 * nobody was looking at. A hidden tab's poll buys nothing: the answer is stale
 * again long before anyone reads it, and becoming visible is the moment to
 * fetch fresh.
 *
 * Key the interval effect on this value, so hiding the tab tears the timer
 * down and showing it restarts it (with an immediate fetch). Never read
 * `document.hidden` during render instead: it is not reactive, and it differs
 * between the server and client passes (§5 "Hydration").
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
