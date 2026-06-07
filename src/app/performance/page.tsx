"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faArrowsRotate,
    faChevronUp,
    faChevronDown,
    faArrowLeft,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import {
    AnalyticsFilter,
    AnalyticsDataPoint,
    TimeSeriesSeries,
} from "@/types";
import { getAnalytics, getTimeSeries, getLabelValues } from "@/services/api";
import { TimeSeriesChart } from "@/components/analytics/TimeSeriesChart";
import { TimeRange, TIME_RANGES, TIME_RANGE_LABELS, getTimeRange, getIntervalForRange } from "@/tools/timeRange.tools";

type SortField = "name" | "throughput" | "p50" | "p95" | "p99" | "errorRate";
type SortDir = "asc" | "desc";

interface EndpointRow {
    name: string;
    throughput: number;
    p50: number;
    p95: number;
    p99: number;
    errorRate: number;
}

function formatLatency(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
}

function errorRateClass(rate: number): string {
    if (rate > 5) return "text-red-600 dark:text-red-400";
    if (rate > 1) return "text-amber-600 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
}

export default function PerformancePage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedRange, setSelectedRange] = useState<TimeRange>(TIME_RANGES[2]);
    const [serviceFilter, setServiceFilter] = useState("");
    const [services, setServices] = useState<string[]>([]);
    const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
    const [sortField, setSortField] = useState<SortField>("throughput");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    // Drill-down
    const [drillEndpoint, setDrillEndpoint] = useState<string | null>(null);
    const [drillSeries, setDrillSeries] = useState<TimeSeriesSeries[]>([]);
    const [drillLoading, setDrillLoading] = useState(false);
    const [drillError, setDrillError] = useState<string | null>(null);

    useEffect(() => {
        getLabelValues("service")
            .then((res) => setServices(res.data || []))
            .catch(() => {});
    }, []);

    const fetchPerformance = useCallback(async () => {
        setLoading(true);
        setError(null);

        const { from, to } = getTimeRange(selectedRange);
        const baseFilters: AnalyticsFilter[] = serviceFilter
            ? [{ field: "service", operator: "eq", value: serviceFilter }]
            : [];

        try {
            const [countRes, p50Res, p95Res, p99Res, errorCountRes] = await Promise.all([
                getAnalytics({
                    aggregation: "count",
                    group_by: ["name"],
                    filters: baseFilters,
                    from,
                    to,
                    limit: 100,
                    order_by: "value",
                    order_desc: true,
                }),
                getAnalytics({
                    aggregation: "p50",
                    field: "data.duration_ms",
                    group_by: ["name"],
                    filters: baseFilters,
                    from,
                    to,
                    limit: 100,
                }),
                getAnalytics({
                    aggregation: "p95",
                    field: "data.duration_ms",
                    group_by: ["name"],
                    filters: baseFilters,
                    from,
                    to,
                    limit: 100,
                }),
                getAnalytics({
                    aggregation: "p99",
                    field: "data.duration_ms",
                    group_by: ["name"],
                    filters: baseFilters,
                    from,
                    to,
                    limit: 100,
                }),
                getAnalytics({
                    aggregation: "count",
                    group_by: ["name"],
                    filters: [
                        ...baseFilters,
                        { field: "level", operator: "eq", value: "error" },
                    ],
                    from,
                    to,
                    limit: 100,
                }),
            ]);

            // Build lookup maps
            const makeMap = (data: AnalyticsDataPoint[]) => {
                const map = new Map<string, number>();
                data.forEach((dp) => {
                    const key = dp.groups?.name || "";
                    map.set(key, dp.value);
                });
                return map;
            };

            const countMap = makeMap(countRes.data?.data || []);
            const p50Map = makeMap(p50Res.data?.data || []);
            const p95Map = makeMap(p95Res.data?.data || []);
            const p99Map = makeMap(p99Res.data?.data || []);
            const errorMap = makeMap(errorCountRes.data?.data || []);

            // Calculate time range in minutes for throughput
            const fromDate = new Date(from);
            const toDate = new Date(to);
            const rangeMinutes = (toDate.getTime() - fromDate.getTime()) / 60000;

            const rows: EndpointRow[] = [];
            countMap.forEach((count, name) => {
                const errors = errorMap.get(name) || 0;
                rows.push({
                    name,
                    throughput: rangeMinutes > 0 ? count / rangeMinutes : 0,
                    p50: p50Map.get(name) || 0,
                    p95: p95Map.get(name) || 0,
                    p99: p99Map.get(name) || 0,
                    errorRate: count > 0 ? (errors / count) * 100 : 0,
                });
            });

            setEndpoints(rows);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch performance data");
        } finally {
            setLoading(false);
        }
    }, [selectedRange, serviceFilter]);

    useEffect(() => {
        fetchPerformance();
    }, [fetchPerformance]);

    const handleDrill = useCallback(async (endpointName: string) => {
        setDrillEndpoint(endpointName);
        setDrillLoading(true);
        setDrillError(null);
        const { from, to } = getTimeRange(selectedRange);
        const interval = getIntervalForRange(selectedRange);
        const filters: AnalyticsFilter[] = [
            { field: "name", operator: "eq", value: endpointName },
            ...(serviceFilter ? [{ field: "service", operator: "eq", value: serviceFilter } as AnalyticsFilter] : []),
        ];
        try {
            const res = await getTimeSeries({
                aggregation: "count",
                interval,
                from,
                to,
                fill_zeros: true,
                filters,
            });
            setDrillSeries(res.data?.series || []);
        } catch {
            setDrillError("Failed to load time series data");
            setDrillSeries([]);
        } finally {
            setDrillLoading(false);
        }
    }, [selectedRange, serviceFilter]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDir("desc");
        }
    };

    const sortedEndpoints = [...endpoints].sort((a, b) => {
        const av = a[sortField] ?? 0;
        const bv = b[sortField] ?? 0;
        if (typeof av === "string" && typeof bv === "string") {
            return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return (
            <FontAwesomeIcon
                icon={sortDir === "asc" ? faChevronUp : faChevronDown}
                className="text-[10px] ml-1"
            />
        );
    };

    if (drillEndpoint) {
        return (
            <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
                <div className="space-y-4 sm:space-y-6">
                    <button
                        onClick={() => { setDrillEndpoint(null); setDrillSeries([]); }}
                        className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                    >
                        <FontAwesomeIcon icon={faArrowLeft} className="text-xs" />
                        Back to all endpoints
                    </button>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 break-all">
                        {drillEndpoint}
                    </h1>
                    {drillError && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                            <p className="text-sm text-red-600 dark:text-red-400">{drillError}</p>
                        </div>
                    )}
                    <TimeSeriesChart
                        title="Request Volume"
                        series={drillSeries}
                        loading={drillLoading}
                        color="blue"
                    />
                </div>
            </main>
        );
    }

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Performance
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Endpoint latency and throughput analysis.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={serviceFilter}
                            onChange={(e) => setServiceFilter(e.target.value)}
                            className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">All Services</option>
                            {services.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                            {TIME_RANGES.map((range) => (
                                <button
                                    key={range.label}
                                    onClick={() => setSelectedRange(range)}
                                    className={`px-3 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-zinc-200 dark:border-zinc-700 ${
                                        selectedRange.label === range.label
                                            ? "bg-blue-600 text-white"
                                            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                                    }`}
                                >
                                    {TIME_RANGE_LABELS[range.from] ?? range.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={fetchPerformance}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
                        >
                            <FontAwesomeIcon
                                icon={loading ? faSpinner : faArrowsRotate}
                                className={`text-sm ${loading ? "animate-spin" : ""}`}
                            />
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
                        <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                )}

                {/* Table */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                        </div>
                    ) : endpoints.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                            <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <p className="text-sm font-medium">No performance data</p>
                            <p className="text-xs mt-1">No events with duration data found in this time range.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                                        <th
                                            className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200"
                                            onClick={() => handleSort("name")}
                                        >
                                            Endpoint <SortIcon field="name" />
                                        </th>
                                        <th
                                            className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200"
                                            onClick={() => handleSort("throughput")}
                                        >
                                            Req/min <SortIcon field="throughput" />
                                        </th>
                                        <th
                                            className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200"
                                            onClick={() => handleSort("p50")}
                                        >
                                            P50 <SortIcon field="p50" />
                                        </th>
                                        <th
                                            className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200"
                                            onClick={() => handleSort("p95")}
                                        >
                                            P95 <SortIcon field="p95" />
                                        </th>
                                        <th
                                            className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200"
                                            onClick={() => handleSort("p99")}
                                        >
                                            P99 <SortIcon field="p99" />
                                        </th>
                                        <th
                                            className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200"
                                            onClick={() => handleSort("errorRate")}
                                        >
                                            Error Rate <SortIcon field="errorRate" />
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedEndpoints.map((row) => (
                                        <tr
                                            key={row.name}
                                            className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                                            onClick={() => handleDrill(row.name)}
                                        >
                                            <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-xs">
                                                {row.name}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                {row.throughput.toFixed(1)}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                {formatLatency(row.p50)}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                {formatLatency(row.p95)}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                {formatLatency(row.p99)}
                                            </td>
                                            <td className={`px-4 py-3 text-right tabular-nums font-medium ${errorRateClass(row.errorRate)}`}>
                                                {row.errorRate.toFixed(1)}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
