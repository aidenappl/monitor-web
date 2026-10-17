"use client";

import { useState, useEffect, useMemo } from "react";
import { EventQueryParams } from "@/types";
import { getLabelValues } from "@/services/api";
import { suggestionWindow, withSelected } from "@/tools/timeRange.tools";
import { FailureNote } from "@/components/FailureState";
import { QueryInput, QueryChip, Operator } from "@/components/QueryInput";
import { reportError } from "@/services/monitor.service";

/** The search box's input id — its label, and the page's `/` shortcut, point at it. */
export const EVENT_SEARCH_INPUT_ID = "event-search-input";

interface EventFiltersProps {
  filters: EventQueryParams;
  onFiltersChange: (filters: EventQueryParams) => void;
  onSearch: () => void;
}

// Convert Django-style param key to field and operator
// e.g., "service__contains" -> { field: "service", operator: "contains" }
// e.g., "service" -> { field: "service", operator: "eq" }
function parseFilterKey(key: string): { field: string; operator: Operator } {
  const operators: Operator[] = [
    "neq",
    "lte",
    "gte",
    "lt",
    "gt",
    "contains",
    "startswith",
    "endswith",
    "in",
    "eq",
  ];

  for (const op of operators) {
    if (key.endsWith(`__${op}`)) {
      return {
        field: key.slice(0, -(op.length + 2)),
        operator: op,
      };
    }
  }

  return { field: key, operator: "eq" };
}

// Convert field and operator to Django-style param key
function buildFilterKey(field: string, operator: Operator): string {
  if (operator === "eq") {
    return field;
  }
  return `${field}__${operator}`;
}

export function EventFilters({
  filters,
  onFiltersChange,
  onSearch,
}: EventFiltersProps) {
  const [levels, setLevels] = useState<string[]>([]);
  const [levelsError, setLevelsError] = useState<string | null>(null);
  const [levelsToken, setLevelsToken] = useState(0);

  // A level dropdown with nothing under "All Levels" reads as a project that has
  // never logged an error. console.error is not a user-facing failure branch.
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const levelsRes = await getLabelValues("level", {
          window: suggestionWindow("labels"),
        });
        if (!levelsRes.success) {
          setLevelsError(levelsRes.error_message || "The request failed.");
          return;
        }
        setLevelsError(null);
        setLevels(levelsRes.data);
      } catch (err) {
        reportError("event_filters.levels.load.failed", err, {
          outcome: "level dropdown shows its failure note",
        });
        setLevelsError("Failed to load levels");
      }
    };
    loadOptions();
  }, [levelsToken]);

  // Convert filters to chips (excluding level, limit, offset, from, to)
  const chips = useMemo(() => {
    const excludeKeys = ["level", "limit", "offset", "from", "to"];
    const result: QueryChip[] = [];

    Object.entries(filters).forEach(([key, value]) => {
      if (excludeKeys.includes(key) || value === undefined || value === "") {
        return;
      }

      const { field, operator } = parseFilterKey(key);
      result.push({
        key: field,
        operator,
        value: String(value),
        displayKey: field,
      });
    });

    return result;
  }, [filters]);

  const handleChipsChange = (newChips: QueryChip[]) => {
    // Build new filters from chips
    const newFilters: EventQueryParams = {
      level: filters.level,
      limit: filters.limit,
      // A new filter is a new result set: page 4 of the old one is not page 4
      // of this one, and keeping the offset rendered an empty table.
      offset: 0,
      from: filters.from,
      to: filters.to,
    };

    newChips.forEach((chip) => {
      const paramKey = buildFilterKey(chip.key, chip.operator);
      newFilters[paramKey] = chip.value;
    });

    onFiltersChange(newFilters);
  };

  const handleChange = (key: "level" | "limit", value: string) => {
    onFiltersChange({
      ...filters,
      // The limit is a number on the wire and in the pagination maths; the
      // select hands back a string.
      [key]: key === "limit" ? Number(value) : value || undefined,
      // Same reason as the chips: a changed filter or page size starts over.
      offset: 0,
    });
  };

  // Get current service from filters for data key autocomplete
  const currentService = chips.find((c) => c.key === "service")?.value;

  return (
    <div className="flex flex-1 min-w-0 flex-col gap-3 p-3 sm:p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <label
            htmlFor={EVENT_SEARCH_INPUT_ID}
            className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            Search
          </label>
          <QueryInput
            inputId={EVENT_SEARCH_INPUT_ID}
            chips={chips}
            onChipsChange={handleChipsChange}
            onSearch={onSearch}
            currentService={currentService}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          {/* The failure note sits OUTSIDE the label, below the select: inside
              it, the combobox's accessible name became "Level Couldn't load
              levels Retry" and the note widened the column. Absolutely placed
              so the row does not shift when it appears. */}
          <div className="relative flex flex-col gap-1">
            <label htmlFor="event-filter-level" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Level
            </label>
            <select
              id="event-filter-level"
              aria-describedby={levelsError ? "event-filter-level-error" : undefined}
              value={filters.level || ""}
              onChange={(e) => handleChange("level", e.target.value)}
              className="h-10.5 px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
            >
              <option value="">All levels</option>
              {/* A saved view's level can have no events in the list's window;
                  withSelected keeps it showing. */}
              {withSelected(levels, filters.level).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            {levelsError && (
              <div
                id="event-filter-level-error"
                className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-white px-1 dark:bg-zinc-900"
              >
                <FailureNote
                  what="levels"
                  message={levelsError}
                  onRetry={() => setLevelsToken((t) => t + 1)}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="event-filter-limit" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Per page
            </label>
            <select
              id="event-filter-limit"
              value={filters.limit || 100}
              onChange={(e) => handleChange("limit", e.target.value)}
              className="h-10.5 px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>

          <button
            onClick={onSearch}
            aria-label="Search"
            title="Search"
            className="h-10.5 px-4 sm:px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-2"
          >
            <svg
              aria-hidden
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span className="hidden sm:inline" aria-hidden>
              Search
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
