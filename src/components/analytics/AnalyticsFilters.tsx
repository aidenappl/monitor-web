"use client";

import { useState, useEffect } from "react";
import { AnalyticsFilter, FilterOperator } from "@/types";
import { getLabelValues } from "@/services/api";
import { firstError } from "@/services/api.service";
import { FailureNote } from "@/components/FailureState";
import { reportError } from "@/services/monitor.service";
import { TimeRange, suggestionWindow, withSelected } from "@/tools/timeRange.tools";

/** Label values a page has already loaded and hands down instead of refetching. */
export interface AnalyticsFilterOptions {
  service?: string[];
  level?: string[];
  env?: string[];
}

interface AnalyticsFiltersProps {
  filters: AnalyticsFilter[];
  onFiltersChange: (filters: AnalyticsFilter[]) => void;
  /**
   * Suggestions the page already holds. When passed, this component NEVER
   * fetches its own — the dashboard loads these same three lists for its
   * variables, and fetching them twice on one mount was pure waste.
   */
  options?: AnalyticsFilterOptions;
  /** The page's failure for `options`, shown where they are consumed. */
  optionsError?: string | null;
  /** Retries the page's load of `options`. */
  onRetryOptions?: () => void;
  /** The page's selected range; suggestions are read over it. */
  range?: TimeRange;
}

const FILTER_FIELDS = [
  { value: "service", label: "Service" },
  { value: "env", label: "Environment" },
  { value: "name", label: "Event Name" },
  { value: "level", label: "Level" },
  { value: "user_id", label: "User ID" },
  { value: "trace_id", label: "Trace ID" },
  { value: "job_id", label: "Job ID" },
];

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "startswith", label: "starts with" },
  { value: "endswith", label: "ends with" },
  { value: "in", label: "in" },
];

