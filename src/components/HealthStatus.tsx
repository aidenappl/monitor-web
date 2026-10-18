"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HealthResponse } from "@/types";
import { getHealth } from "@/services/api";
import { zoneFromPathname } from "@/tools/routing.tools";
import { reportError } from "@/services/monitor.service";
import { usePageVisible } from "@/hooks/usePageVisible";

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

  const visible = usePageVisible();

  // Reset on every zone change. The previous zone's answer is not a stale
  // reading of this one, it is a reading of something else entirely, and
  // leaving it on screen is the whole bug in miniature. Done while rendering
  // (not in an effect), so not even one frame shows it. Keyed on the zone
  // ONLY, apart from the poll on purpose: a refocus is the same zone, so it
  // refreshes the reading in place rather than blanking it to "Connecting…".
  const [shownZone, setShownZone] = useState(zone);
  if (zone !== shownZone) {
    setShownZone(zone);
    setHealth(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    // ⚠️ BACKS OFF WHILE DOWN, AND STOPS IN A HIDDEN TAB (GLOBAL-CHROME-13).
    // A flat 10s interval kept hitting a dead zone's 502 forever, from every
    // open tab, including ones nobody was looking at. A healthy zone is still
    // polled every 10s; a failing one at 30s, then 60s. Hidden, this effect
    // tears its timer down; visible again, it fetches at once and restarts
    // (usePageVisible).
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Consecutive failures, for the backoff. Reset by any success.
    let failures = 0;

    const fetchHealth = async () => {
      timer = null;
      try {
        const res = await getHealth();
        if (cancelled) return;
        if (!res.success) {
          // Explicit: the client no longer throws on a non-2xx, so without this
          // an unhealthy API would render as "no data" rather than an error.
          // This is also where an unroutable zone surfaces — `resolveUpstream`
          // refuses it with a 502 rather than answering from another zone.
          failures++;
          setError(res.error_message || "Failed to fetch health");
          setHealth(null);
          return;
        }
        failures = 0;
        setHealth(res.data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        failures++;
        // Only a throw in this block lands here (fetchApi returns failures as
        // values). The reporter coalesces repeats.
        reportError("health.poll.failed", err, {
          outcome: "navbar pill shows offline",
        });
        setError(err instanceof Error ? err.message : "Failed to fetch health");
        setHealth(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(fetchHealth, delayFor(failures));
        }
      }
    };

    void fetchHealth();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // The zone is the dependency: the request is routed by it, so the answer is
    // about it. `pathname` changes far more often and would restart the poll on
    // every navigation for no new information.
  }, [zone, visible]);

  return (
    <HealthPill subject={subject} loading={loading} error={error} health={health} />
  );
}

/** 10s while answering; 30s after the first failure; 60s from the third on. */
function delayFor(failures: number): number {
  if (failures === 0) return 10_000;
  if (failures < 3) return 30_000;
  return 60_000;
}

/**
 * The pill is a button: the numbers behind it (accepted, pending, dropped, which
 * stores answer) are diagnostics, not something to read in the navbar at every
 * width. They used to sit inline as bare "Q" and "P" — unlabelled, and "Q" was
 * the LIFETIME accepted count, which reads as a queue depth climbing forever.
 * They are in a labelled popover now, one click away.
 */
function HealthPill({
  subject,
  loading,
  error,
  health,
}: {
  subject: string;
  loading: boolean;
  error: string | null;
  health: HealthResponse | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const state: "checking" | "down" | "degraded" | "up" = loading
    ? "checking"
    : error
      ? "down"
      : health && health.dropped > 0
        ? "degraded"
        : "up";

  const tone = {
    checking: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-transparent",
    down: "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400",
    degraded: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400",
    up: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400",
  }[state];
  const dot = {
    checking: "bg-zinc-400 animate-pulse",
    down: "bg-red-500",
    degraded: "bg-amber-500",
    up: "bg-emerald-500",
  }[state];
  const label = {
    checking: "checking…",
    down: "offline",
    degraded: "dropping events",
    up: "online",
  }[state];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        // The subject is in the accessible name AND the visible label: a bare
        // "Offline" in a multi-zone install does not say offline what.
        aria-label={`${subject} ${label}${error ? `: ${error}` : ""}. Show health details`}
        title={error ?? undefined}
        // min-h/min-w-9 below xl, where the label is hidden and the pill is
        // only a dot: it was a 28×16 tap target on phones (GLOBAL-CHROME-09).
        className={`flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium xl:min-h-0 xl:min-w-0 transition-colors hover:brightness-95 dark:hover:brightness-125 ${tone}`}
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {state === "up" && (
            <span className="absolute inset-0 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
          )}
        </span>
        <span className="hidden max-w-[9rem] truncate xl:inline">
          {subject} {label}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Health of ${subject}`}
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-lg animate-slide-up dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            {subject} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {label}</span>
          </p>
          {error ? (
            <p className="mt-2 break-words text-red-600 dark:text-red-400">{error}</p>
          ) : health ? (
            <dl className="mt-2 space-y-1.5">
              <HealthRow label="Accepted since start" value={health.enqueued.toLocaleString()} />
              <HealthRow label="Waiting to flush" value={health.pending.toLocaleString()} />
              <HealthRow
                label="Dropped"
                value={health.dropped.toLocaleString()}
                warn={health.dropped > 0}
              />
              {health.last_flush_at !== undefined && (
                <HealthRow
                  label="Last flush"
                  value={health.last_flush_at ? new Date(health.last_flush_at).toLocaleTimeString() : "never"}
                />
              )}
              {health.clickhouse_ok !== undefined && (
                <HealthRow label="ClickHouse" value={health.clickhouse_ok ? "ok" : "down"} warn={!health.clickhouse_ok} />
              )}
              {health.mariadb_ok !== undefined && (
                <HealthRow label="MariaDB" value={health.mariadb_ok ? "ok" : "down"} warn={!health.mariadb_ok} />
              )}
              {health.alerting_ok !== undefined && (
                <HealthRow label="Alerting" value={health.alerting_ok ? "ok" : "down"} warn={!health.alerting_ok} />
              )}
            </dl>
          ) : (
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">Waiting for the first answer…</p>
          )}
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">
            {error
              ? "Re-checked every 30–60 seconds while it is down."
              : "Polled every 10 seconds."}
          </p>
        </div>
      )}
    </div>
  );
}

function HealthRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={`tabular-nums font-medium ${
          warn ? "text-amber-600 dark:text-amber-400" : "text-zinc-800 dark:text-zinc-200"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
