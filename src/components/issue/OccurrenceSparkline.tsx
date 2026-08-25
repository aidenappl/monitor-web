"use client";

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

  return (
    <div>
      <div
        className="flex h-16 items-end gap-px"
        role="img"
        aria-label={`${total} occurrences over the last ${days} days`}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.day}
            className="group relative flex-1"
            style={{ minWidth: "2px" }}
          >
            <div
              className={`w-full rounded-sm transition-colors ${
                bucket.count > 0
                  ? "bg-red-400 group-hover:bg-red-500 dark:bg-red-500/70 dark:group-hover:bg-red-400"
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
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-white group-hover:block dark:bg-zinc-100 dark:text-zinc-900">
              {bucket.count.toLocaleString()} on {formatDay(bucket.day)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{formatDay(buckets[0]?.day)}</span>
        <span>
          {total.toLocaleString()} occurrence{total === 1 ? "" : "s"}
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
