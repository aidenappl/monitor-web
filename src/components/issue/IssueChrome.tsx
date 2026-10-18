"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The issue pages' own skeletons, shaped like an issue row and the issue
 * detail layout. The generic loading set (spinners, `RefetchBar`, plain
 * skeletons) lives in `components/ui/spinner.tsx` and `ui/skeleton.tsx`.
 */

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
            <Skeleton
              className="h-3.5"
              // Varying widths so the block reads as content rather than as a
              // striped loading graphic.
              style={{ width: `${[62, 78, 45, 70, 55, 84, 50, 66][i % 8]}%` }}
            />
            <Skeleton
              className="h-2.5 bg-zinc-100 dark:bg-zinc-800/60"
              style={{ width: `${[34, 28, 40, 30, 36, 26, 38, 32][i % 8]}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The issue detail page, before the first answer. ⚠️ SAME GRID AS THE PAGE
 * (`lg:grid-cols-[1fr_300px]`, sidebar first below lg): it used to be one
 * full-width column, and the 300px sidebar arriving shoved the content left.
 */
export function DetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading issue">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2 bg-zinc-100 dark:bg-zinc-800/60" />
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <Skeleton className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
          <Skeleton className="h-32 rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
          <Skeleton className="h-48 rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
        </div>
        <div className="order-first space-y-3 lg:order-none">
          <Skeleton className="h-64 rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
        </div>
      </div>
    </div>
  );
}
