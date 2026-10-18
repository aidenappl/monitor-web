"use client";

import { useState } from "react";
import { OccurrenceDay } from "@/types";

/**
 * Per-day occurrence counts for an issue.
 *
 * The data comes from a rollup with no retention limit, so this still has shape
 * for an issue whose raw events expired weeks ago — which is the whole reason it
 * exists. Sparse days are omitted by the API rather than zero-filled, so the
 * component fills the gaps itself: a bar chart with days silently missing would
 * misrepresent a burst as continuous activity.
 */
export function OccurrenceSparkline({
  history,
  days = 30,
  totalOccurrences,
}: {
  history: OccurrenceDay[];
  days?: number;
  /** Tells "never happened" apart from "no daily breakdown recorded yet". */
  totalOccurrences?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const buckets = fillGaps(history, days);
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  if (total === 0) {
    // An empty chart directly above "Occurrences: 5, last seen 2 days ago" reads
    // as a broken chart. It usually means the rollup simply had not started
    // collecting when those events came in — the counters are recorded on the
    // issue itself, the per-day breakdown is not backfillable, and saying so is
    // better than implying nothing happened.
    // Having counted occurrences but no daily rows is the whole distinction —
    // reading the clock to narrow it further would make render impure for a
    // nuance the sentence does not need.
    const hasCountsWithoutBreakdown = Boolean(
      totalOccurrences && totalOccurrences > 0,
    );

    return (
      <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {hasCountsWithoutBreakdown
          ? "No daily breakdown for this issue yet. Its totals are still exact — per-day history is recorded from the point collection began and cannot be filled in backwards."
          : `No occurrences in the last ${days} days.`}
      </p>
    );
  }

  // One focusable chart; ←/→/Home/End move between days and the focused
  // day's count shows in the same tooltip a pointer gets. Thirty tab stops
  // would bury everything after the chart; zero left keyboard and touch users
  // with only the aggregate.
  const shown = active ?? (focused ? buckets.length - 1 : null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const from = shown ?? buckets.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (e.key === "ArrowRight") next = Math.min(buckets.length - 1, from + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buckets.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <div>
      <div className="flex gap-2">
        {/* The scale: without it a 3-per-day issue and a 17,000-per-day issue
            draw identical bars. */}
        <div className="flex h-16 shrink-0 flex-col justify-between text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400" aria-hidden>
          <span>{max.toLocaleString()}</span>
          <span>0</span>
        </div>
        <div
          className="relative flex h-16 min-w-0 flex-1 items-end gap-px rounded-sm border-t border-dashed border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 dark:border-zinc-800 dark:ring-offset-zinc-950"
          role="img"
          tabIndex={0}
          aria-label={`${total.toLocaleString()} ${total === 1 ? "occurrence" : "occurrences"} in the last ${days} days, peak ${max.toLocaleString()} per day. Use the arrow keys to read each day.`}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActive(null);
          }}
          onMouseLeave={() => setActive(null)}
        >
          {buckets.map((bucket, i) => (
            // h-full + items-end: under the row's items-end this column was only
            // as tall as its content, so the bar's percentage height resolved
            // against nothing and every non-empty day rendered at zero — the chart
            // showed only the 2px empty-day stubs, on every issue.
            <div
              key={bucket.day}
              className="relative flex h-full flex-1 items-end"
              style={{ minWidth: "2px" }}
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <div
                className={`w-full rounded-sm transition-colors ${
                  bucket.count > 0
                    ? shown === i
                      ? "bg-red-500 dark:bg-red-400"
                      : "bg-red-400 dark:bg-red-500/70"
                    : shown === i
                      ? "bg-zinc-400 dark:bg-zinc-500"
                      : "bg-zinc-100 dark:bg-zinc-800"
                }`}
                // A day with any occurrences keeps a visible floor: scaling
                // purely by proportion makes a 1-vs-4000 day invisible, which
                // reads as "nothing happened" rather than "a little happened".
                style={{
                  height:
                    bucket.count > 0
                      ? `${Math.max(8, (bucket.count / max) * 100)}%`
                      : "2px",
                }}
              />
            </div>
          ))}
          {shown !== null && buckets[shown] && (
            <span
              className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
              style={{ left: `${((shown + 0.5) / buckets.length) * 100}%` }}
            >
              {buckets[shown].count.toLocaleString()} on {formatDay(buckets[shown].day)}
            </span>
          )}
        </div>
      </div>
      {/* Announced for screen readers as the active day changes. */}
      <p className="sr-only" aria-live="polite">
        {shown !== null && buckets[shown]
          ? `${buckets[shown].count.toLocaleString()} on ${formatDay(buckets[shown].day)}`
          : ""}
      </p>
      <div className="mt-1.5 flex justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{formatDay(buckets[0]?.day)}</span>
        {/* Says its window: the sidebar's total is all-time, and two
            unqualified numbers side by side read as a data bug. */}
        <span className="text-center">
          {total.toLocaleString()} in the last {days} days
        </span>
        <span>{formatDay(buckets[buckets.length - 1]?.day)}</span>
      </div>
    </div>
  );
}

/**
 * Expands a sparse series into one bucket per day, ending today.
 *
 * Dates are compared as YYYY-MM-DD strings in UTC. Building Date objects per
 * bucket and comparing them would shift buckets across a day boundary for anyone
 * west of UTC, putting an occurrence on the wrong day.
 */
function fillGaps(history: OccurrenceDay[], days: number) {
  const counts = new Map<string, number>();
  for (const entry of history) {
    counts.set(entry.day.slice(0, 10), entry.occurrences);
  }

  const buckets: { day: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - i,
      ),
    );
    const key = d.toISOString().slice(0, 10);
    buckets.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return buckets;
}

function formatDay(day?: string) {
  if (!day) return "";
  const d = new Date(day + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
