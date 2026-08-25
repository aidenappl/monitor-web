"use client";

/**
 * Shared interaction primitives for the issues surface.
 *
 * These exist to make the page feel responsive rather than merely be fast: a
 * skeleton that matches the shape of what is coming, a refetch indicator that
 * does not blank the content you were reading, and buttons that show they heard
 * you. Perceived latency is mostly about whether the interface acknowledges the
 * action, not about milliseconds.
 */

/** Pluralises a count without the "1 occurrences" tell. */
export function plural(count: number, singular: string, pluralForm?: string) {
  return `${count.toLocaleString()} ${count === 1 ? singular : (pluralForm ?? singular + "s")}`;
}

/**
 * A thin indeterminate bar pinned under the header during a refetch.
 *
 * Used INSTEAD of swapping the list for a spinner. Replacing content you are
 * already reading with a spinner loses your place and reads as slower than it
 * is, even when the request is quick.
 */
export function RefetchBar({ active }: { active: boolean }) {
  return (
    <div
      className="relative h-0.5 overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={active ? "Loading" : ""}
    >
      {active && (
        <div className="animate-issue-progress absolute inset-y-0 w-1/3 rounded-full bg-blue-500/80" />
      )}
    </div>
  );
}

/** An inline spinner sized to sit inside a button without shifting its text. */
export function ButtonSpinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

/**
 * Placeholder rows shown on FIRST load only.
 *
 * Matched to the real row's height and column rhythm, so the list does not jump
 * when data arrives — a skeleton that settles into a different shape is worse
 * than no skeleton.
 */
export function IssueListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul
      className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
      aria-hidden
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 bg-white px-3 py-2.5 dark:bg-zinc-900"
        >
          <div className="h-3.5 w-3.5 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className="h-3.5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
              // Varying widths so the block reads as content rather than as a
              // striped loading graphic.
              style={{ width: `${[62, 78, 45, 70, 55, 84, 50, 66][i % 8]}%` }}
            />
            <div
              className="h-2.5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60"
              style={{ width: `${[34, 28, 40, 30, 36, 26, 38, 32][i % 8]}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      <div className="space-y-2">
        <div className="h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-6 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800/60" />
      </div>
      <div className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
      <div className="h-32 rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
    </div>
  );
}

/**
 * A relative-volume bar, scaled against the largest count on the page.
 *
 * The list previously reduced an issue's whole shape to the string "5
 * occurrences", which makes a one-off and a four-thousand-times-an-hour storm
 * look identical while scanning. Scaling is logarithmic because raw proportion
 * makes everything except the single loudest issue vanish — the useful question
 * is order of magnitude, not exact ratio.
 */
export function VolumeBar({ count, max }: { count: number; max: number }) {
  const ratio =
    max > 1
      ? Math.log10(Math.max(count, 1)) / Math.log10(max)
      : count > 0
        ? 1
        : 0;
  const pct = Math.max(6, Math.round(ratio * 100));

  return (
    <span
      className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-200 sm:block dark:bg-zinc-800"
      title={plural(count, "occurrence")}
      aria-hidden
    >
      <span
        className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
