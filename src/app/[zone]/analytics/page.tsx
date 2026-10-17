"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useId, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
  faFilter,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  AggregationType,
  AnalyticsFilter,
  TimeSeriesInterval,
  TimeSeriesSeries,
  TopNDataPoint,
} from "@/types";
import { getTimeSeries, getGauge, getCompare, getTopN, getDataKeys } from "@/services/api";
import {
  TimeSeriesChart,
  formatCompactNumber,
  formatDurationMs,
  type ChartSeries,
} from "@/components/analytics/TimeSeriesChart";
import { GaugeCard } from "@/components/analytics/GaugeCard";
import { CompareCard } from "@/components/analytics/CompareCard";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { TimeRangePicker } from "@/components/analytics/TimeRangePicker";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FailureState, FailureNote } from "@/components/FailureState";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useUrlState, urlEnum, urlString, type UrlCodec } from "@/hooks/useUrlState";
import {
  exportToCSV,
  exportToJSON,
  seriesExportRows,
  analyticsExportMeta,
  exportFilename,
} from "@/tools/export.tools";
import {
  TimeRange,
  TIME_RANGES,
  customRange,
  getTimeRange,
  getIntervalForRange,
  previousPeriodBeyondRetention,
  rangeFromParam,
  rangeToParam,
  suggestionWindow,
  withSelected,
} from "@/tools/timeRange.tools";
import { dataOf, firstError } from "@/services/api.service";
import { reportError } from "@/services/monitor.service";

// ── URL state ───────────────────────────────────────────────────────────────
//
// Range, filters and the explorer controls all live in the query string, so a
// reload, Back, or a link pasted into chat reproduces the exact view. Defaults
// are omitted: an untouched page is still a bare /{zone}/analytics.

const DEFAULT_RANGE = TIME_RANGES[2];

const rangeCodec: UrlCodec<TimeRange> = {
  parse: (raw) => rangeFromParam(raw) ?? undefined,
  serialize: rangeToParam,
};

const NO_FILTERS: AnalyticsFilter[] = [];

function isFilter(v: unknown): v is AnalyticsFilter {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.field === "string" &&
    typeof f.operator === "string" &&
    (typeof f.value === "string" ||
      typeof f.value === "number" ||
      (Array.isArray(f.value) && f.value.every((x) => typeof x === "string")))
  );
}

/** `?f=[{"field":"service","operator":"eq","value":"api"}]` — JSON, because values may hold any character. */
const filtersCodec: UrlCodec<AnalyticsFilter[]> = {
  parse: (raw) => {
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) && v.every(isFilter) ? v : undefined;
    } catch {
      // Deliberately silent: a hand-edited or truncated URL reads as "no
      // filters", which is what the page then visibly shows.
      return undefined;
    }
  },
  serialize: (v) => (v.length > 0 ? JSON.stringify(v) : null),
};

// ── Explorer controls ───────────────────────────────────────────────────────

const AGGREGATIONS: { value: AggregationType; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "count_unique", label: "Count unique" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "p50", label: "p50" },
  { value: "p90", label: "p90" },
  { value: "p95", label: "p95" },
  { value: "p99", label: "p99" },
];
const AGGREGATION_VALUES = AGGREGATIONS.map((a) => a.value);

/** Top-level fields count_unique can read besides data.* keys. */
const UNIQUE_FIELDS = ["user_id", "service", "name", "env"];

const GROUP_FIELDS = [
  { value: "service", label: "Service" },
  { value: "name", label: "Event name" },
  { value: "level", label: "Level" },
  { value: "env", label: "Environment" },
];
const DATA_PREFIX = "data.";

const LIMITS = ["5", "10", "25", "100"] as const;

type ChartView = "lines" | "stacked" | "percent";
const VIEW_VALUES: ChartView[] = ["lines", "stacked", "percent"];
const VIEW_OPTIONS: SegmentedOption<ChartView>[] = [
  { value: "lines", label: "Lines", title: "One line per series" },
  { value: "stacked", label: "Stacked", title: "Each line is the running total of the series listed before it" },
  { value: "percent", label: "%", title: "Each series as a percentage of the bucket total" },
];

/**
 * Aggregations whose per-group values add up to the whole. Only these can be
 * stacked, shown as a share of the total, or have their tail folded into
 * "Other" — a stacked p95 is a number that means nothing.
 */
