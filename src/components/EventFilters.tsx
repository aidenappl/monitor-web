"use client";

import { useState, useEffect, useMemo } from "react";
import { EventQueryParams } from "@/types";
import { getLabelValues } from "@/services/api";
import { QueryInput, QueryChip, Operator } from "@/components/QueryInput";

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

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const levelsRes = await getLabelValues("level");
        setLevels(levelsRes.data || []);
      } catch (err) {
        console.error("Failed to load filter options:", err);
      }
    };
    loadOptions();
  }, []);

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
      offset: filters.offset,
      from: filters.from,
      to: filters.to,
    };

    newChips.forEach((chip) => {
      const paramKey = buildFilterKey(chip.key, chip.operator);
      newFilters[paramKey] = chip.value;
    });

    onFiltersChange(newFilters);
  };

  const handleChange = (key: keyof EventQueryParams, value: string) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };

  // Get current service from filters for data key autocomplete
  const currentService = chips.find((c) => c.key === "service")?.value;

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <QueryInput
          chips={chips}
          onChipsChange={handleChipsChange}
          onSearch={onSearch}
          currentService={currentService}
        />

        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Level
            </label>
            <select
              value={filters.level || ""}
              onChange={(e) => handleChange("level", e.target.value)}
              className="h-[42px] px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
            >
              <option value="">All levels</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Limit
            </label>
            <select
              value={filters.limit || 100}
              onChange={(e) => handleChange("limit", e.target.value)}
              className="h-[42px] px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
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
            className="h-[42px] px-4 sm:px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-2"
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span className="hidden sm:inline">Search</span>
          </button>
        </div>
      </div>
    </div>
  );
}
