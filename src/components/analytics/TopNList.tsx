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
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
                <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-400 dark:text-zinc-500">
            No data available
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, index) => (
              <div key={item.key} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span
                    className="text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]"
                    title={item.key}
                  >
                    <span className="text-zinc-400 dark:text-zinc-500 mr-2">
                      {index + 1}.
                    </span>
                    {item.key || "(empty)"}
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100 ml-2">
                    {formatValue(item.value)}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300"
                    style={{ width: `${(item.value / maxValue) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
