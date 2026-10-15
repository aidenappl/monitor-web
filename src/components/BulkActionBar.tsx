"use client";

import { ReactNode } from "react";

/**
 * The floating bar that appears once rows are selected.
 *
 * Fixed to the bottom of the viewport rather than the top of the list, so it
 * stays in reach while the user scrolls to pick more rows. It names the count
 * and the noun ("3 rules selected") — a bar that says only "3 selected" over a
 * page with two lists leaves the user guessing which one it acts on.
 */
export function BulkActionBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number;
  /** Singular noun for the selected rows, e.g. "rule". */
  noun: string;
  onClear: () => void;
  /** The action buttons. */
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <>
    {/* In-flow spacer: the bar is fixed, so without this it sits on top of
        the last rows of the list it acts on. */}
    <div className="h-16" aria-hidden />
    <div
      role="region"
      aria-label={`Bulk actions for ${count} selected ${noun}${count === 1 ? "" : "s"}`}
      className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-2xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 animate-slide-up">
        <span className="px-1 text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
          {count} {noun}
          {count === 1 ? "" : "s"} selected
        </span>
        <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
        {children}
        <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
        <button
          onClick={onClear}
          className="rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          Clear
        </button>
      </div>
    </div>
    </>
  );
}
