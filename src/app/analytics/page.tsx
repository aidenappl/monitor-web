"use client";

import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";

import {
  TimeSeriesInterval,
  TimeSeriesSeries,
  AnalyticsFilter,
  TopNDataPoint,
} from "@/types";
import { getTimeSeries, getGauge, getCompare, getTopN } from "@/services/api";
import { TimeSeriesChart } from "@/components/analytics/TimeSeriesChart";
import { GaugeCard } from "@/components/analytics/GaugeCard";
import { CompareCard } from "@/components/analytics/CompareCard";
import { TopNList } from "@/components/analytics/TopNList";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";

interface TimeRange {
  from: string;
  to: string;
  label: string;
}

const TIME_RANGES: TimeRange[] = [
  { label: "Last 1 hour", from: "1h", to: "now" },
  { label: "Last 6 hours", from: "6h", to: "now" },
  { label: "Last 24 hours", from: "24h", to: "now" },
  { label: "Last 7 days", from: "7d", to: "now" },
  { label: "Last 30 days", from: "30d", to: "now" },
];

const TIME_RANGE_LABELS: Record<string, string> = {
  "1h": "1h",
  "6h": "6h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};

function getTimeRange(range: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();

  let from: Date;
  const match = range.from.match(/^(\d+)([hdm])$/);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    from = new Date(now);
    if (unit === "h") from.setHours(from.getHours() - value);
    else if (unit === "d") from.setDate(from.getDate() - value);
    else if (unit === "m") from.setMonth(from.getMonth() - value);
  } else {
    from = new Date(now);
    from.setHours(from.getHours() - 24);
  }

  return { from: from.toISOString(), to };
}

function getIntervalForRange(range: TimeRange): TimeSeriesInterval {
  if (range.from === "1h") return "minute";
  if (range.from === "6h" || range.from === "24h") return "hour";
  if (range.from === "7d") return "hour";
  return "day";
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<TimeRange>(TIME_RANGES[2]);
  const [filters, setFilters] = useState<AnalyticsFilter[]>([]);

  // Data states
  const [eventsSeries, setEventsSeries] = useState<TimeSeriesSeries[]>([]);
  const [errorsSeries, setErrorsSeries] = useState<TimeSeriesSeries[]>([]);
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [totalErrors, setTotalErrors] = useState<number>(0);
  const [eventsCompare, setEventsCompare] = useState<{
    current: number;
    previous: number;
    change: number;
    change_percent: number;
  } | null>(null);
  const [errorsCompare, setErrorsCompare] = useState<{
    current: number;
    previous: number;
    change: number;
    change_percent: number;
  } | null>(null);
  const [topServices, setTopServices] = useState<TopNDataPoint[]>([]);
  const [topEventNames, setTopEventNames] = useState<TopNDataPoint[]>([]);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { from, to } = getTimeRange(selectedRange);
    const interval = getIntervalForRange(selectedRange);

    try {
      const [
        eventsTimeSeriesRes,
        errorsTimeSeriesRes,
        totalEventsRes,
        totalErrorsRes,
        eventsCompareRes,
        errorsCompareRes,
        topServicesRes,
        topEventNamesRes,
      ] = await Promise.all([
        // Events time series
        getTimeSeries({
          aggregation: "count",
          interval,
          from,
          to,
          fill_zeros: true,
          filters,
        }),
        // Errors time series
        getTimeSeries({
          aggregation: "count",
          interval,
          from,
          to,
          fill_zeros: true,
          filters: [
            ...filters,
            { field: "level", operator: "eq", value: "error" },
          ],
        }),
        // Total events gauge
        getGauge({
          aggregation: "count",
          from,
          to,
          filters,
        }),
        // Total errors gauge
        getGauge({
          aggregation: "count",
          from,
          to,
          filters: [
            ...filters,
            { field: "level", operator: "eq", value: "error" },
          ],
        }),
        // Events comparison
        getCompare({
          aggregation: "count",
          from,
          to,
          filters,
        }),
        // Errors comparison
        getCompare({
          aggregation: "count",
          from,
          to,
          filters: [
            ...filters,
            { field: "level", operator: "eq", value: "error" },
          ],
        }),
        // Top services
        getTopN({
          aggregation: "count",
          group_by: "service",
          from,
          to,
          limit: 5,
          filters,
        }),
        // Top event names
        getTopN({
          aggregation: "count",
          group_by: "name",
          from,
          to,
          limit: 5,
          filters,
        }),
      ]);

      setEventsSeries(eventsTimeSeriesRes.data?.series || []);
      setErrorsSeries(errorsTimeSeriesRes.data?.series || []);
      setTotalEvents(totalEventsRes.data?.value || 0);
      setTotalErrors(totalErrorsRes.data?.value || 0);
      setEventsCompare(eventsCompareRes.data || null);
      setErrorsCompare(errorsCompareRes.data || null);
      setTopServices(topServicesRes.data?.data || []);
      setTopEventNames(topEventNamesRes.data?.data || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch analytics",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedRange, filters]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="space-y-4 sm:space-y-6">
          {/* Filters and Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <AnalyticsFilters filters={filters} onFiltersChange={setFilters} />
            <div className="flex items-center gap-2">
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
                onClick={fetchAnalytics}
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
              <svg
                className="w-5 h-5 text-red-500 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Gauge Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <GaugeCard
              title="Total Events"
              value={totalEvents}
              loading={loading}
              icon={
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
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              }
            />
            <GaugeCard
              title="Total Errors"
              value={totalErrors}
              loading={loading}
              variant="error"
              icon={
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
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              }
            />
            {eventsCompare && (
              <CompareCard
                title="Events vs Previous"
                current={eventsCompare.current}
                previous={eventsCompare.previous}
                changePercent={eventsCompare.change_percent}
                loading={loading}
              />
            )}
            {errorsCompare && (
              <CompareCard
                title="Errors vs Previous"
                current={errorsCompare.current}
                previous={errorsCompare.previous}
                changePercent={errorsCompare.change_percent}
                loading={loading}
                invertColors
              />
            )}
          </div>

          {/* Time Series Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TimeSeriesChart
              title="Events Over Time"
              series={eventsSeries}
              loading={loading}
              color="blue"
            />
            <TimeSeriesChart
              title="Errors Over Time"
              series={errorsSeries}
              loading={loading}
              color="red"
            />
          </div>

          {/* Top N Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopNList
              title="Top Services"
              data={topServices}
              loading={loading}
            />
            <TopNList
              title="Top Event Names"
              data={topEventNames}
              loading={loading}
            />
          </div>
        </div>
    </main>
  );
}
