"use client";

import { TimeSeriesSeries } from "@/types";

interface TimeSeriesTableProps {
  title: string;
  series: TimeSeriesSeries[];
  loading?: boolean;
}

function formatValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toLocaleString();
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TimeSeriesTable({
  title,
  series,
  loading = false,
}: TimeSeriesTableProps) {
  const hasData = series.length > 0 && series[0]?.data_points?.length > 0;
  const hasMultipleSeries = series.length > 1;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-zinc-200 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="flex items-center justify-center h-48 text-zinc-400 dark:text-zinc-500">
            No data available
          </div>
        ) : hasMultipleSeries ? (
          // Multiple series: show series name with aggregated data
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                  Series
                </th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Data Points
                </th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Total
                </th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Avg
                </th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Min
                </th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Max
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((s, index) => {
                const values = s.data_points.map((p) => p.value);
                const total = values.reduce((a, b) => a + b, 0);
                const avg = values.length > 0 ? total / values.length : 0;
                const min = values.length > 0 ? Math.min(...values) : 0;
                const max = values.length > 0 ? Math.max(...values) : 0;

                return (
                  <tr
                    key={index}
                    className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  >
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      {s.name || "(default)"}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {s.data_points.length}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {formatValue(total)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {formatValue(avg)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {formatValue(min)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {formatValue(max)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          // Single series: show time-based data
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                  Timestamp
                </th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {series[0].data_points.map((point, index) => (
                <tr
                  key={index}
                  className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {formatTimestamp(point.timestamp)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-zinc-900 dark:text-zinc-100">
                    {formatValue(point.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hasData && (
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 text-xs text-zinc-500 dark:text-zinc-400">
          {hasMultipleSeries
            ? `${series.length} series`
            : `${series[0].data_points.length} data points`}
        </div>
      )}
    </div>
  );
}