function isAdditive(agg: AggregationType): boolean {
  return agg === "count" || agg === "sum";
}

/** count/count_unique/sum: an empty bucket is a real 0. Everything else: a gap. */
function zeroFills(agg: AggregationType): boolean {
  return agg === "count" || agg === "count_unique" || agg === "sum";
}

function isValidGroup(g: string): boolean {
  return GROUP_FIELDS.some((f) => f.value === g) || (g.startsWith(DATA_PREFIX) && g.length > DATA_PREFIX.length);
}

function groupLabel(g: string): string {
  return GROUP_FIELDS.find((f) => f.value === g)?.label.toLowerCase() ?? g;
}

interface Measure {
  aggregation: AggregationType;
  field?: string;
}

function measureLabel(m: Measure): string {
  if (m.aggregation === "count") return "Events";
  const agg = AGGREGATIONS.find((a) => a.value === m.aggregation)?.label ?? m.aggregation;
  return `${agg} of ${m.field}`;
}

function formatterFor(m: Measure): (v: number) => string {
  // Latency fields are the common case; render them as durations, not raw counts.
  if (m.field?.endsWith("_ms") && m.aggregation !== "count" && m.aggregation !== "count_unique") {
    return formatDurationMs;
  }
  return formatCompactNumber;
}

const formatPercent = (v: number) => `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;

// ── Series shaping ──────────────────────────────────────────────────────────

/**
 * Keeps the `limit` largest series (by summed value). For additive measures the
 * rest are folded into one "Other" series so the totals still add up; for the
 * rest they are dropped — an "Other p95" would be invented.
 */
function capSeries(series: TimeSeriesSeries[], limit: number, additive: boolean): TimeSeriesSeries[] {
  if (series.length <= limit) return series;
  const total = (s: TimeSeriesSeries) => s.data_points.reduce((acc, p) => acc + (p.value || 0), 0);
  const sorted = [...series].sort((a, b) => total(b) - total(a));
  const kept = sorted.slice(0, limit);
  if (!additive) return kept;
  const other = new Map<string, number>();
  for (const s of sorted.slice(limit)) {
    for (const p of s.data_points) other.set(p.timestamp, (other.get(p.timestamp) ?? 0) + (p.value || 0));
  }
  const data_points = [...other.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([timestamp, value]) => ({ timestamp, value }));
  return [...kept, { name: `Other (${sorted.length - limit})`, data_points }];
}

/** Every timestamp any series has, in order. Missing points of an additive series are 0. */
function bucketTimestamps(series: TimeSeriesSeries[]): string[] {
  const set = new Set<string>();
  for (const s of series) for (const p of s.data_points) set.add(p.timestamp);
  return [...set].sort((a, b) => Date.parse(a) - Date.parse(b));
}

function shapeSeries(series: TimeSeriesSeries[], view: ChartView): ChartSeries[] {
  if (view === "lines" || series.length < 2) return series;
  const stamps = bucketTimestamps(series);
  const lookup = series.map((s) => new Map(s.data_points.map((p) => [p.timestamp, p.value || 0])));
  if (view === "stacked") {
    const running = new Map<string, number>();
    return series.map((s, i) => ({
      name: s.name,
      data_points: stamps.map((t) => {
        const v = (running.get(t) ?? 0) + (lookup[i].get(t) ?? 0);
        running.set(t, v);
        return { timestamp: t, value: v };
      }),
    }));
  }
  const totals = new Map(stamps.map((t) => [t, lookup.reduce((acc, m) => acc + (m.get(t) ?? 0), 0)]));
  return series.map((s, i) => ({
    name: s.name,
    data_points: stamps.map((t) => {
      const total = totals.get(t) ?? 0;
      // A bucket with nothing in it has no share — a gap, not 0%.
      return { timestamp: t, value: total > 0 ? ((lookup[i].get(t) ?? 0) / total) * 100 : null };
    }),
  }));
}

// ── Page data ───────────────────────────────────────────────────────────────

interface Comparison {
  current: number;
  previous: number;
  change: number;
  change_percent: number;
}

interface TopNBlock {
  group: string;
  data: TopNDataPoint[];
}

interface AnalyticsData {
  from: string;
  to: string;
  interval: TimeSeriesInterval;
  beyondRetention: boolean;
  measure: Measure;
  group: string;
  mainSeries: TimeSeriesSeries[];
  errorsSeries: TimeSeriesSeries[];
  eventsCompare: Comparison;
  errorsCompare: Comparison;
  uniqueUsers: number;
  topN: TopNBlock[];
}

const exportBtn =
  "px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const selectCls =
  "px-2 py-1.5 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[14rem]";

export default function AnalyticsPage() {
  const [selectedRange, setSelectedRange] = useUrlState("range", rangeCodec, {
    default: DEFAULT_RANGE,
    history: "push",
  });
  const [filters, setFilters] = useUrlState("f", filtersCodec, { default: NO_FILTERS });
  const [agg, setAgg] = useUrlState("agg", urlEnum(AGGREGATION_VALUES), { default: "count" });
  const [field, setField] = useUrlState("field", urlString, { default: "" });
  const [groupParam, setGroup] = useUrlState("group", urlString, { default: "" });
  const [limitParam, setLimit] = useUrlState("top", urlEnum(LIMITS), { default: "5" });
  const [mainView, setMainView] = useUrlState("view", urlEnum(VIEW_VALUES), { default: "lines" });
  const [errorsView, setErrorsView] = useUrlState("eview", urlEnum(VIEW_VALUES), { default: "lines" });

  const group = isValidGroup(groupParam) ? groupParam : "";
  const limit = Number(limitParam);
  const needsField = agg !== "count";
  // A measure that needs a field and has none queries a plain count — and is
  // titled as one — until a field is picked. Never "p95" over a count.
  const measure: Measure = useMemo(
    () => (needsField && field ? { aggregation: agg, field } : { aggregation: "count" }),
    [needsField, agg, field],
  );

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const queryKey = JSON.stringify([rangeToParam(selectedRange), filters, measure, group, limit]);

  const fetchAnalytics = useCallback(async () => {
    // Only the newest request writes state: a slow 30d answer must not land
    // over the 1h one the user switched to while it was running.
    const gen = ++generation.current;
    setLoading(true);

    const { from, to } = getTimeRange(selectedRange);
    const interval = getIntervalForRange(selectedRange);
    const beyondRetention = previousPeriodBeyondRetention(selectedRange);
    const errorFilters: AnalyticsFilter[] = [
      ...filters,
      { field: "level", operator: "eq", value: "error" },
    ];
    const groupBy = group ? [group] : undefined;
    // Every error is level=error, so grouping the errors chart by level is one line.
    const errorsGroupBy = group && group !== "level" ? [group] : undefined;
    const topGroups = ["service", "name", ...(group && group !== "service" && group !== "name" ? [group] : [])];

    try {
      const [mainRes, errorsRes, eventsCompareRes, errorsCompareRes, usersRes, ...topRes] =
        await Promise.all([
          getTimeSeries({
            ...measure,
            interval,
            from,
            to,
            fill_zeros: zeroFills(measure.aggregation),
            group_by: groupBy,
            filters,
          }),
          getTimeSeries({
            aggregation: "count",
            interval,
            from,
            to,
            fill_zeros: true,
            group_by: errorsGroupBy,
            filters: errorFilters,
          }),
          getCompare({ aggregation: "count", from, to, filters }),
          getCompare({ aggregation: "count", from, to, filters: errorFilters }),
          getGauge({ aggregation: "count_unique", field: "user_id", from, to, filters }),
          ...topGroups.map((g) =>
            getTopN({ ...measure, group_by: g, from, to, limit, filters }),
          ),
        ]);
      if (gen !== generation.current) return;

      // ⚠️ Restores the error state the old client produced by throwing. Without
      // this the catch below is unreachable for HTTP failures and a broken API
      // renders as an empty dashboard.
      const failed = firstError(mainRes, errorsRes, eventsCompareRes, errorsCompareRes, usersRes, ...topRes);
      if (failed || !eventsCompareRes.success || !errorsCompareRes.success) {
        setError(failed?.error_message || "Failed to fetch analytics");
        return;
      }

      setError(null);
      setData({
        from,
        to,
        interval,
        beyondRetention,
        measure,
        group,
        mainSeries: dataOf(mainRes)?.series || [],
        errorsSeries: dataOf(errorsRes)?.series || [],
        eventsCompare: eventsCompareRes.data,
        errorsCompare: errorsCompareRes.data,
        uniqueUsers: dataOf(usersRes)?.value || 0,
        topN: topRes.map((r, i) => ({ group: topGroups[i], data: dataOf(r)?.data || [] })),
      });
      setLoadedKey(queryKey);
    } catch (err) {
      if (gen !== generation.current) return;
      reportError("analytics.load.failed", err, {
        outcome: "analytics page shows its failure state",
      });
      setError(err instanceof Error ? err.message : "Failed to fetch analytics");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [selectedRange, filters, measure, group, limit, queryKey]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Skeletons only before the first answer. After that the previous numbers
  // stay on screen during a refresh (AutoRefresh every 10s used to blank all
  // eight cards every tick), with a progress bar — and dimmed only when the
  // question itself changed, so stale numbers never pass for the new query.
  const firstLoad = loading && !data;
  const stale = loading && !!data && loadedKey !== queryKey;

  // ── Data keys for the field / group-by selects (lazy) ──────────────────
  const [wantKeys, setWantKeys] = useState(false);
  const [dataKeys, setDataKeys] = useState<string[]>([]);
  const [dataKeysError, setDataKeysError] = useState<string | null>(null);
  const [dataKeysToken, setDataKeysToken] = useState(0);
  const keysWanted = wantKeys || needsField || group.startsWith(DATA_PREFIX);
  const keysWindow = suggestionWindow("keys", selectedRange);

  useEffect(() => {
    if (!keysWanted) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getDataKeys(undefined, { window: keysWindow });
        if (cancelled) return;
        if (!res.success) {
          setDataKeysError(res.error_message || "The request failed.");
          return;
        }
        setDataKeysError(null);
        setDataKeys(res.data ?? []);
      } catch (err) {
        reportError("analytics.data_keys.load.failed", err, {
          outcome: "explorer field selects show their failure note",
        });
        if (!cancelled) setDataKeysError("Failed to load data keys");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [keysWanted, keysWindow, dataKeysToken]);

  const dataFields = dataKeys.map((k) => DATA_PREFIX + k);
  const fieldOptions = withSelected(
    agg === "count_unique" ? [...UNIQUE_FIELDS, ...dataFields] : dataFields,
    field || null,
  );
  const groupOptions = withSelected(
    [...GROUP_FIELDS.map((g) => g.value), ...dataFields],
    group || null,
  );

  // ── Drill-through ──────────────────────────────────────────────────────
  const isActiveFilter = (g: string, key: string) =>
    filters.some((f) => f.field === g && f.operator === "eq" && f.value === key);
  const toggleDrill = (g: string, key: string) => {
    setFilters(
      isActiveFilter(g, key)
        ? filters.filter((f) => !(f.field === g && f.operator === "eq" && f.value === key))
        : [...filters, { field: g, operator: "eq", value: key }],
    );
  };

  const brush = (f: string, t: string) => {
    const r = customRange(f, t);
    if (r) setSelectedRange(r);
  };

  const resetExplorer = () => {
    setAgg("count");
    setField("");
    setGroup("");
    setLimit("5");
  };
  const explorerChanged = agg !== "count" || field !== "" || group !== "" || limitParam !== "5";

  const exportMeta = () =>
    data
      ? analyticsExportMeta({
          from: data.from,
          to: data.to,
          interval: data.interval,
          filters,
          range: rangeToParam(selectedRange),
        })
      : undefined;
  const fileName = (base: string) => exportFilename(base, rangeToParam(selectedRange));

  // ── Derived chart props ────────────────────────────────────────────────
  const shown = data;
  const mainAdditive = !!shown && isAdditive(shown.measure.aggregation);
  const mainCapped = shown ? capSeries(shown.mainSeries, limit, mainAdditive) : [];
  const mainViewable = mainAdditive && mainCapped.length > 1;
  const mainEffectiveView: ChartView = mainViewable ? mainView : "lines";
  const errorsCapped = shown ? capSeries(shown.errorsSeries, limit, true) : [];
  const errorsViewable = errorsCapped.length > 1;
  const errorsEffectiveView: ChartView = errorsViewable ? errorsView : "lines";
  const mainTitle = shown
    ? `${measureLabel(shown.measure)} over time${shown.group ? ` by ${groupLabel(shown.group)}` : ""}`
    : "Events over time";
  const errorsTitle =
    shown?.group && shown.group !== "level" ? `Errors over time by ${groupLabel(shown.group)}` : "Errors over time";
  const domain = shown ? { from: shown.from, to: shown.to } : undefined;
  const totalEvents = shown?.eventsCompare.current ?? 0;
  const totalErrors = shown?.errorsCompare.current ?? 0;
  const errorRate = totalEvents > 0 ? (totalErrors / totalEvents) * 100 : null;

  // Only offered where it means something: an additive measure split into
  // several series. Elsewhere it would be a row of buttons that change nothing.
  const viewSwitch = (viewable: boolean, value: ChartView, onChange: (v: ChartView) => void, name: string) =>
    viewable ? (
      <Segmented label={`${name} chart view`} options={VIEW_OPTIONS} value={value} onChange={onChange} />
    ) : null;

  return (
    <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
      <h1 className="sr-only">Analytics</h1>
      <div className="space-y-4 sm:space-y-6">
        {/* Filters and Controls */}
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <AnalyticsFilters filters={filters} onFiltersChange={setFilters} range={selectedRange} />
          <div className="flex flex-wrap items-center gap-2">
            <TimeRangePicker value={selectedRange} onChange={setSelectedRange} />
            <AutoRefresh onRefresh={fetchAnalytics} loading={loading} />
            <button
              onClick={fetchAnalytics}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
              aria-label="Refresh"
              title="Refresh"
            >
              <FontAwesomeIcon
                icon={loading ? faSpinner : faArrowsRotate}
                className={`text-sm ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Explorer: what to measure, how to split it, how many groups. */}
        <ExplorerBar onReset={explorerChanged ? resetExplorer : undefined}>
          <LabeledSelect label="Measure" value={agg} onChange={(v) => setAgg(v as AggregationType)}>
            {AGGREGATIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </LabeledSelect>
          {needsField && (
            <LabeledSelect
              label="of"
              value={field}
              onChange={setField}
              invalid={!field}
              describedBy={!field ? "analytics-field-hint" : undefined}
            >
              <option value="">Pick a field…</option>
              {fieldOptions.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </LabeledSelect>
          )}
          <LabeledSelect
            label="Group by"
            value={group}
            onChange={setGroup}
            onFocus={() => setWantKeys(true)}
          >
            <option value="">None</option>
            {groupOptions.map((g) => (
              <option key={g} value={g}>
                {GROUP_FIELDS.find((f) => f.value === g)?.label ?? g}
              </option>
            ))}
          </LabeledSelect>
          <LabeledSelect label="Top" value={limitParam} onChange={(v) => setLimit(v as (typeof LIMITS)[number])}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </LabeledSelect>
          {needsField && !field && (
            <p id="analytics-field-hint" className="text-xs text-amber-700 dark:text-amber-400">
              Pick a field to compute {AGGREGATIONS.find((a) => a.value === agg)?.label}. Showing counts until then.
            </p>
          )}
          {keysWanted && dataKeysError && (
            <FailureNote
              what="data fields"
              message={dataKeysError}
              onRetry={() => setDataKeysToken((t) => t + 1)}
            />
          )}
        </ExplorerBar>

        {/* DOWN, NOT EMPTY — and this is a branch for the same reason the
            errors and performance pages are. The banner used to render ABOVE
            the body below, which left the gauges reading a confident
            "Total Errors 0" underneath it. That zero was fabricated by the
            initial state. A failure and a result are mutually exclusive
            readings, so they are mutually exclusive branches. The filter and
            time-range controls stay above, because retrying is the point. */}
        {error ? (
          <FailureState what="analytics" message={error} onRetry={fetchAnalytics} />
        ) : (
          <div className="relative space-y-4 sm:space-y-6" aria-busy={loading}>
            {loading && data && (
              <div
                className="absolute -top-3 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950"
                role="progressbar"
                aria-label="Refreshing analytics"
              >
                <div className="h-full w-1/3 bg-blue-500 animate-pulse" />
              </div>
            )}
            <div className={`space-y-4 sm:space-y-6 transition-opacity ${stale ? "opacity-60" : ""}`}>
              {/* KPI row: each number appears once. Events and Errors carry
                  their own delta; the freed slots hold error rate and unique
                  users rather than repeating the same two totals. */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <CompareCard
                  title="Events"
                  current={totalEvents}
                  previous={shown?.eventsCompare.previous ?? 0}
                  changePercent={shown?.eventsCompare.change_percent ?? 0}
                  loading={firstLoad}
                  previousUnavailable={shown?.beyondRetention}
                  previousUnavailableReason={
                    shown?.beyondRetention ? "Previous period is past the 30-day retention" : undefined
                  }
                />
                <CompareCard
                  title="Errors"
                  current={totalErrors}
                  previous={shown?.errorsCompare.previous ?? 0}
                  changePercent={shown?.errorsCompare.change_percent ?? 0}
                  loading={firstLoad}
                  invertColors
                  previousUnavailable={shown?.beyondRetention}
                  previousUnavailableReason={
                    shown?.beyondRetention ? "Previous period is past the 30-day retention" : undefined
                  }
                />
                <RateCard
                  title="Error rate"
                  value={errorRate}
                  caption={errorRate === null ? "No events in this range" : "Errors ÷ events"}
                  loading={firstLoad}
                />
                <GaugeCard title="Unique users" value={shown?.uniqueUsers ?? 0} loading={firstLoad} />
              </div>

              {/* Time Series Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TimeSeriesChart
                  title={mainTitle}
                  seriesLabel={shown ? measureLabel(shown.measure) : "Events"}
                  series={shapeSeries(mainCapped, mainEffectiveView)}
                  loading={firstLoad}
                  color="blue"
                  interval={shown?.interval}
                  domain={domain}
                  partialBuckets="dashed"
                  allowLogScale={mainEffectiveView === "lines"}
                  formatValue={
                    mainEffectiveView === "percent" ? formatPercent : shown ? formatterFor(shown.measure) : undefined
                  }
                  onBrush={brush}
                  actions={
                    <div className="flex flex-wrap items-center gap-1">
                      {viewSwitch(mainViewable, mainView, setMainView, "Main")}
                      <button
                        className={exportBtn}
                        onClick={() =>
                          exportToCSV(seriesExportRows(shown?.mainSeries ?? [], "events"), fileName("events"), {
                            meta: exportMeta(),
                          })
                        }
                      >
                        CSV
                      </button>
                      <button
                        className={exportBtn}
                        onClick={() =>
                          exportToJSON(seriesExportRows(shown?.mainSeries ?? [], "events"), fileName("events"), {
                            meta: exportMeta(),
                          })
                        }
                      >
                        JSON
                      </button>
                    </div>
                  }
                />
                <TimeSeriesChart
                  title={errorsTitle}
                  seriesLabel="Errors"
                  series={shapeSeries(errorsCapped, errorsEffectiveView)}
                  loading={firstLoad}
                  color="red"
                  interval={shown?.interval}
                  domain={domain}
                  partialBuckets="dashed"
                  allowLogScale={errorsEffectiveView === "lines"}
                  formatValue={errorsEffectiveView === "percent" ? formatPercent : undefined}
                  onBrush={brush}
                  actions={
                    <div className="flex flex-wrap items-center gap-1">
                      {viewSwitch(errorsViewable, errorsView, setErrorsView, "Errors")}
                      <button
                        className={exportBtn}
                        onClick={() =>
                          exportToCSV(seriesExportRows(shown?.errorsSeries ?? [], "errors"), fileName("errors"), {
                            meta: exportMeta(),
                          })
                        }
                      >
                        CSV
                      </button>
                      <button
                        className={exportBtn}
                        onClick={() =>
                          exportToJSON(seriesExportRows(shown?.errorsSeries ?? [], "errors"), fileName("errors"), {
                            meta: exportMeta(),
                          })
                        }
                      >
                        JSON
                      </button>
                    </div>
                  }
                />
              </div>

              {/* Top N Lists — a row is a drill-through: it toggles that value
                  as a filter on the whole page. */}
              <div
                className={`grid grid-cols-1 gap-4 ${
                  (shown?.topN.length ?? 2) > 2 ? "lg:grid-cols-3" : "lg:grid-cols-2"
                }`}
              >
                {(shown?.topN ?? [{ group: "service", data: [] }, { group: "name", data: [] }]).map((block) => {
                  const m = shown?.measure ?? { aggregation: "count" as const };
                  const title = `Top ${block.group === "name" ? "event names" : `${groupLabel(block.group)}${block.group.startsWith(DATA_PREFIX) ? " values" : "s"}`}${
                    m.aggregation === "count" ? "" : ` by ${measureLabel(m)}`
                  }`;
                  return (
                    <DrillTopNList
                      key={block.group}
                      title={title}
                      group={block.group}
                      data={block.data}
                      loading={firstLoad}
                      total={m.aggregation === "count" ? totalEvents : undefined}
                      formatValue={formatterFor(m)}
                      isActive={(key) => isActiveFilter(block.group, key)}
                      onSelect={(key) => toggleDrill(block.group, key)}
                      actions={
                        <button
                          className={exportBtn}
                          onClick={() =>
                            exportToCSV(
                              block.data.map((d) => ({ key: d.key, value: d.value })),
                              fileName(`top-${block.group.replace(/\W+/g, "-")}`),
                              { meta: exportMeta() },
                            )
                          }
                        >
                          CSV
                        </button>
                      }
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ── Local components ────────────────────────────────────────────────────────

function ExplorerBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div
      role="group"
      aria-label="Query"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl"
    >
      {children}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <FontAwesomeIcon icon={faXmark} className="text-xs" aria-hidden />
          Reset query
        </button>
      )}
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  onFocus,
  invalid,
  describedBy,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  invalid?: boolean;
  describedBy?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onPointerEnter={onFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${selectCls} ${invalid ? "border-amber-500 dark:border-amber-500" : ""}`}
      >
        {children}
      </select>
    </div>
  );
}

function RateCard({
  title,
  value,
  caption,
  loading,
}: {
  title: string;
  value: number | null;
  caption: string;
  loading: boolean;
}) {
  return (
    <div className="relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500" />
      <div className="p-4 pt-5 space-y-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{title}</p>
        {loading ? (
          <div className="h-9 w-24 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
        ) : (
          <p className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {value === null ? "—" : value > 0 && value < 0.01 ? "<0.01%" : `${value < 10 ? value.toFixed(2) : value.toFixed(1)}%`}
          </p>
        )}
        {!loading && <p className="text-xs text-zinc-500 dark:text-zinc-400">{caption}</p>}
      </div>
    </div>
  );
}

/**
 * TopNList with clickable rows. Each row is a toggle button: pressing it adds
 * `group = key` to the page filters (and to the URL), pressing it again
 * removes it. Kept local because TopNList has no row action yet — see the
 * request to give it `onSelect`/`actions`, after which this folds back into it.
 */
function DrillTopNList({
  title,
  group,
  data,
  loading,
  total,
  formatValue,
  isActive,
  onSelect,
  actions,
}: {
  title: string;
  group: string;
  data: TopNDataPoint[];
  loading: boolean;
  total?: number;
  formatValue: (v: number) => string;
  isActive: (key: string) => boolean;
  onSelect: (key: string) => void;
  actions?: ReactNode;
}) {
  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 1;
  const name = groupLabel(group);
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate" title={title}>
          {title}
        </h3>
        {actions}
      </div>
      <div className="p-2">
        {loading ? (
          <div className="space-y-4 p-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
                  <div className="h-4 w-10 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                </div>
                <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-zinc-500 dark:text-zinc-400">
            No data in this range
          </div>
        ) : (
          <ul className="space-y-0.5">
            {data.map((item, index) => {
              const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
              const share = total && total > 0 ? (item.value / total) * 100 : null;
              const active = isActive(item.key);
              const label = item.key || "(empty)";
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(item.key)}
                    title={active ? `Remove filter ${name} = ${label}` : `Filter the page to ${name} = ${label}`}
                    className={`group/row w-full text-left space-y-1.5 px-2 py-1.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      active
                        ? "bg-blue-50 dark:bg-blue-950/40"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <span className="flex items-center justify-between text-sm gap-2">
                      <span className="text-zinc-700 dark:text-zinc-300 truncate">
                        <span className="sr-only">{active ? "Remove filter " : "Filter by "}{name}: </span>
                        <span className="text-zinc-500 dark:text-zinc-400 mr-1.5 tabular-nums" aria-hidden>{index + 1}.</span>
                        {label}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <FontAwesomeIcon
                          icon={active ? faXmark : faFilter}
                          className={`text-[10px] ${
                            active
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-zinc-400 opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
                          }`}
                          aria-hidden
                        />
                        {share !== null && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
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
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