export function AnalyticsFilters({
  filters,
  onFiltersChange,
  options,
  optionsError: pageOptionsError,
  onRetryOptions,
  range,
}: AnalyticsFiltersProps) {
  const [services, setServices] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newFilter, setNewFilter] = useState<{
    field: string;
    operator: FilterOperator;
    value: string;
  }>({ field: "service", operator: "eq", value: "" });

  const [ownOptionsError, setOwnOptionsError] = useState<string | null>(null);
  const [optionsToken, setOptionsToken] = useState(0);
  /**
   * Set by the first "Add Filter" click and never reset. The suggestions are
   * only read inside the add form, so loading them on mount spent three label
   * scans on every analytics and dashboard load for a form that is usually
   * never opened. Once opened, a range change refreshes them as before.
   */
  const [suggestActive, setSuggestActive] = useState(false);
  const pageOwned = options !== undefined;
  const labelsWindow = suggestionWindow("labels", range);

  /**
   * The load this component's own suggestions are for, and the last one that
   * settled (succeeded or failed).
   *
   * ⚠️ LOADING IS DERIVED, NOT SET. Flipping a boolean to true at the top of the
   * effect is a synchronous setState in an effect body, which
   * `react-hooks/set-state-in-effect` rejects. Comparing the live key against the
   * settled one needs only the write after the `await`, and a superseded load
   * (range change, retry) reads as loading until ITS answer lands.
   */
  const loadKey = `${labelsWindow}#${optionsToken}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const optionsLoading = !pageOwned && suggestActive && settledKey !== loadKey;

  // These three feed the value suggestions on every filter chip. Empty
  // suggestions look like a project with no services in it, so the failure has
  // to be visible rather than only in the console.
  useEffect(() => {
    if (pageOwned || !suggestActive) return;
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const [servicesRes, levelsRes, envsRes] = await Promise.all([
          getLabelValues("service", { window: labelsWindow }),
          getLabelValues("level", { window: labelsWindow }),
          getLabelValues("env", { window: labelsWindow }),
        ]);
        // The range can change while these are in flight.
        if (cancelled) return;
        const failed = firstError(servicesRes, levelsRes, envsRes);
        if (failed) {
          setOwnOptionsError(failed.error_message || "The request failed.");
          return;
        }
        setOwnOptionsError(null);
        setServices(servicesRes.success ? servicesRes.data : []);
        setLevels(levelsRes.success ? levelsRes.data : []);
        setEnvs(envsRes.success ? envsRes.data : []);
      } catch (err) {
        reportError("analytics_filters.options.load.failed", err, {
          outcome: "filter dropdowns show their failure note",
        });
        if (!cancelled) setOwnOptionsError("Failed to load filter options");
      } finally {
        if (!cancelled) setSettledKey(loadKey);
      }
    };
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [pageOwned, suggestActive, labelsWindow, optionsToken, loadKey]);

  // Page-owned options already carry a failure note on the page itself (the
  // dashboard's variables bar), so here it is shown only inside the add form
  // that consumes them — one failure is not announced twice at rest.
  const optionsError = pageOwned
    ? isAdding
      ? (pageOptionsError ?? null)
      : null
    : ownOptionsError;
  const retryOptions = pageOwned
    ? onRetryOptions
    : () => setOptionsToken((t) => t + 1);

  const handleAddFilter = () => {
    if (newFilter.value.trim()) {
      onFiltersChange([
        ...filters,
        {
          field: newFilter.field,
          operator: newFilter.operator,
          value: newFilter.value.trim(),
        },
      ]);
      setNewFilter({ field: "service", operator: "eq", value: "" });
      setIsAdding(false);
    }
  };

  const handleRemoveFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  const getSuggestions = (field: string): string[] => {
    switch (field) {
      case "service":
        return pageOwned ? (options.service ?? []) : services;
      case "level":
        return pageOwned ? (options.level ?? []) : levels;
      case "env":
        return pageOwned ? (options.env ?? []) : envs;
      default:
        return [];
    }
  };

  /**
   * Whether the value control should hold a disabled "Loading…" select.
   *
   * ⚠️ WITHOUT THIS THE FORM SWAPS CONTROLS UNDER THE USER. The first "Add
   * Filter" starts the lazy load, so for its first few hundred ms the list is
   * empty and the free-text input renders — then the labels land and a
   * `<select>` replaces it, dropping focus and possibly keeping a half-typed
   * value as the selection. Only an EMPTY list waits: stale values from the
   * previous range stay selectable during a refresh, and a load that settles
   * empty or failed falls back to free text as before.
   */
  const awaitingSuggestions = (field: string): boolean =>
    optionsLoading &&
    (field === "service" || field === "level" || field === "env") &&
    getSuggestions(field).length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {optionsError && (
        <FailureNote
          what="filter suggestions"
          message={optionsError}
          onRetry={retryOptions}
        />
      )}
      {/* Existing filters as chips */}
      {filters.map((filter, index) => (
        <div
          key={index}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-full text-sm"
        >
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            {filter.field}
          </span>
          <span className="text-blue-500 dark:text-blue-400">
            {OPERATORS.find((o) => o.value === filter.operator)?.label ||
              filter.operator}
          </span>
          <span className="text-blue-800 dark:text-blue-200">
            {String(filter.value)}
          </span>
          <button
            onClick={() => handleRemoveFilter(index)}
            className="ml-1 text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ))}

      {/* Add filter button/form */}
      {isAdding ? (
        <div className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1">
          <select
            value={newFilter.field}
            onChange={(e) =>
              setNewFilter((prev) => ({ ...prev, field: e.target.value }))
            }
            className="px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-700 dark:text-zinc-300"
          >
            {FILTER_FIELDS.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>
          <select
            value={newFilter.operator}
            onChange={(e) =>
              setNewFilter((prev) => ({
                ...prev,
                operator: e.target.value as FilterOperator,
              }))
            }
            className="px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-700 dark:text-zinc-300"
          >
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          {awaitingSuggestions(newFilter.field) ? (
            <select
              disabled
              aria-busy="true"
              className="px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-400 dark:text-zinc-500 min-w-[100px] disabled:cursor-wait"
            >
              <option value="">Loading…</option>
            </select>
          ) : getSuggestions(newFilter.field).length > 0 ? (
            <select
              value={newFilter.value}
              onChange={(e) =>
                setNewFilter((prev) => ({ ...prev, value: e.target.value }))
              }
              className="px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-700 dark:text-zinc-300 min-w-[100px]"
            >
              <option value="">Select...</option>
              {withSelected(getSuggestions(newFilter.field), newFilter.value).map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={newFilter.value}
              onChange={(e) =>
                setNewFilter((prev) => ({ ...prev, value: e.target.value }))
              }
              placeholder="Value..."
              className="px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-700 dark:text-zinc-300 min-w-[100px]"
              onKeyDown={(e) => e.key === "Enter" && handleAddFilter()}
            />
          )}
          <button
            onClick={handleAddFilter}
            disabled={!newFilter.value.trim()}
            className="p-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 disabled:opacity-50"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
          <button
            onClick={() => {
              setIsAdding(false);
              setNewFilter({ field: "service", operator: "eq", value: "" });
            }}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setSuggestActive(true);
            setIsAdding(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-full transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add Filter
        </button>
      )}
    </div>
  );
}
