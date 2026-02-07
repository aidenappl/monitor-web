"use client";

interface CompareCardProps {
  title: string;
  current: number;
  previous: number;
  changePercent: number;
  loading?: boolean;
  invertColors?: boolean; // For errors, decrease is good
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

export function CompareCard({
  title,
  current,
  previous,
  changePercent,
  loading = false,
  invertColors = false,
}: CompareCardProps) {
  const isIncrease = changePercent > 0;
  const isPositiveChange = invertColors ? !isIncrease : isIncrease;

  const changeColor =
    changePercent === 0
      ? "text-zinc-500 dark:text-zinc-400"
      : isPositiveChange
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  const changeBgColor =
    changePercent === 0
      ? "bg-zinc-100 dark:bg-zinc-800"
      : isPositiveChange
        ? "bg-emerald-100 dark:bg-emerald-900/30"
        : "bg-red-100 dark:bg-red-900/30";

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
      <div className="space-y-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{title}</p>
        {loading ? (
          <div className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
        ) : (
          <div className="flex items-end gap-3">
            <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {formatValue(current)}
            </p>
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${changeBgColor} ${changeColor}`}
            >
              {changePercent !== 0 && (
                <svg
                  className={`w-3 h-3 ${isIncrease ? "" : "rotate-180"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 10l7-7m0 0l7 7m-7-7v18"
                  />
                </svg>
              )}
              {Math.abs(changePercent).toFixed(1)}%
            </div>
          </div>
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Previous: {formatValue(previous)}
        </p>
      </div>
    </div>
  );
}
