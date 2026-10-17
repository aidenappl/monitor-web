"use client";

import type { ReactNode } from "react";

/**
 * The one header every analytics card uses — GaugeCard, CompareCard, TopNList,
 * TimeSeriesChart and TimeSeriesTable — so a dashboard of mixed widgets reads
 * as one grid rather than five styles.
 *
 * The title truncates to one line with the full text in `title`. The ROW wraps:
 * the title keeps at least 10rem, so when the actions don't fit beside it they
 * drop to a second line instead of squeezing the title to nothing (which is
 * what a 375px phone did to "Events over time" next to Log/CSV/JSON).
 */
export function CardHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-h-[45px]">
      <h3
        className="grow basis-40 min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
        title={title}
      >
        {title}
      </h3>
      {actions && (
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">{actions}</div>
      )}
    </div>
  );
}
