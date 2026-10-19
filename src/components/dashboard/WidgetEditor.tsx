"use client";

import { useState, useEffect, useId } from "react";
import {
  WidgetType,
  AggregationType,
  TimeSeriesInterval,
  AnalyticsFilter,
  FilterOperator,
} from "@/types";
import { getLabelValues } from "@/services/api";
import { firstError } from "@/services/api.service";
import { FailureNote } from "@/components/FailureState";
import { reportError } from "@/services/monitor.service";
import { TimeRange, TIME_RANGES, suggestionWindow, withSelected } from "@/tools/timeRange.tools";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DashboardWidget, WidgetSize, WIDGET_SIZES, defaultSize } from "./dashboard.tools";

/** What the topn endpoint will honour. Outside it the backend silently uses 10. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

const NUMERIC_OPERATORS: FilterOperator[] = ["gt", "gte", "lt", "lte"];

interface WidgetEditorProps {
  widget: DashboardWidget | null;
  onSave: (widget: DashboardWidget) => void;
  onClose: () => void;
  /** The dashboard's selected range; the autocompletes are read over it. */
  range?: TimeRange;
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

export function WidgetEditor({ widget, onSave, onClose, range }: WidgetEditorProps) {
  const isEditing = !!widget;
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

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
  // Held as the raw string so an out-of-range value can be SHOWN as invalid.
  // It used to be parseInt'd on every keystroke with a `|| 10` fallback and no
  // bounds, so -5 was saved, posted, and quietly answered with 10 rows.
  const [limitText, setLimitText] = useState(
    String((widget?.type === "topn" && widget.limit) || 10),
  );
  const limit = Number(limitText);
  const limitValid =
    /^\d+$/.test(limitText.trim()) && limit >= LIMIT_MIN && limit <= LIMIT_MAX;
  const [size, setSize] = useState<WidgetSize | "">(widget?.size ?? "");
  const [rangeOverride, setRangeOverride] = useState(widget?.range_override ?? "");
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
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsToken, setOptionsToken] = useState(0);

  // These four populate every autocomplete in the widget form. Empty ones let a
  // user build a widget against a field list they think is exhaustive but is
  // actually just missing — the widget then renders nothing and the failure gets
  // blamed on the query rather than on this fetch.
  //
  // Read over the dashboard's range: the widget will render over that range, so
  // those are the values it can actually show.
  const labelsWindow = suggestionWindow("labels", range);
  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const [servicesRes, levelsRes, envsRes, namesRes] = await Promise.all([
          getLabelValues("service", { window: labelsWindow }),
          getLabelValues("level", { window: labelsWindow }),
          getLabelValues("env", { window: labelsWindow }),
          getLabelValues("name", { window: labelsWindow }),
        ]);
        // The range can change while these are in flight.
        if (cancelled) return;
        const failed = firstError(servicesRes, levelsRes, envsRes, namesRes);
        if (failed) {
          setOptionsError(failed.error_message || "The request failed.");
          return;
        }
        setOptionsError(null);
        setServices(servicesRes.success ? servicesRes.data : []);
        setLevels(levelsRes.success ? levelsRes.data : []);
        setEnvs(envsRes.success ? envsRes.data : []);
        setEventNames(namesRes.success ? namesRes.data : []);
      } catch (err) {
        reportError("widget_editor.options.load.failed", err, {
          outcome: "editor dropdowns show their failure note",
        });
        if (!cancelled) setOptionsError("Failed to load options");
      }
    };
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [optionsToken, labelsWindow]);

  const handleAddFilter = () => {
    const raw = newFilterValue.trim();
    if (!raw) return;
    let value: AnalyticsFilter["value"];
    if (newFilterOperator === "in") {
      // ⚠️ `in` takes an ARRAY. monitor-core's analytics bodies reject a string
      // for it, so the comma string this used to send failed the widget — the
      // same bug AnalyticsFilters had (ANALYTICS-01).
      value = raw.split(",").map((v) => v.trim()).filter((v) => v !== "");
      if (value.length === 0) return;
    } else if (NUMERIC_OPERATORS.includes(newFilterOperator) && Number.isFinite(Number(raw))) {
      value = Number(raw);
    } else {
      value = raw;
    }
    setFilters((prev) => [
      ...prev,
      { field: newFilterField, operator: newFilterOperator, value },
    ]);
    setNewFilterValue("");
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

  const canSave = type !== "topn" || limitValid;

  const handleSave = () => {
    if (!canSave) return;
    const baseConfig = {
      id: widget?.id || `widget-${Date.now()}`,
      title: title.trim() || `${type} widget`,
      aggregation,
      field: field || customField || undefined,
      filters,
      // Omitted rather than stored as the default, so a later change to the
      // default size reaches widgets nobody sized by hand.
      size: size || undefined,
      range_override: rangeOverride || undefined,
    };

    let config: DashboardWidget;

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
          limit: Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(limit))),
        };
        break;
      case "compare":
        config = { ...baseConfig, type: "compare", invertColors };
        break;
    }

    onSave(config);
  };

  const needsField = aggregation !== "count";

  const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";
  const inputClass =
    "w-full px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
  const smallControl =
    "px-2 py-1.5 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
  // `in` is a comma-separated list, which a single-value <select> cannot hold.
  const valueSuggestions =
    newFilterOperator === "in" || NUMERIC_OPERATORS.includes(newFilterOperator)
      ? []
      : getSuggestionsForField(newFilterField);

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? "Edit widget" : "Add widget"}
      widthClass="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isEditing ? "Save Changes" : "Add Widget"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {optionsError && (
          <FailureNote
            what="field suggestions"
            message={optionsError}
            onRetry={() => setOptionsToken((t) => t + 1)}
          />
        )}

        {/* Widget Type */}
        <fieldset className="space-y-2">
          <legend className={labelClass}>Widget Type</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {WIDGET_TYPES.map((wt) => (
              <button
                key={wt.value}
                type="button"
                aria-pressed={type === wt.value}
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
        </fieldset>

        {/* Title */}
        <div className="space-y-2">
          <label htmlFor={fid("title")} className={labelClass}>
            Title
          </label>
          <input
            id={fid("title")}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Widget title..."
            className={inputClass}
          />
        </div>

        {/* Layout + time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor={fid("size")} className={labelClass}>
              Width
            </label>
            <select
              id={fid("size")}
              value={size}
              onChange={(e) => setSize(e.target.value as WidgetSize | "")}
              className={inputClass}
            >
              <option value="">
                Auto ({WIDGET_SIZES.find((s) => s.value === defaultSize({ type } as DashboardWidget))?.label})
              </option>
              {WIDGET_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor={fid("range")} className={labelClass}>
              Time range
            </label>
            <select
              id={fid("range")}
              value={rangeOverride}
              onChange={(e) => setRangeOverride(e.target.value)}
              aria-describedby={fid("range-help")}
              className={inputClass}
            >
              <option value="">Dashboard range</option>
              {TIME_RANGES.map((r) => (
                <option key={r.from} value={r.from}>
                  {r.label}
                </option>
              ))}
            </select>
            <p id={fid("range-help")} className="text-xs text-zinc-500 dark:text-zinc-400">
              Pin this widget to its own range, e.g. a 30-day trend on a 1-hour board.
            </p>
          </div>
        </div>

        {/* Aggregation */}
        <div className="space-y-2">
          <label htmlFor={fid("aggregation")} className={labelClass}>
            Aggregation
          </label>
          <select
            id={fid("aggregation")}
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value as AggregationType)}
            className={inputClass}
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
            <label htmlFor={fid("field")} className={labelClass}>
              Field to Aggregate
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                id={fid("field")}
                value={field}
                onChange={(e) => {
                  setField(e.target.value);
                  if (e.target.value) setCustomField("");
                }}
                className={`${inputClass} sm:flex-1`}
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
                aria-label="Custom field to aggregate"
                value={customField}
                onChange={(e) => {
                  setCustomField(e.target.value);
                  if (e.target.value) setField("");
                }}
                placeholder="data.custom_field"
                className={`${inputClass} sm:flex-1`}
              />
            </div>
          </div>
        )}

        {/* Type-specific options */}
        {type === "timeseries" && (
          <>
            <fieldset className="space-y-2">
              <legend className={labelClass}>Display Mode</legend>
              <div className="flex gap-2">
                {(["chart", "table"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={displayMode === mode}
                    onClick={() => setDisplayMode(mode)}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      displayMode === mode
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={
                            mode === "chart"
                              ? "M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
                              : "M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                          }
                        />
                      </svg>
                      {mode === "chart" ? "Chart" : "Table"}
                    </div>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor={fid("interval")} className={labelClass}>
                  Interval
                </label>
                <select
                  id={fid("interval")}
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as TimeSeriesInterval)}
                  className={inputClass}
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
                  <label htmlFor={fid("color")} className={labelClass}>
                    Color
                  </label>
                  <select
                    id={fid("color")}
                    value={color}
                    onChange={(e) => setColor(e.target.value as typeof color)}
                    className={inputClass}
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
              <label htmlFor={fid("group")} className={labelClass}>
                Group By (optional, for multiple series)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  id={fid("group")}
                  value={groupBy}
                  onChange={(e) => {
                    setGroupBy(e.target.value);
                    if (e.target.value) setCustomGroupBy("");
                  }}
                  className={`${inputClass} sm:flex-1`}
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
                  aria-label="Custom group by field"
                  value={customGroupBy}
                  onChange={(e) => {
                    setCustomGroupBy(e.target.value);
                    if (e.target.value) setGroupBy("");
                  }}
                  placeholder="data.custom"
                  className={`${inputClass} sm:flex-1`}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={fillZeros} onChange={() => setFillZeros(!fillZeros)} />
              <span className="text-zinc-700 dark:text-zinc-300">
                Fill empty intervals with zero
              </span>
            </label>
          </>
        )}

        {type === "topn" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor={fid("topn-group")} className={labelClass}>
                Group By (dimension)
              </label>
              <select
                id={fid("topn-group")}
                value={groupBy}
                onChange={(e) => {
                  setGroupBy(e.target.value);
                  if (e.target.value) setCustomGroupBy("");
                }}
                className={inputClass}
              >
                {COMMON_FIELDS.filter((f) => f.value).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label="Custom group by field"
                value={customGroupBy}
                onChange={(e) => {
                  setCustomGroupBy(e.target.value);
                  if (e.target.value) setGroupBy("");
                }}
                placeholder="or custom: data.endpoint"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={fid("limit")} className={labelClass}>
                Limit
              </label>
              <input
                id={fid("limit")}
                type="number"
                inputMode="numeric"
                value={limitText}
                onChange={(e) => setLimitText(e.target.value)}
                min={LIMIT_MIN}
                max={LIMIT_MAX}
                step={1}
                aria-invalid={!limitValid || undefined}
                aria-describedby={fid("limit-help")}
                className={`${inputClass} ${limitValid ? "" : "border-red-500 dark:border-red-500"}`}
              />
              <p
                id={fid("limit-help")}
                className={`text-xs ${limitValid ? "text-zinc-500 dark:text-zinc-400" : "text-red-600 dark:text-red-400"}`}
              >
                {limitValid
                  ? `Rows to show, ${LIMIT_MIN}–${LIMIT_MAX}.`
                  : `Enter a whole number from ${LIMIT_MIN} to ${LIMIT_MAX}.`}
              </p>
            </div>
          </div>
        )}

        {type === "gauge" && (
          <div className="space-y-2">
            <label htmlFor={fid("variant")} className={labelClass}>
              Style
            </label>
            <select
              id={fid("variant")}
              value={variant}
              onChange={(e) => setVariant(e.target.value as typeof variant)}
              className={inputClass}
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
            <Checkbox checked={invertColors} onChange={() => setInvertColors(!invertColors)} />
            <span className="text-zinc-700 dark:text-zinc-300">
              Invert colors (decrease is good, e.g., for errors)
            </span>
          </label>
        )}

        {/* Filters */}
        <fieldset className="space-y-3">
          <legend className={labelClass}>Filters (widget-specific)</legend>

          {filters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filters.map((filter, index) => {
                const opLabel = OPERATORS.find((o) => o.value === filter.operator)?.label;
                const valueText = Array.isArray(filter.value) ? filter.value.join(", ") : String(filter.value);
                return (
                  <div
                    key={index}
                    className="inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-full text-xs"
                  >
                    <span className="text-blue-700 dark:text-blue-300 font-medium">{filter.field}</span>
                    <span className="text-blue-500 dark:text-blue-400">{opLabel}</span>
                    <span className="truncate text-blue-800 dark:text-blue-200">{valueText}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFilter(index)}
                      aria-label={`Remove filter ${filter.field} ${opLabel} ${valueText}`}
                      title="Remove filter"
                      className="ml-1 text-blue-400 hover:text-blue-600"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:items-center">
            <select
              aria-label="Filter field"
              value={newFilterField}
              onChange={(e) => setNewFilterField(e.target.value)}
              className={smallControl}
            >
              {COMMON_FIELDS.filter((f) => f.value).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter operator"
              value={newFilterOperator}
              onChange={(e) => setNewFilterOperator(e.target.value as FilterOperator)}
              className={smallControl}
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            {valueSuggestions.length > 0 ? (
              <select
                aria-label="Filter value"
                value={newFilterValue}
                onChange={(e) => setNewFilterValue(e.target.value)}
                className={`${smallControl} col-span-2 sm:min-w-[120px]`}
              >
                <option value="">Select...</option>
                {withSelected(valueSuggestions, newFilterValue).map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                aria-label="Filter value"
                value={newFilterValue}
                onChange={(e) => setNewFilterValue(e.target.value)}
                placeholder={newFilterOperator === "in" ? "a, b, c" : "Value..."}
                onKeyDown={(e) => e.key === "Enter" && handleAddFilter()}
                className={`${smallControl} col-span-2 sm:min-w-[120px]`}
              />
            )}
            <button
              type="button"
              onClick={handleAddFilter}
              disabled={!newFilterValue.trim()}
              className="col-span-2 sm:col-span-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-50 transition-colors"
            >
              Add filter
            </button>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
