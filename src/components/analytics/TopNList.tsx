"use client";

import { TopNDataPoint } from "@/types";

interface TopNListProps {
  title: string;
  data: TopNDataPoint[];
  loading?: boolean;
  /**
   * The total the rows are a share of (e.g. the Total Events gauge). With it,
   * each row shows its percentage of the TOTAL; without it no percentage is
   * shown at all.
   *
   * ⚠️ The label used to be value ÷ the top row, so the leader always read
   * "100%" — 14.0K of 41.9K events presented as all of them. The BAR is still
   * scaled to the top row (that is what a bar is for); the number is not.
   */
  total?: number;
}

function formatValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return (value ?? 0).toLocaleString();
}

export function TopNList({ title, data, loading = false, total }: TopNListProps) {
  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 1;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
      </div>
      <div className="p-4">
        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
                  <div className="h-4 w-10 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                </div>
                <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-zinc-400 dark:text-zinc-500">
            No data available
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, index) => {
              const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
              const share =
                total && total > 0 ? (item.value / total) * 100 : null;
              return (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span
                      className="text-zinc-700 dark:text-zinc-300 truncate"
                      title={item.key}
                    >
                      <span className="text-zinc-400 dark:text-zinc-500 mr-1.5 tabular-nums">
                        {index + 1}.
                      </span>
                      {item.key || "(empty)"}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {share !== null && (
                        <span
                          className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums"
                          title={`${share.toFixed(1)}% of ${formatValue(total ?? 0)} total`}
                        >
                          {share < 1 && share > 0 ? "<1" : Math.round(share)}%
                          <span className="sr-only"> of total</span>
                        </span>
                      )}
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {formatValue(item.value)}
                      </span>
                    </div>
                  </div>
                  <div
                    className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-500"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
