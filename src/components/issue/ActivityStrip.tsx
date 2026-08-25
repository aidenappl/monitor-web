"use client";

import { OccurrenceDay } from "@/types";

/**
 * The activity strip: one cell per day, newest on the right.
 *
 * This is the difference between an error tracker and a list of counts. "5
 * occurrences" cannot tell you whether those five were this morning or spread
 * across a fortnight, and that is the first question triage asks. A strip shows
 * the shape — a burst, a steady drip, or something that stopped a week ago.
 *
 * Days are right-aligned so that "today" sits at the same x position on every
 * row. Scanning the list vertically then reads as a single picture: a bright
 * right-hand edge means something is happening now, a dark one means the estate
 * is quiet regardless of how large the totals are.
 *
 * Intensity is bucketed, not proportional. Exact ratios are unreadable at four
 * pixels wide, and the useful distinction is order of magnitude — nothing, a
 * little, a lot, a storm.
 */
export function ActivityStrip({
  history,
  days = 14,
  className = "",
}: {
  history?: OccurrenceDay[];
  days?: number;
  className?: string;
}) {
  const buckets = fillDays(history ?? [], days);
  const busiest = Math.max(...buckets.map((b) => b.count), 0);

  if (busiest === 0) {
    // A row of empty cells still holds the column width, so rows with and
    // without history stay aligned down the list.
    return (
      <span className={`flex items-end gap-px ${className}`} aria-hidden>
        {buckets.map((b) => (
          <span
            key={b.day}
            className="h-3 w-[3px] rounded-[1px] bg-white/[0.06]"
          />
        ))}
      </span>
    );
  }

  return (
    <span
      className={`flex items-end gap-px ${className}`}
      role="img"
      aria-label={`Activity over the last ${days} days`}
      title={buckets
        .filter((b) => b.count > 0)
        .map((b) => `${b.day}: ${b.count.toLocaleString()}`)
        .join("\n")}
    >
      {buckets.map((b) => (
        <span
          key={b.day}
          className={`w-[3px] rounded-[1px] ${intensity(b.count, busiest)}`}
          style={{ height: `${heightFor(b.count, busiest)}px` }}
        />
      ))}
    </span>
  );
}

/** Four steps, so a quiet day and a storm are distinguishable at a glance. */
function intensity(count: number, busiest: number) {
  if (count === 0) return "bg-white/[0.06]";
  const share = count / busiest;
  if (share > 0.66) return "bg-rose-400";
  if (share > 0.33) return "bg-rose-400/70";
  return "bg-rose-400/45";
}

/**
 * Height carries a second, coarser reading of the same value, so the strip works
 * for anyone who cannot separate the opacity steps by colour alone.
 */
function heightFor(count: number, busiest: number) {
  if (count === 0) return 3;
  const share = count / busiest;
  if (share > 0.66) return 12;
  if (share > 0.33) return 9;
  return 6;
}

/**
 * Expands a sparse series into one bucket per day, ending today.
 *
 * Dates are keyed as YYYY-MM-DD in UTC. Building Date objects per bucket and
 * comparing them shifts cells across a day boundary for anyone west of UTC,
 * which silently puts an occurrence on the wrong day.
 */
function fillDays(history: OccurrenceDay[], days: number) {
  const counts = new Map<string, number>();
  for (const entry of history) {
    counts.set(entry.day.slice(0, 10), entry.occurrences);
  }

  const out: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return out;
}
