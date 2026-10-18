"use client";

import type { ReactNode } from "react";
import { CardHeader } from "./CardHeader";
import { Skeleton } from "@/components/ui/skeleton";

interface CompareCardProps {
  title: string;
  /** Header slot, right-aligned — the same slot every analytics card has. */
  actions?: ReactNode;
  current: number;
  previous: number;
  changePercent: number;
  loading?: boolean;
  invertColors?: boolean; // For errors, decrease is good
  /**
   * The previous window is known to be (partly) missing — typically because it
   * starts past event retention (`previousPeriodBeyondRetention`). The card then
   * says so instead of showing a change it cannot know.
   */
  previousUnavailable?: boolean;
  /** Why the previous period is unavailable. Shown as the caption. */
  previousUnavailableReason?: string;
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

export function CompareCard({
  title,
  current,
  previous,
  changePercent,
  loading = false,
  invertColors = false,
  previousUnavailable = false,
  previousUnavailableReason,
  actions,
}: CompareCardProps) {
  /**
   * ⚠️ A ZERO PREVIOUS PERIOD IS "NO DATA", NOT "NO CHANGE". monitor-core
   * answers change_percent 0 when the previous count is 0, so a 30d compare —
   * whose previous window is wholly past the 30-day retention — read a grey
   * "0.0%" beside 5.1M events: the most reassuring possible reading of a number
   * that was never measured.
   */
  const noPrevious = previousUnavailable || previous === 0;
  const isIncrease = changePercent > 0;
  const isPositiveChange = invertColors ? !isIncrease : isIncrease;
  const neutral = noPrevious || changePercent === 0;

  // -700 text on -100 fills: -600 measured 3.21:1 in light mode, under the
  // 4.5:1 that 12px text needs.
  const changeColor = neutral
    ? "text-zinc-600 dark:text-zinc-400"
    : isPositiveChange
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-red-700 dark:text-red-400";

  const changeBgColor = neutral
    ? "bg-zinc-100 dark:bg-zinc-800"
    : isPositiveChange
      ? "bg-emerald-100 dark:bg-emerald-900/30"
      : "bg-red-100 dark:bg-red-900/30";

  const accentColor = neutral
    ? "bg-zinc-400"
    : isPositiveChange
      ? "bg-emerald-500"
      : "bg-red-500";

  const caption = noPrevious
    ? previousUnavailableReason ??
      (previousUnavailable
        ? "Previous period is unavailable"
        : "No data for the previous period")
    : `Previous period: ${formatValue(previous)}`;

  const badgeLabel = noPrevious
    ? "Change unknown: no data for the previous period"
    : changePercent === 0
      ? "No change from the previous period"
      : `${isIncrease ? "Up" : "Down"} ${Math.abs(changePercent).toFixed(1)}% from the previous period`;

  return (
    <div className="relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      {!loading && <div className={`absolute top-0 left-0 right-0 h-0.5 ${accentColor}`} />}
      <CardHeader title={title} actions={actions} />
      <div className="p-4">
        <div className="space-y-2">
          {loading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {formatValue(current)}
              </p>
              <div
                className={`inline-flex items-center gap-1 px-2 py-0.5 mb-1 rounded-full text-xs font-medium ${changeBgColor} ${changeColor}`}
                title={badgeLabel}
              >
                <span className="sr-only">{badgeLabel}</span>
                <span aria-hidden="true" className="inline-flex items-center gap-1">
                  {!neutral && (
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
                  {noPrevious ? "—" : `${Math.abs(changePercent).toFixed(1)}%`}
                </span>
              </div>
            </div>
          )}
          {/* The caption line is held while loading too: without it the card
              grew by a line when the numbers landed. */}
          {loading ? (
            <Skeleton className="h-4 w-32 bg-zinc-100 dark:bg-zinc-800/60" />
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{caption}</p>
          )}
        </div>
      </div>
    </div>
  );
}
