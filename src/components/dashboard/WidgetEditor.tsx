"use client";

import { useState, useEffect } from "react";
import {
  WidgetConfig,
  WidgetType,
  AggregationType,
  TimeSeriesInterval,
  AnalyticsFilter,
  FilterOperator,
} from "@/types";
import { getLabelValues } from "@/services/api";

interface WidgetEditorProps {
  widget: WidgetConfig | null;
  onSave: (widget: WidgetConfig) => void;
  onClose: () => void;
}

const WIDGET_TYPES: {
  value: WidgetType;
  label: string;
  description: string;
}[] = [
  { value: "gauge", label: "Gauge", description: "Single metric value" },
  {
    value: "timeseries",
    label: "Time Series",
    description: "Line chart over time",
  },
  { value: "topn", label: "Top N", description: "Ranked list of values" },
  {
    value: "compare",
    label: "Compare",
    description: "Current vs previous period",
  },
];

const AGGREGATIONS: { value: AggregationType; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "count_unique", label: "Count Unique" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "p50", label: "P50 (Median)" },
  { value: "p90", label: "P90" },
  { value: "p95", label: "P95" },
  { value: "p99", label: "P99" },
];

const INTERVALS: { value: TimeSeriesInterval; label: string }[] = [
  { value: "minute", label: "Minute" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const COLORS = [
  { value: "blue", label: "Blue" },
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
];

const VARIANTS = [
  { value: "default", label: "Default (Blue)" },
  { value: "error", label: "Error (Red)" },
  { value: "success", label: "Success (Green)" },
  { value: "warning", label: "Warning (Amber)" },
];

const COMMON_FIELDS = [
  { value: "", label: "None (for count)" },
  { value: "service", label: "service" },
  { value: "env", label: "env" },
  { value: "name", label: "name" },
  { value: "level", label: "level" },
  { value: "user_id", label: "user_id" },
  { value: "trace_id", label: "trace_id" },
  { value: "job_id", label: "job_id" },
];

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "startswith", label: "starts with" },
  { value: "endswith", label: "ends with" },
  { value: "in", label: "in" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
];

export function WidgetEditor({ widget, onSave, onClose }: WidgetEditorProps) {
  const isEditing = !!widget;

  // Form state
  const [type, setType] = useState<WidgetType>(widget?.type || "gauge");
  const [title, setTitle] = useState(widget?.title || "");
  const [aggregation, setAggregation] = useState<AggregationType>(
    widget?.aggregation || "count",
  );
  const [field, setField] = useState(widget?.field || "");
  const [customField, setCustomField] = useState("");
  const [filters, setFilters] = useState<AnalyticsFilter[]>(
    widget?.filters || [],
  );

  // Type-specific state
  const [interval, setInterval] = useState<TimeSeriesInterval>(
    (widget?.type === "timeseries" && widget.interval) || "hour",
  );
  const [displayMode, setDisplayMode] = useState<"chart" | "table">(
    (widget?.type === "timeseries" && widget.display) || "chart",
  );
  const [groupBy, setGroupBy] = useState<string>(
    (widget?.type === "timeseries" && widget.group_by?.[0]) ||
      (widget?.type === "topn" && widget.group_by) ||
      "service",
  );
  const [customGroupBy, setCustomGroupBy] = useState("");
  const [fillZeros, setFillZeros] = useState(
    widget?.type === "timeseries" ? (widget.fill_zeros ?? true) : true,
  );
  const [color, setColor] = useState<"blue" | "red" | "green" | "amber">(
    (widget?.type === "timeseries" && widget.color) || "blue",
  );
  const [variant, setVariant] = useState<
    "default" | "error" | "success" | "warning"
  >((widget?.type === "gauge" && widget.variant) || "default");
  const [limit, setLimit] = useState(
    (widget?.type === "topn" && widget.limit) || 10,
  );
  const [invertColors, setInvertColors] = useState(
    (widget?.type === "compare" && widget.invertColors) || false,
  );

  // Filter form state
  const [newFilterField, setNewFilterField] = useState("service");
  const [newFilterOperator, setNewFilterOperator] =
    useState<FilterOperator>("eq");
  const [newFilterValue, setNewFilterValue] = useState("");

  // Autocomplete options
  const [services, setServices] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [eventNames, setEventNames] = useState<string[]>([]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [servicesRes, levelsRes, envsRes, namesRes] = await Promise.all([
          getLabelValues("service"),
          getLabelValues("level"),
          getLabelValues("env"),
          getLabelValues("name"),
        ]);
        setServices(servicesRes.data || []);
        setLevels(levelsRes.data || []);
        setEnvs(envsRes.data || []);
        setEventNames(namesRes.data || []);
      } catch (err) {
        console.error("Failed to load options:", err);
      }
    };
    loadOptions();
  }, []);

  const handleAddFilter = () => {
    if (newFilterValue.trim()) {
      setFilters((prev) => [
        ...prev,
        {
          field: newFilterField,
          operator: newFilterOperator,
          value: newFilterValue.trim(),
        },
      ]);
      setNewFilterValue("");
    }
  };

  const handleRemoveFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const getSuggestionsForField = (fieldName: string): string[] => {
    switch (fieldName) {
      case "service":
        return services;
      case "level":
        return levels;
      case "env":
        return envs;
      case "name":
        return eventNames;
      default:
        return [];
    }
  };

  const handleSave = () => {
    const baseConfig = {
      id: widget?.id || `widget-${Date.now()}`,
      title: title || `${type} widget`,
      aggregation,
      field: field || customField || undefined,
      filters,
    };

    let config: WidgetConfig;

    switch (type) {
      case "gauge":
        config = { ...baseConfig, type: "gauge", variant };
        break;
      case "timeseries":
        config = {
          ...baseConfig,
          type: "timeseries",
          display: displayMode,
          interval,
          group_by:
            groupBy || customGroupBy ? [groupBy || customGroupBy] : undefined,
          fill_zeros: fillZeros,
          color,
        };
        break;
      case "topn":
        config = {
          ...baseConfig,
          type: "topn",
          group_by: groupBy || customGroupBy || "service",
          limit,
        };
        break;
      case "compare":
        config = { ...baseConfig, type: "compare", invertColors };
        break;
    }

    onSave(config);
  };

  const needsField = aggregation !== "count";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {isEditing ? "Edit Widget" : "Add Widget"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg
              className="w-5 h-5"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Widget Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Widget Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {WIDGET_TYPES.map((wt) => (
                <button
                  key={wt.value}
                  onClick={() => setType(wt.value)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    type === wt.value
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                      : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
                >
                  <div
                    className={`text-sm font-medium ${type === wt.value ? "text-blue-700 dark:text-blue-300" : "text-zinc-900 dark:text-zinc-100"}`}
                  >
                    {wt.label}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {wt.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Widget title..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Aggregation */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Aggregation
            </label>
            <select
              value={aggregation}
              onChange={(e) =>
                setAggregation(e.target.value as AggregationType)
              }
              className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AGGREGATIONS.map((agg) => (
                <option key={agg.value} value={agg.value}>
                  {agg.label}
                </option>
              ))}
            </select>
          </div>

          {/* Field (for non-count aggregations) */}
          {needsField && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Field to Aggregate
              </label>
              <div className="flex gap-2">
                <select
                  value={field}
                  onChange={(e) => {
                    setField(e.target.value);
                    if (e.target.value) setCustomField("");
                  }}
                  className="flex-1 px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {COMMON_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className="self-center text-zinc-400 text-sm">or</span>
                <input
                  type="text"
                  value={customField}
                  onChange={(e) => {
                    setCustomField(e.target.value);
                    if (e.target.value) setField("");
                  }}
                  placeholder="data.custom_field"
                  className="flex-1 px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Type-specific options */}
          {type === "timeseries" && (
            <>
              {/* Display Mode Toggle */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Display Mode
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDisplayMode("chart")}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      displayMode === "chart"
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                      </svg>
                      Chart
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayMode("table")}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      displayMode === "table"
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Table
                    </div>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Interval
                  </label>
                  <select
                    value={interval}
                    onChange={(e) =>
                      setInterval(e.target.value as TimeSeriesInterval)
                    }
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {INTERVALS.map((i) => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </div>
                {displayMode === "chart" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Color
                    </label>
                    <select
                      value={color}
                      onChange={(e) => setColor(e.target.value as typeof color)}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {COLORS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Group By (optional, for multiple series)
                </label>
                <div className="flex gap-2">
                  <select
                    value={groupBy}
                    onChange={(e) => {
                      setGroupBy(e.target.value);
                      if (e.target.value) setCustomGroupBy("");
                    }}
                    className="flex-1 px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">None</option>
                    {COMMON_FIELDS.filter((f) => f.value).map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <span className="self-center text-zinc-400 text-sm">or</span>
                  <input
                    type="text"
                    value={customGroupBy}
                    onChange={(e) => {
                      setCustomGroupBy(e.target.value);
                      if (e.target.value) setGroupBy("");
                    }}
                    placeholder="data.custom"
                    className="flex-1 px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fillZeros}
                  onChange={(e) => setFillZeros(e.target.checked)}
                  className="rounded border-zinc-300 dark:border-zinc-600"
                />
                <span className="text-zinc-700 dark:text-zinc-300">
                  Fill empty intervals with zero
                </span>
              </label>
            </>
          )}

          {type === "topn" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Group By (dimension)
                </label>
                <div className="flex gap-2">
                  <select
                    value={groupBy}
                    onChange={(e) => {
                      setGroupBy(e.target.value);
                      if (e.target.value) setCustomGroupBy("");
                    }}
                    className="flex-1 px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {COMMON_FIELDS.filter((f) => f.value).map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={customGroupBy}
                  onChange={(e) => {
                    setCustomGroupBy(e.target.value);
                    if (e.target.value) setGroupBy("");
                  }}
                  placeholder="or custom: data.endpoint"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Limit
                </label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                  min={1}
                  max={100}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {type === "gauge" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Style
              </label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value as typeof variant)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {VARIANTS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === "compare" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={invertColors}
                onChange={(e) => setInvertColors(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-600"
              />
              <span className="text-zinc-700 dark:text-zinc-300">
                Invert colors (decrease is good, e.g., for errors)
              </span>
            </label>
          )}

          {/* Filters */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Filters (widget-specific)
            </label>

            {/* Existing filters */}
            {filters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {filters.map((filter, index) => (
                  <div
                    key={index}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-full text-xs"
                  >
                    <span className="text-blue-700 dark:text-blue-300 font-medium">
                      {filter.field}
                    </span>
                    <span className="text-blue-500 dark:text-blue-400">
                      {
                        OPERATORS.find((o) => o.value === filter.operator)
                          ?.label
                      }
                    </span>
                    <span className="text-blue-800 dark:text-blue-200">
                      {String(filter.value)}
                    </span>
                    <button
                      onClick={() => handleRemoveFilter(index)}
                      className="ml-1 text-blue-400 hover:text-blue-600"
                    >
                      <svg
                        className="w-3 h-3"
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
              </div>
            )}

            {/* Add filter */}
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={newFilterField}
                onChange={(e) => setNewFilterField(e.target.value)}
                className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {COMMON_FIELDS.filter((f) => f.value).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={newFilterOperator}
                onChange={(e) =>
                  setNewFilterOperator(e.target.value as FilterOperator)
                }
                className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              {getSuggestionsForField(newFilterField).length > 0 ? (
                <select
                  value={newFilterValue}
                  onChange={(e) => setNewFilterValue(e.target.value)}
                  className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
                >
                  <option value="">Select...</option>
                  {getSuggestionsForField(newFilterField).map((val) => (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={newFilterValue}
                  onChange={(e) => setNewFilterValue(e.target.value)}
                  placeholder="Value..."
                  onKeyDown={(e) => e.key === "Enter" && handleAddFilter()}
                  className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
                />
              )}
              <button
                onClick={handleAddFilter}
                disabled={!newFilterValue.trim()}
                className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-50 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            {isEditing ? "Save Changes" : "Add Widget"}
          </button>
        </div>
      </div>
    </div>
  );
}
