"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowsRotate,
    faChevronUp,
    faChevronDown,
    faChevronLeft,
    faChevronRight,
    faArrowLeft,
    faSort,
    faMagnifyingGlass,
} from "@fortawesome/free-solid-svg-icons";
import {
    AnalyticsFilter,
    AnalyticsDataPoint,
    TimeSeriesSeries,
} from "@/types";
import { getAnalytics, getTimeSeries, getLabelValues } from "@/services/api";
import { TimeSeriesChart, formatDurationMs } from "@/components/analytics/TimeSeriesChart";
import { TimeRangePicker } from "@/components/analytics/TimeRangePicker";
import { FailureState, FailureNote } from "@/components/FailureState";
import { Segmented } from "@/components/ui/segmented";
import { RefetchBar } from "@/components/ui/spinner";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { useUrlState, urlBool, urlEnum, urlString, type UrlCodec } from "@/hooks/useUrlState";
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

const SORT_FIELDS = ["name", "throughput", "p50", "p95", "p99", "errorRate", "deltaP95"] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortDir = "asc" | "desc";

/** The phone Sort select: every sort the table headers can produce, both directions. */
const MOBILE_SORTS: { field: SortField; dir: SortDir; label: string }[] = [
    { field: "throughput", dir: "desc", label: "Throughput (highest)" },
    { field: "throughput", dir: "asc", label: "Throughput (lowest)" },
    { field: "p50", dir: "desc", label: "P50 (slowest)" },
    { field: "p50", dir: "asc", label: "P50 (fastest)" },
    { field: "p95", dir: "desc", label: "P95 (slowest)" },
    { field: "p95", dir: "asc", label: "P95 (fastest)" },
    { field: "p99", dir: "desc", label: "P99 (slowest)" },
    { field: "p99", dir: "asc", label: "P99 (fastest)" },
    { field: "errorRate", dir: "desc", label: "Error rate (highest)" },
    { field: "errorRate", dir: "asc", label: "Error rate (lowest)" },
    { field: "deltaP95", dir: "desc", label: "Δ P95 (biggest regression)" },
    { field: "deltaP95", dir: "asc", label: "Δ P95 (biggest improvement)" },
    { field: "name", dir: "asc", label: "Name (A–Z)" },
    { field: "name", dir: "desc", label: "Name (Z–A)" },
];

/** The top N groups by volume make the rows. One more is asked for, to know whether there were more. */
const GROUP_LIMIT = 100;
/** Placeholder rows on the table's first load. */
const SKELETON_ROWS = 8;

/**
 * What counts as an error for the Error Rate column. `fatal` is a crash — leaving
 * it out understated the rate for exactly the events that matter most.
 */
const ERROR_LEVELS = ["error", "fatal"];

interface EndpointRow {
    name: string;
    count: number;
    /** Events per minute over the window. Sorts the same as count; formatted by formatRate. */
    throughput: number;
    /** Null when no event in the group carries data.duration_ms. */
    p50: number | null;
    p95: number | null;
    p99: number | null;
    errorRate: number;
    /** The same group over the preceding window of equal length, when Compare is on. */
    previous?: { count: number; p95: number | null };
}

/**
 * What a row is. "Event" groups by event name, which for HTTP services folds
 * every route into one `http.request.end` row; "Route" groups by `data.path`, which is
 * what "endpoint" means to the person reading the page.
 */
type GroupBy = "name" | "route";
const GROUP_FIELD: Record<GroupBy, string> = { name: "name", route: "data.path" };

/** `?range=24h` or `?range=<fromISO>..<toISO>`; anything else reads as the default. */
const rangeCodec: UrlCodec<TimeRange> = {
    parse: (raw) => rangeFromParam(raw) ?? undefined,
    serialize: rangeToParam,
};

function formatLatency(ms: number | null): string {
    // ClickHouse answers 0 for a percentile over a group with no duration at
    // all, so "0ms" used to sit beside every untimed event — job.queued and
    // cache.miss looked impossibly fast rather than unmeasured.
    if (ms === null) return "—";
    // The charts' formatter, so the table and the drill-down agree on units:
    // "1344.45s" now reads "22.4 m". Sub-ms keeps two decimals ("0.45 ms"); only
    // a value too small for those reads "<0.01 ms" rather than a false "0 ms".
    if (ms > 0 && ms < 0.005) return "<0.01 ms";
    return formatDurationMs(ms);
}

function twoSig(n: number): string {
    if (n >= 100) return Math.round(n).toLocaleString();
    return String(Number(n.toPrecision(2)));
}

/**
 * A rate in the unit that makes it readable. "Per min" with one decimal printed
 * 0.0 for nearly every row — four deploys a day and two hundred looked the same.
 */
function formatRate(perMinute: number): string {
    if (perMinute <= 0) return "0";
    if (perMinute >= 60) return `${twoSig(perMinute / 60)}/s`;
    if (perMinute >= 1) return `${twoSig(perMinute)}/min`;
    if (perMinute * 60 >= 1) return `${twoSig(perMinute * 60)}/h`;
    return `${twoSig(perMinute * 60 * 24)}/day`;
}

function errorRateClass(rate: number): string {
    if (rate > 5) return "text-red-600 dark:text-red-400";
    if (rate > 1) return "text-amber-700 dark:text-amber-400";
    // emerald-600 is 3.65:1 on white; 700 clears 4.5:1.
    return "text-emerald-700 dark:text-emerald-400";
}

