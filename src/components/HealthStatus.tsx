"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HealthResponse } from "@/types";
import { getHealth } from "@/services/api";
import { zoneFromPathname } from "@/tools/routing.tools";
import { reportError } from "@/services/monitor.service";

/**
 * The navbar health pill.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ IT USED TO REPORT THE WRONG BOX, IN THE MOST CONFIDENT POSSIBLE WAY.
 *
 * `getHealth()` calls `/health`, and `isZoneScopedPath` returned false for
 * anything outside /v1/ — so `resolveUpstream` sent it to the CONTROL PLANE.
 * This component then polled that every ten seconds and rendered a green
 * "Online", complete with the control plane's queue depth, in the navbar of
 * every zone's pages. Including a zone that was completely down.
 *
 * That is worse than having no health indicator: an operator on
 * /appleby/errors, looking at an empty issue list, had a green light in the
 * corner telling them the backend was fine. The routing fix
 * (`routesToZone` in tools/routing.tools.ts) makes the request go to the right
 * place; this file's job is to make the ANSWER say whose it is.
 *
 * ⚠️ IT LIVES IN THE NAVBAR, IN THE ROOT LAYOUT — OUTSIDE `ScopeBoundary`. So it
 * cannot use `useScope()`, and it gets its own zone dependency read straight
 * from the path. That also means nothing remounts it on a zone change, which is
 * why the state reset below is explicit: without it, the pill would go on
 * showing the previous zone's numbers under the new zone's name for up to ten
 * seconds — the same lie, just briefer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function HealthStatus() {
  const pathname = usePathname();
  // ⚠️ NO `rememberedZone` / FALLBACK_ZONE FALLBACK, unlike the navbar's links.
  // Those fall back so they always point somewhere; this must not, because a
  // fallback here would attribute the control plane's health to a zone the user
  // is not looking at. Null means "no zone in this path" (/settings, /admin/*),
  // and the honest label for that is the control plane — which is exactly what
  // the request resolves to when no `?zone` is sent.
  const zone = zoneFromPathname(pathname);
  const subject = zone ?? "control plane";

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Reset on every zone change. The previous zone's answer is not a stale
    // reading of this one, it is a reading of something else entirely, and
    // leaving it on screen is the whole bug in miniature.
    setHealth(null);
    setError(null);
    setLoading(true);

    const fetchHealth = async () => {
      try {
        const res = await getHealth();
        if (cancelled) return;
        if (!res.success) {
          // Explicit: the client no longer throws on a non-2xx, so without this
          // an unhealthy API would render as "no data" rather than an error.
          // This is also where an unroutable zone surfaces — `resolveUpstream`
          // refuses it with a 502 rather than answering from another zone.
          setError(res.error_message || "Failed to fetch health");
          setHealth(null);
          return;
        }
        setHealth(res.data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Only a throw in this block lands here (fetchApi returns failures as
        // values). This polls every 10s; the reporter coalesces repeats.
        reportError("health.poll.failed", err, {
          outcome: "navbar pill shows offline",
        });
        setError(err instanceof Error ? err.message : "Failed to fetch health");
        setHealth(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // The zone is the dependency: the request is routed by it, so the answer is
    // about it. `pathname` changes far more often and would restart the poll on
    // every navigation for no new information.
  }, [zone]);

  if (loading) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full"
        aria-label={`Checking health of ${subject}`}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Connecting...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded-full"
        // The message is the only fact about WHY, and it is the one place an
        // unroutable zone's refusal is readable without opening devtools.
        title={error}
        aria-label={`${subject} is not answering: ${error}`}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          {/* The subject is in the VISIBLE label, not only the tooltip. A bare
              "Offline" in a multi-zone install does not say offline what. */}
          {subject} offline
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-full"
      aria-label={`${subject} is online`}
    >
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
        </div>
        <span className="max-w-[9rem] truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {subject} online
        </span>
      </div>
      {health && (
        <div className="hidden lg:flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 border-l border-emerald-200 dark:border-emerald-800/50 pl-2">
          <span className="tabular-nums">
            <span className="text-zinc-400 dark:text-zinc-500">Q</span>{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">{health.enqueued}</span>
          </span>
          <span className="tabular-nums">
            <span className="text-zinc-400 dark:text-zinc-500">P</span>{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">{health.pending}</span>
          </span>
          {health.dropped > 0 && (
            <span className="tabular-nums text-amber-600 dark:text-amber-400">
              <span>D</span> <span className="font-medium">{health.dropped}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
