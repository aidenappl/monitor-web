"use client";

import { useState, useEffect } from "react";
import { AnalyticsFilter, FilterOperator } from "@/types";
import { getLabelValues } from "@/services/api";

interface AnalyticsFiltersProps {
  filters: AnalyticsFilter[];
  onFiltersChange: (filters: AnalyticsFilter[]) => void;
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

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [servicesRes, levelsRes, envsRes] = await Promise.all([
          getLabelValues("service"),
          getLabelValues("level"),
          getLabelValues("env"),
        ]);
        setServices(servicesRes.data || []);
        setLevels(levelsRes.data || []);
        setEnvs(envsRes.data || []);
      } catch (err) {
        console.error("Failed to load filter options:", err);
      }
    };
    loadOptions();
  }, []);

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
        return services;
      case "level":
        return levels;
      case "env":
        return envs;
      default:
        return [];
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
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
          {getSuggestions(newFilter.field).length > 0 ? (
            <select
              value={newFilter.value}
              onChange={(e) =>
                setNewFilter((prev) => ({ ...prev, value: e.target.value }))
              }
              className="px-2 py-1 text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-700 dark:text-zinc-300 min-w-[100px]"
            >
              <option value="">Select...</option>
              {getSuggestions(newFilter.field).map((val) => (
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
          onClick={() => setIsAdding(true)}
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