/** Percent change, or null when there is nothing to compare against. */
function deltaPct(current: number | null, previous: number | null | undefined): number | null {
    if (current === null || previous === null || previous === undefined || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
}

function p95Delta(row: EndpointRow): number | null {
    return row.previous ? deltaPct(row.p95, row.previous.p95) : null;
}

/**
 * A ▲/▼ change badge. For latency up is bad (red); for throughput the
 * direction carries no verdict, so it stays neutral.
 */
function DeltaBadge({ pct, kind, isNew }: { pct: number | null; kind: "latency" | "volume"; isNew?: boolean }) {
    if (isNew) {
        return <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">new</span>;
    }
    if (pct === null) return null;
    const rounded = Math.round(pct);
    if (rounded === 0) {
        return <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">±0%</span>;
    }
    const up = rounded > 0;
    const tone =
        kind === "volume"
            ? "text-zinc-600 dark:text-zinc-300"
            : up
                ? "text-red-700 dark:text-red-400"
                : "text-emerald-700 dark:text-emerald-400";
    return (
        <span
            className={`block text-[11px] font-medium ${tone}`}
            title={`${up ? "+" : ""}${rounded.toLocaleString()}% vs the previous period`}
        >
            <span aria-hidden="true">{up ? "▲" : "▼"} </span>
            <span className="sr-only">{up ? "up" : "down"} </span>
            {/* "▲ 2773659%" is unreadable; past tenfold say how many times. */}
            {rounded >= 1000 ? `${twoSig(1 + pct / 100)}×` : `${Math.abs(rounded)}%`}
        </span>
    );
}

/** Moves a previous-period series onto the current window's x-axis, so the two overlay. */
function shiftSeries(series: TimeSeriesSeries[], byMs: number, name: string): TimeSeriesSeries[] {
    return series.map((s) => ({
        name,
        data_points: s.data_points.map((p) => ({
            ...p,
            timestamp: new Date(Date.parse(p.timestamp) + byMs).toISOString(),
        })),
    }));
}

/** What one drill-down request produced. Rendered only while its `key` is current. */
interface DrillResult {
    key: string;
    domain: { from: string; to: string };
    volume: TimeSeriesSeries[];
    volumeError: string | null;
    latency: TimeSeriesSeries[];
    latencyError: string | null;
    previousError: string | null;
    previousUnavailable: boolean;
}

export default function PerformancePage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [compareNote, setCompareNote] = useState<{ unavailable: boolean; error: string | null }>({
        unavailable: false,
        error: null,
    });
    const [services, setServices] = useState<string[]>([]);
    const [servicesError, setServicesError] = useState<string | null>(null);
    const [servicesToken, setServicesToken] = useState(0);

    // Everything a reload, Back or a pasted link should keep lives in the URL.
    const [selectedRange, setSelectedRange] = useUrlState("range", rangeCodec, { default: TIME_RANGES[2] });
    const [serviceFilter, setServiceFilter] = useUrlState("service", urlString, { default: "" });
    const [groupBy, setGroupBy] = useUrlState("group", urlEnum<GroupBy>(["name", "route"]), { default: "name" });
    const [sortField, setSortField] = useUrlState("sort", urlEnum<SortField>(SORT_FIELDS), { default: "throughput" });
    const [sortDir, setSortDir] = useUrlState("dir", urlEnum<SortDir>(["asc", "desc"]), { default: "desc" });
    // On by default: this is a latency page, and a table led by events that
    // carry no duration buries the ones that do.
    const [timedOnly, setTimedOnly] = useUrlState("timed", urlBool, { default: true });
    const [compare, setCompare] = useUrlState("compare", urlBool, { default: false });
    const [search, setSearch] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
    // ⚠️ PUSH, not replace: the drill-down is a place, so browser Back closes it.
    // It was React state, and Back left the Performance page entirely.
    const [drill, setDrill] = useUrlState("drill", urlString, { default: "", history: "push" });

    // The server-side search follows the box once typing pauses; the client-side
    // filter below follows every keystroke.
    const [debouncedSearch, setDebouncedSearch] = useState(search);
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    // ⚠️ A service dropdown with nothing in it is the exact ambiguity the scope
    // dimension introduced: "this project has no services" and "the project
    // selector is broken" are the same empty <select>. The failure has to say so.
    //
    // Read over the page's own range, so the dropdown offers the services that
    // have rows in the table it filters.
    const servicesWindow = suggestionWindow("labels", selectedRange);
    useEffect(() => {
        let cancelled = false;
        void getLabelValues("service", { window: servicesWindow }).then((res) => {
            // The range can change while this is in flight.
            if (cancelled) return;
            if (!res.success) {
                setServicesError(res.error_message || "The request failed.");
                return;
            }
            setServicesError(null);
            setServices(res.data);
        });
        return () => {
            cancelled = true;
        };
    }, [servicesToken, servicesWindow]);

    // Only the newest fetch writes state: a slow answer for the old range must
    // not land over a fast one for the new.
    const loadGen = useRef(0);

    const fetchPerformance = useCallback(async () => {
        const gen = ++loadGen.current;
        setLoading(true);
        setError(null);

        const { from, to } = getTimeRange(selectedRange);
        const baseFilters: AnalyticsFilter[] = serviceFilter
            ? [{ field: "service", operator: "eq", value: serviceFilter }]
            : [];
        const groupField = GROUP_FIELD[groupBy];
        // Server-side, so a route outside the top 100 by volume is still findable.
        const searchFilters: AnalyticsFilter[] = debouncedSearch
            ? [{ field: groupField, operator: "contains", value: debouncedSearch }]
            : [];
        const timedFilter: AnalyticsFilter = { field: "data.duration_ms", operator: "gte", value: "0" };
        // ⚠️ "Timed only" ranks on the SERVER. Applied client-side after the
        // top-100 cut, high-volume untimed events filled the 100 slots and a
        // timed group outside them vanished ("4 of 100 events, 96 hidden").
        const rankFilters: AnalyticsFilter[] = timedOnly ? [timedFilter] : [];

        try {
            // The rows are the top 100 groups by volume. Everything else is
            // asked about EXACTLY those groups, in a second round.
            //
            // ⚠️ Each aggregation used to take its own `limit: 100` — and the
            // percentile ones, with no order_by, came back sorted by value
            // ascending: the 100 FASTEST groups. With more than 100 routes, a
            // slow route was missing from p99 but present in p95, and the merge
            // below filled the gap with 0 — "P95 14ms, P99 0ms" for a route
            // whose real p99 was 332ms.
            const countRes = await getAnalytics({
                aggregation: "count",
                group_by: [groupField],
                filters: [...baseFilters, ...searchFilters, ...rankFilters],
                from,
                to,
                limit: GROUP_LIMIT + 1,
                order_by: "value",
                order_desc: true,
            });
            if (gen !== loadGen.current) return;
            // ⚠️ Restores the error state the old client produced by throwing.
            // validateStatus: () => true means the catch below is unreachable for
            // HTTP failures, so without this a broken API renders as an empty
            // performance page rather than an error.
            if (!countRes.success) {
                setError(countRes.error_message || "Failed to fetch performance data");
                return;
            }
            const allCounts = countRes.data?.data || [];
            // The extra row only says "there are more"; it is never shown.
            setTruncated(allCounts.length > GROUP_LIMIT);
            const countData = allCounts.slice(0, GROUP_LIMIT);
            // Route grouping puts every event without a path under "".
            const keys = countData
                .map((dp) => dp.groups?.[groupField] || "")
                .filter((k) => k !== "");
            if (keys.length === 0) {
                setEndpoints([]);
                setCompareNote({ unavailable: false, error: null });
                return;
            }
            const shown: AnalyticsFilter = { field: groupField, operator: "in", value: keys };
            const scoped = (extra: AnalyticsFilter[] = [], window = { from, to }) => ({
                group_by: [groupField],
                filters: [...baseFilters, shown, ...extra],
                from: window.from,
                to: window.to,
                limit: keys.length,
            });
            // Compare: the same groups over the window of equal length just
            // before this one. Past retention that window is partly or wholly
            // expired, so a "previous" from it would be a fake drop to zero.
            const rangeMs = Date.parse(to) - Date.parse(from);
            const previousUnavailable = compare && previousPeriodBeyondRetention(selectedRange);
            const prevWindow = { from: new Date(Date.parse(from) - rangeMs).toISOString(), to: from };
            const wantPrevious = compare && !previousUnavailable;

            const [p50Res, p95Res, p99Res, errorCountRes, companionRes, prevCountRes, prevP95Res, prevTimedRes] =
                await Promise.all([
                    getAnalytics({ aggregation: "p50", field: "data.duration_ms", ...scoped() }),
                    getAnalytics({ aggregation: "p95", field: "data.duration_ms", ...scoped() }),
                    getAnalytics({ aggregation: "p99", field: "data.duration_ms", ...scoped() }),
                    getAnalytics({
                        aggregation: "count",
                        ...scoped([{ field: "level", operator: "in", value: ERROR_LEVELS }]),
                    }),
                    // The count round 1 did not take. Normally: which groups carry a
                    // duration at all — the only way to tell a real 0ms from
                    // ClickHouse's 0 for "no values". Under "Timed only" round 1
                    // counted timed events, so this is the ALL-events count that
                    // throughput and error rate are measured against.
                    getAnalytics({ aggregation: "count", ...scoped(timedOnly ? [] : [timedFilter]) }),
                    wantPrevious ? getAnalytics({ aggregation: "count", ...scoped([], prevWindow) }) : null,
                    wantPrevious
                        ? getAnalytics({ aggregation: "p95", field: "data.duration_ms", ...scoped([], prevWindow) })
                        : null,
                    wantPrevious ? getAnalytics({ aggregation: "count", ...scoped([timedFilter], prevWindow) }) : null,
                ]);
            if (gen !== loadGen.current) return;

            const failed = firstError(p50Res, p95Res, p99Res, errorCountRes, companionRes);
            if (failed) {
                setError(failed.error_message || "Failed to fetch performance data");
                return;
            }
            // The comparison is supporting detail: its failure leaves the table
            // up and says so beside it.
            const prevFailed =
                wantPrevious && prevCountRes && prevP95Res && prevTimedRes
                    ? firstError(prevCountRes, prevP95Res, prevTimedRes)
                    : null;
            setCompareNote({
                unavailable: previousUnavailable,
                error: prevFailed ? prevFailed.error_message || "The request failed." : null,
            });

            // Build lookup maps
            const makeMap = (data: AnalyticsDataPoint[]) => {
                const map = new Map<string, number>();
                data.forEach((dp) => {
                    const key = dp.groups?.[groupField] || "";
                    map.set(key, dp.value);
                });
                return map;
            };

            const roundOneMap = makeMap(countData);
            const companionMap = makeMap(dataOf(companionRes)?.data || []);
            const countMap = timedOnly ? companionMap : roundOneMap;
            const timedMap = timedOnly ? roundOneMap : companionMap;
            const p50Map = makeMap(dataOf(p50Res)?.data || []);
            const p95Map = makeMap(dataOf(p95Res)?.data || []);
            const p99Map = makeMap(dataOf(p99Res)?.data || []);
            const errorMap = makeMap(dataOf(errorCountRes)?.data || []);
            const havePrevious = wantPrevious && !prevFailed;
            const prevCountMap = makeMap(havePrevious && prevCountRes ? dataOf(prevCountRes)?.data || [] : []);
            const prevP95Map = makeMap(havePrevious && prevP95Res ? dataOf(prevP95Res)?.data || [] : []);
            const prevTimedMap = makeMap(havePrevious && prevTimedRes ? dataOf(prevTimedRes)?.data || [] : []);

            const rangeMinutes = rangeMs / 60000;

            const rows: EndpointRow[] = [];
            roundOneMap.forEach((roundOneCount, name) => {
                // Route grouping puts every event without a path under "".
                if (!name) return;
                const count = countMap.get(name) ?? roundOneCount;
                // Every query above covers exactly these groups, so a group
                // absent from the error or timed count genuinely has none.
                const errors = errorMap.get(name) || 0;
                const timed = (timedMap.get(name) || 0) > 0;
                const prevTimed = (prevTimedMap.get(name) || 0) > 0;
                // A missing percentile is unknown, never 0ms: render "—".
                rows.push({
                    name,
                    count,
                    throughput: rangeMinutes > 0 ? count / rangeMinutes : 0,
                    p50: timed ? p50Map.get(name) ?? null : null,
                    p95: timed ? p95Map.get(name) ?? null : null,
                    p99: timed ? p99Map.get(name) ?? null : null,
                    errorRate: count > 0 ? (errors / count) * 100 : 0,
                    previous: havePrevious
                        ? {
                              count: prevCountMap.get(name) || 0,
                              p95: prevTimed ? prevP95Map.get(name) ?? null : null,
                          }
                        : undefined,
                });
            });

            setEndpoints(rows);
        } catch (err) {
            if (gen !== loadGen.current) return;
            reportError("performance.load.failed", err, {
                range: rangeToParam(selectedRange),
                outcome: "performance page shows its failure state",
            });
            setError(err instanceof Error ? err.message : "Failed to fetch performance data");
        } finally {
            if (gen === loadGen.current) setLoading(false);
        }
    }, [selectedRange, serviceFilter, groupBy, debouncedSearch, compare, timedOnly]);

    useEffect(() => {
        fetchPerformance();
    }, [fetchPerformance]);

    // ── Drill-down ──────────────────────────────────────────────────────────
    //
    // Keyed, not flagged: a result renders only while its key matches what is
    // being asked for, so switching rows or ranges can never show the previous
    // row's series under the new name, and nothing has to remember to clear it.
    const [drillToken, setDrillToken] = useState(0);
    const [drillResult, setDrillResult] = useState<DrillResult | null>(null);
    const drillKey = drill
        ? JSON.stringify([drill, rangeToParam(selectedRange), serviceFilter, groupBy, compare, drillToken])
        : null;

    useEffect(() => {
        if (!drill || !drillKey) return;
        let cancelled = false;
        const { from, to } = getTimeRange(selectedRange);
        const interval = getIntervalForRange(selectedRange);
        const filters: AnalyticsFilter[] = [
            { field: GROUP_FIELD[groupBy], operator: "eq", value: drill },
            ...(serviceFilter ? [{ field: "service", operator: "eq", value: serviceFilter } as AnalyticsFilter] : []),
        ];
        const rangeMs = Date.parse(to) - Date.parse(from);
        const previousUnavailable = compare && previousPeriodBeyondRetention(selectedRange);
        const wantPrevious = compare && !previousUnavailable;
        const prevFrom = new Date(Date.parse(from) - rangeMs).toISOString();

        // Counts: an empty bucket really is zero. Percentiles: an empty bucket is
        // NO DATA — fill_zeros drew every quiet hour as a 0ms P95, a sawtooth
        // from 78s to nothing that never happened.
        const volumeQuery = (f: string, t: string) =>
            getTimeSeries({ aggregation: "count", interval, from: f, to: t, fill_zeros: true, filters });
        const latencyQuery = (f: string, t: string) =>
            getTimeSeries({
                aggregation: "p95",
                field: "data.duration_ms",
                interval,
                from: f,
                to: t,
                fill_zeros: false,
                filters,
            });

        void (async () => {
            try {
                const [volumeRes, latencyRes, prevVolumeRes, prevLatencyRes] = await Promise.all([
                    volumeQuery(from, to),
                    latencyQuery(from, to),
                    wantPrevious ? volumeQuery(prevFrom, from) : null,
                    wantPrevious ? latencyQuery(prevFrom, from) : null,
                ]);
                if (cancelled) return;
                const prevFailed =
                    prevVolumeRes && prevLatencyRes ? firstError(prevVolumeRes, prevLatencyRes) : null;
                const label = (s: TimeSeriesSeries[]) =>
                    wantPrevious && !prevFailed ? s.map((x) => ({ ...x, name: "This period" })) : s;
                const ghost = (res: typeof prevVolumeRes) =>
                    wantPrevious && !prevFailed && res?.success
                        ? shiftSeries(res.data?.series || [], rangeMs, "Previous period")
                        : [];
                // Each chart fails on its own: a failed latency read used to draw
                // an empty "P95 latency" chart — no data, rather than no answer.
                setDrillResult({
                    key: drillKey,
                    domain: { from, to },
                    volume: volumeRes.success
                        ? [...label(volumeRes.data?.series || []), ...ghost(prevVolumeRes)]
                        : [],
                    volumeError: volumeRes.success ? null : volumeRes.error_message || "The request failed.",
                    latency: latencyRes.success
                        ? [...label(latencyRes.data?.series || []), ...ghost(prevLatencyRes)]
                        : [],
                    latencyError: latencyRes.success ? null : latencyRes.error_message || "The request failed.",
                    previousError: prevFailed ? prevFailed.error_message || "The request failed." : null,
                    previousUnavailable,
                });
            } catch (err) {
                if (cancelled) return;
                reportError("performance.drilldown.load.failed", err, {
                    group_by: groupBy,
                    outcome: "drill-down charts show their failure state",
                });
                const message = err instanceof Error ? err.message : "Failed to load time series data";
                setDrillResult({
                    key: drillKey,
                    domain: { from, to },
                    volume: [],
                    volumeError: message,
                    latency: [],
                    latencyError: message,
                    previousError: null,
                    previousUnavailable,
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [drill, drillKey, selectedRange, serviceFilter, groupBy, compare]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDir(field === "name" ? "asc" : "desc");
        }
    };

    const needle = search.trim().toLowerCase();
    const timedEndpoints = timedOnly ? endpoints.filter((e) => e.p50 !== null) : endpoints;
    const visibleEndpoints = needle
        ? timedEndpoints.filter((e) => e.name.toLowerCase().includes(needle))
        : timedEndpoints;
    const sortValue = (row: EndpointRow): number | string | null =>
        sortField === "deltaP95" ? p95Delta(row) : row[sortField];
    const sortedEndpoints = [...visibleEndpoints].sort((a, b) => {
        const av = sortValue(a);
        const bv = sortValue(b);
        if (typeof av === "string" && typeof bv === "string") {
            return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        // Unknowns (untimed, nothing to compare against) sort last either way.
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    const showCompare = compare && endpoints.some((e) => e.previous);

    const groupNoun = groupBy === "route" ? "route" : "event";
    const groupNounPlural = groupBy === "route" ? "routes" : "events";

    // ── Shared controls ─────────────────────────────────────────────────────

    const serviceSelect = (
        <>
            {servicesError ? (
                <FailureNote
                    what="the service list"
                    message={servicesError}
                    onRetry={() => setServicesToken((t) => t + 1)}
                />
            ) : null}
            <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                aria-label="Service"
                className="px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
                <option value="">All Services</option>
                {/* The service picked at a wider range can have no
                    rows in this one; withSelected keeps it showing. */}
                {withSelected(services, serviceFilter).map((s) => (
                    <option key={s} value={s}>{s}</option>
                ))}
            </select>
        </>
    );

    const compareToggle = (
        <label
            className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 px-1"
            title="Show the change from the preceding window of the same length"
        >
            <input
                type="checkbox"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
                className="h-3.5 w-3.5 accent-blue-600"
            />
            Compare to previous
        </label>
    );

    const rangePicker = <TimeRangePicker value={selectedRange} onChange={setSelectedRange} />;

    const refreshButton = (onClick: () => void, busy: boolean) => (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-label="Refresh"
            title="Refresh"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
        >
            <FontAwesomeIcon icon={faArrowsRotate} spin={busy} className="text-sm" />
        </button>
    );

    const compareMessage = compareNote.unavailable ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The previous period is past the 30-day event retention, so there is nothing to compare against.
        </p>
    ) : compareNote.error ? (
        <FailureNote what="the previous period" message={compareNote.error} onRetry={fetchPerformance} />
    ) : null;

    // ── Drill-down view ─────────────────────────────────────────────────────

    if (drill) {
        const result = drillResult && drillResult.key === drillKey ? drillResult : null;
        const drillLoading = result === null;
        const interval = getIntervalForRange(selectedRange);
        const row = endpoints.find((e) => e.name === drill) ?? null;
        const index = sortedEndpoints.findIndex((e) => e.name === drill);
        const prevRow = index > 0 ? sortedEndpoints[index - 1] : null;
        const nextRow = index >= 0 && index < sortedEndpoints.length - 1 ? sortedEndpoints[index + 1] : null;
        const onBrush = (f: string, t: string) => {
            const r = customRange(f, t);
            if (r) setSelectedRange(r);
        };

        const stats: { label: string; value: string; delta?: ReactNode; tone?: string }[] = row
            ? [
                  {
                      label: "Throughput",
                      value: formatRate(row.throughput),
                      delta: row.previous ? (
                          <DeltaBadge
                              kind="volume"
                              pct={deltaPct(row.count, row.previous.count)}
                              isNew={row.previous.count === 0}
                          />
                      ) : undefined,
                  },
                  { label: "Events", value: row.count.toLocaleString() },
                  { label: "P50", value: formatLatency(row.p50) },
                  {
                      label: "P95",
                      value: formatLatency(row.p95),
                      delta: row.previous ? <DeltaBadge kind="latency" pct={p95Delta(row)} /> : undefined,
                  },
                  { label: "P99", value: formatLatency(row.p99) },
                  {
                      label: "Error rate",
                      value: `${row.errorRate.toFixed(1)}%`,
                      tone: row.errorRate === 0 ? undefined : errorRateClass(row.errorRate),
                  },
              ]
            : [];

        const chartCard = (what: string, message: string | null, chart: ReactNode) =>
            message ? (
                <FailureState what={what} message={message} onRetry={() => setDrillToken((t) => t + 1)} />
            ) : (
                chart
            );

        return (
            <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
                <div className="space-y-4 sm:space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => setDrill("")}
                            className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                        >
                            <FontAwesomeIcon icon={faArrowLeft} className="text-xs" />
                            Back to all {groupNounPlural}
                        </button>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => prevRow && setDrill(prevRow.name)}
                                disabled={!prevRow}
                                aria-label={prevRow ? `Previous ${groupNoun}: ${prevRow.name}` : `Previous ${groupNoun}`}
                                title={prevRow ? `Previous: ${prevRow.name}` : `Previous ${groupNoun}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                            >
                                <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
                            </button>
                            {index >= 0 && (
                                <span className="px-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                                    {index + 1} of {sortedEndpoints.length}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => nextRow && setDrill(nextRow.name)}
                                disabled={!nextRow}
                                aria-label={nextRow ? `Next ${groupNoun}: ${nextRow.name}` : `Next ${groupNoun}`}
                                title={nextRow ? `Next: ${nextRow.name}` : `Next ${groupNoun}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                            >
                                <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                        <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                Performance · {groupNoun}
                            </p>
                            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 break-all">
                                {drill}
                            </h1>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {serviceSelect}
                            {compareToggle}
                            {rangePicker}
                            {refreshButton(() => {
                                setDrillToken((t) => t + 1);
                                void fetchPerformance();
                            }, drillLoading)}
                        </div>
                    </div>

                    {/* The row's numbers, from the table already in memory. */}
                    {error ? (
                        <FailureNote what="the summary numbers" message={error} onRetry={fetchPerformance} />
                    ) : loading && !row ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading summary…</p>
                    ) : row ? (
                        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200 dark:bg-zinc-800">
                            {stats.map((s) => (
                                <div key={s.label} className="bg-white dark:bg-zinc-900 px-4 py-3">
                                    <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                        {s.label}
                                    </dt>
                                    <dd className={`mt-1 text-lg font-semibold tabular-nums ${s.tone ?? "text-zinc-900 dark:text-zinc-100"}`}>
                                        {s.value}
                                        {s.delta}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            This {groupNoun} isn’t among the top {GROUP_LIMIT} by volume in this range, so there are no
                            summary numbers for it. The charts below still cover it.
                        </p>
                    )}

                    {result?.previousUnavailable ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            The previous period is past the 30-day event retention, so there is nothing to compare against.
                        </p>
                    ) : result?.previousError ? (
                        <FailureNote
                            what="the previous period"
                            message={result.previousError}
                            onRetry={() => setDrillToken((t) => t + 1)}
                        />
                    ) : null}

                    <div className="grid gap-4 lg:grid-cols-2">
                        {chartCard(
                            "the request volume",
                            result?.volumeError ?? null,
                            <TimeSeriesChart
                                title="Volume"
                                series={result?.volume ?? []}
                                loading={drillLoading}
                                color="blue"
                                interval={interval}
                                domain={result?.domain}
                                partialBuckets="dashed"
                                emptyBuckets="zero"
                                seriesLabel="Events"
                                onBrush={onBrush}
                            />,
                        )}
                        {chartCard(
                            "the P95 latency",
                            result?.latencyError ?? null,
                            <TimeSeriesChart
                                title="P95 latency"
                                series={result?.latency ?? []}
                                loading={drillLoading}
                                color="amber"
                                interval={interval}
                                domain={result?.domain}
                                partialBuckets="dashed"
                                formatValue={formatDurationMs}
                                seriesLabel="P95 latency"
                                onBrush={onBrush}
                            />,
                        )}
                    </div>
                </div>
            </main>
        );
    }

    // ── Table view ──────────────────────────────────────────────────────────

    const sortHeader = (field: SortField, label: string, opts: { align?: "left" | "right"; title?: string } = {}) => {
        const active = sortField === field;
        const align = opts.align ?? "right";
        return (
            <th
                scope="col"
                aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                className={`px-4 py-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap ${
                    align === "right" ? "text-right" : "text-left"
                }`}
            >
                <button
                    type="button"
                    onClick={() => handleSort(field)}
                    title={opts.title ? `${opts.title} — sort` : `Sort by ${label}`}
                    className="group inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-zinc-800 dark:hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                    {label}
                    <FontAwesomeIcon
                        aria-hidden="true"
                        icon={active ? (sortDir === "asc" ? faChevronUp : faChevronDown) : faSort}
                        className={`text-[10px] ${active ? "" : "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60"}`}
                    />
                </button>
            </th>
        );
    };

    // Shared by the loaded table and its first-load skeleton, so the two have
    // the same columns (Δ P95 appears only with Compare on).
    const tableColumns = showCompare ? 7 : 6;
    const tableHead = (
        <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                {sortHeader("name", groupBy === "route" ? "Route" : "Event", { align: "left" })}
                {sortHeader("throughput", "Throughput", { title: "Events in the window, as a rate" })}
                {sortHeader("p50", "P50")}
                {sortHeader("p95", "P95")}
                {showCompare && sortHeader("deltaP95", "Δ P95", { title: "P95 change from the previous period" })}
                {sortHeader("p99", "P99")}
                {sortHeader("errorRate", "Error Rate", { title: "Share of events at level error or fatal" })}
            </tr>
        </thead>
    );

    const throughputCell = (row: EndpointRow) => (
        <>
            <span className="text-zinc-700 dark:text-zinc-300">{formatRate(row.throughput)}</span>
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                {row.count.toLocaleString()} event{row.count === 1 ? "" : "s"}
            </span>
            {row.previous ? (
                <DeltaBadge
                    kind="volume"
                    pct={deltaPct(row.count, row.previous.count)}
                    isNew={row.previous.count === 0}
                />
            ) : null}
        </>
    );

    const errorRateText = (row: EndpointRow) => (
        <span className={row.errorRate === 0 ? "text-zinc-500 dark:text-zinc-400" : `font-medium ${errorRateClass(row.errorRate)}`}>
            {row.errorRate.toFixed(1)}%
        </span>
    );

    const hiddenUntimed = endpoints.length - timedEndpoints.length;
    // The empty state names the service filter, or "No events" reads as an empty zone.
    const inService = serviceFilter ? ` from ${serviceFilter}` : "";

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                {/* Header */}
                <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Performance
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Latency percentiles from <code className="text-xs">data.duration_ms</code>, throughput and error rate.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                            label="Group rows by"
                            options={[
                                { value: "name", label: "By event" },
                                { value: "route", label: "By route" },
                            ]}
                            value={groupBy}
                            onChange={setGroupBy}
                        />
                        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 px-1">
                            <input
                                type="checkbox"
                                checked={timedOnly}
                                onChange={(e) => setTimedOnly(e.target.checked)}
                                className="h-3.5 w-3.5 accent-blue-600"
                            />
                            Timed only
                        </label>
                        {compareToggle}
                        {serviceSelect}
                        {rangePicker}
                        {refreshButton(() => void fetchPerformance(), loading)}
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
                    <div className="relative w-full sm:max-w-sm">
                        <label htmlFor="performance-search" className="sr-only">
                            Search {groupNounPlural}
                        </label>
                        <FontAwesomeIcon
                            icon={faMagnifyingGlass}
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400"
                        />
                        <input
                            id="performance-search"
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search ${groupNounPlural}…`}
                            className="w-full pl-8 pr-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    {/* Phones get cards, not table headers, so sorting needs its own control. */}
                    <div className="flex items-center gap-2 sm:hidden">
                        <label htmlFor="performance-sort" className="text-xs text-zinc-600 dark:text-zinc-400">
                            Sort by
                        </label>
                        <select
                            id="performance-sort"
                            value={`${sortField}:${sortDir}`}
                            onChange={(e) => {
                                const [f, d] = e.target.value.split(":") as [SortField, SortDir];
                                setSortField(f);
                                setSortDir(d);
                            }}
                            className="flex-1 px-3 py-2 text-base bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300"
                        >
                            {/* ⚠️ Every field × direction the headers (and the URL) can
                                set has an option. With six, ?sort=p50 or any asc order
                                matched none and the select DISPLAYED "Throughput
                                (highest)" over cards sorted by something else. */}
                            {MOBILE_SORTS.filter(
                                (o) => o.field !== "deltaP95" || showCompare || sortField === "deltaP95",
                            ).map((o) => (
                                <option key={`${o.field}:${o.dir}`} value={`${o.field}:${o.dir}`}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {compareMessage}

                {/* Table */}
                <div className="relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                    {/* A refetch keeps the rows (dimmed below) and shows this bar;
                        only the first load gets the skeleton. */}
                    <RefetchBar active={loading && endpoints.length > 0} className="absolute inset-x-0 top-0 z-10" />
                    {loading && endpoints.length === 0 ? (
                        /* First load: the REAL header over placeholder rows the
                           height of a loaded row (py-3 + a 20px line + border),
                           as <td>s rather than SkeletonTable's divs so each bar
                           sits under its own column. min-h holds the box at the
                           skeleton's height whichever answer replaces it. */
                        <div className="min-h-[24rem]">
                            <SkeletonRows rows={4} label={`Loading ${groupNounPlural}`} leading={false} rowClass="h-[112px]" className="sm:hidden" />
                            <div className="hidden sm:block overflow-x-auto" role="status" aria-label={`Loading ${groupNounPlural}`}>
                                <table className="w-full text-sm">
                                    {tableHead}
                                    <tbody>
                                        {Array.from({ length: SKELETON_ROWS }, (_, r) => (
                                            <tr key={r} className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
                                                {Array.from({ length: tableColumns }, (_, c) => (
                                                    <td key={c} className="px-4 py-3">
                                                        <div className={`flex h-5 items-center ${c === 0 ? "" : "justify-end"}`}>
                                                            <Skeleton
                                                                className="h-3"
                                                                style={{ width: c === 0 ? `${[62, 45, 78, 55, 70, 50, 66, 40][r % 8]}%` : "3rem" }}
                                                            />
                                                        </div>
                                                        {/* Throughput carries a second "N events" line,
                                                            which is what sets a loaded row's height. */}
                                                        {c === 1 && (
                                                            <div className="flex h-4 items-center justify-end">
                                                                <Skeleton className="h-2.5 w-16 bg-zinc-100 dark:bg-zinc-800/60" />
                                                            </div>
                                                        )}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : error ? (
                        /* DOWN, NOT EMPTY. firstError already caught the failure
                           above, but the banner rendered ABOVE the table while
                           the table still printed "No performance data — no
                           events with duration data found in this time range".
                           A caught error the layout then contradicts is not a
                           caught error. */
                        <FailureState
                            what="performance data"
                            message={error}
                            onRetry={fetchPerformance}
                            className="rounded-none border-0"
                        />
                    ) : sortedEndpoints.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-zinc-500 dark:text-zinc-400">
                            <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <p className="text-sm font-medium">
                                {needle ? `No ${groupNounPlural} match “${search.trim()}”` : "No performance data"}
                            </p>
                            <p className="text-xs mt-1">
                                {needle
                                    ? timedOnly && hiddenUntimed > 0
                                        ? "Untick “Timed only” to include groups without data.duration_ms."
                                        : "Try a shorter search or a wider time range."
                                    : timedOnly && endpoints.length > 0
                                        ? `${endpoints.length} event group${endpoints.length === 1 ? "" : "s"}${inService} in this range, none carrying data.duration_ms. Untick “Timed only” to see them.`
                                        : timedOnly
                                            ? `No events with data.duration_ms${groupBy === "route" ? " and a data.path" : ""}${inService} in this time range. Untick “Timed only” to include untimed events.`
                                            : groupBy === "route"
                                                ? `No events with a data.path${inService} in this time range.`
                                                : `No events${inService} in this time range.`}
                            </p>
                        </div>
                    ) : (
                        <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
                            {/* Phones: one card per row. The table put P95, P99 and
                                the error rate behind an unmarked sideways scroll. */}
                            <ul className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                                {sortedEndpoints.map((row) => (
                                    <li key={row.name}>
                                        <button
                                            type="button"
                                            onClick={() => setDrill(row.name)}
                                            className="w-full px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                                        >
                                            <span className="block font-medium text-sm text-zinc-900 dark:text-zinc-100 break-all">
                                                {row.name}
                                            </span>
                                            <span className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
                                                <span>
                                                    <span className="block text-zinc-500 dark:text-zinc-400">P95</span>
                                                    <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {formatLatency(row.p95)}
                                                    </span>
                                                    {row.previous ? <DeltaBadge kind="latency" pct={p95Delta(row)} /> : null}
                                                </span>
                                                <span>
                                                    <span className="block text-zinc-500 dark:text-zinc-400">Throughput</span>
                                                    {throughputCell(row)}
                                                </span>
                                                <span>
                                                    <span className="block text-zinc-500 dark:text-zinc-400">Errors</span>
                                                    {errorRateText(row)}
                                                </span>
                                            </span>
                                            <span className="mt-1 block text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                                                P50 {formatLatency(row.p50)} · P99 {formatLatency(row.p99)}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full text-sm">
                                    {tableHead}
                                    <tbody>
                                        {sortedEndpoints.map((row) => (
                                            <tr
                                                key={row.name}
                                                // The whole row opens the drill-down; the name
                                                // button below is the keyboard target for it.
                                                onClick={() => setDrill(row.name)}
                                                className="cursor-pointer border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-md">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDrill(row.name);
                                                        }}
                                                        className="max-w-full truncate text-left rounded hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                                        title={row.name}
                                                    >
                                                        {row.name}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                                                    {throughputCell(row)}
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                    {formatLatency(row.p50)}
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                    {formatLatency(row.p95)}
                                                </td>
                                                {showCompare && (
                                                    <td className="px-4 py-3 text-right tabular-nums">
                                                        {row.previous ? (
                                                            p95Delta(row) === null ? (
                                                                <span className="text-zinc-500 dark:text-zinc-400" title="No timed events in the previous period">—</span>
                                                            ) : (
                                                                <DeltaBadge kind="latency" pct={p95Delta(row)} />
                                                            )
                                                        ) : null}
                                                    </td>
                                                )}
                                                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                    {formatLatency(row.p99)}
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums">
                                                    {errorRateText(row)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                                Showing {sortedEndpoints.length} of {endpoints.length} {groupNounPlural}
                                {timedOnly && hiddenUntimed > 0 ? ` (${hiddenUntimed} without data.duration_ms hidden)` : ""}.
                                {truncated
                                    ? ` Only the top ${GROUP_LIMIT}${timedOnly ? " timed" : ""} by volume are loaded — more exist in this range. Search or pick a service to reach the rest.`
                                    : ""}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
