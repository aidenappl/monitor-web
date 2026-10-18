"use client";

import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faXmark } from "@fortawesome/free-solid-svg-icons";
import { TopNDataPoint } from "@/types";
import { CardHeader } from "./CardHeader";
import { Skeleton } from "@/components/ui/skeleton";

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
  /** Formats a row's value. Defaults to a compact count ("1.5K"). */
  formatValue?: (value: number) => string;
  /**
   * Makes every row a toggle button (`aria-pressed`) — the drill-through.
   * Called with the row's key; the caller decides what selecting means
   * (typically adding or removing `group = key` as a filter).
   */
  onSelect?: (key: string) => void;
  /** Whether a row is currently selected. Only consulted with `onSelect`. */
  isActive?: (key: string) => boolean;
  /**
   * What a row's key is a value OF, lower-case ("service"), for the rows'
   * accessible names: "Filter by service: api". Defaults to "value".
   */
  selectLabel?: string;
  /** Header slot, right-aligned — export buttons and the like. */
  actions?: ReactNode;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return (value ?? 0).toLocaleString();
}

export function TopNList({
  title,
  data,
  loading = false,
  total,
  formatValue = formatCount,
  onSelect,
  isActive,
  selectLabel = "value",
  actions,
}: TopNListProps) {
  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 1;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <CardHeader title={title} actions={actions} />
      <div className={onSelect ? "p-2" : "p-4"}>
        {loading ? (
          // Same list, row wrappers and line heights as the loaded rows below
          // (a 20px text line, 6px gap, the 8px bar), so nothing moves when
          // the answer lands.
          <ul
            className={onSelect ? "space-y-0.5" : "space-y-3"}
            role="status"
            aria-label={`Loading ${title}`}
          >
            {[...Array(5)].map((_, i) => (
              <li key={i} className={onSelect ? "space-y-1.5 px-2 py-1.5" : "space-y-1.5"}>
                <span className="flex h-5 items-center justify-between">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-10 bg-zinc-100 dark:bg-zinc-800/60" />
                </span>
                <Skeleton className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800/60" />
              </li>
            ))}
          </ul>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-zinc-500 dark:text-zinc-400">
            No data in this range
          </div>
        ) : (
          <ul className={onSelect ? "space-y-0.5" : "space-y-3"}>
            {data.map((item, index) => {
              const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
              const share =
                total && total > 0 ? (item.value / total) * 100 : null;
              const active = !!onSelect && !!isActive?.(item.key);
              const label = item.key || "(empty)";

              const body = (
                <>
                  <span className="flex items-center justify-between text-sm gap-2">
                    <span
                      className="text-zinc-700 dark:text-zinc-300 truncate"
                      title={onSelect ? undefined : label}
                    >
                      {onSelect && (
                        <span className="sr-only">
                          {active ? "Remove filter " : "Filter by "}
                          {selectLabel}:{" "}
                        </span>
                      )}
                      <span
                        className="text-zinc-500 dark:text-zinc-400 mr-1.5 tabular-nums"
                        aria-hidden="true"
                      >
                        {index + 1}.
                      </span>
                      {label}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {onSelect && (
                        <FontAwesomeIcon
                          icon={active ? faXmark : faFilter}
                          className={`text-[10px] ${
                            active
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-zinc-400 opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
                          }`}
                          aria-hidden="true"
                        />
                      )}
                      {share !== null && (
                        <span
                          className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums"
                          title={`${share.toFixed(1)}% of ${formatCount(total ?? 0)} total`}
                        >
                          {share < 1 && share > 0 ? "<1" : Math.round(share)}%
                          <span className="sr-only"> of total</span>
                        </span>
                      )}
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {formatValue(item.value)}
                      </span>
                    </span>
                  </span>
                  <span
                    className="block h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-500"
                      style={{ width: `${barPct}%` }}
                    />
                  </span>
                </>
              );

              return (
                <li key={item.key}>
                  {onSelect ? (
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelect(item.key)}
                      title={
                        active
                          ? `Remove filter ${selectLabel} = ${label}`
                          : `Filter to ${selectLabel} = ${label}`
                      }
                      className={`group/row block w-full text-left space-y-1.5 px-2 py-1.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        active
                          ? "bg-blue-50 dark:bg-blue-950/40"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="space-y-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
