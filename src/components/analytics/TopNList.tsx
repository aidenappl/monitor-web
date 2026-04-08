"use client";

import { TopNDataPoint } from "@/types";

interface TopNListProps {
  title: string;
  data: TopNDataPoint[];
  loading?: boolean;
}

function formatValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function TopNList({ title, data, loading = false }: TopNListProps) {
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
              const pct = Math.round((item.value / maxValue) * 100);
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
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {pct}%
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {formatValue(item.value)}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
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
