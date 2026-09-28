"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Event, EventQueryParams, Pagination, AnalyticsFilter } from "@/types";
import { getEvents } from "@/services/api";
import { EventFilters } from "@/components/EventFilters";
import { EventTable } from "@/components/EventTable";
import { EventTimeRangeChart } from "@/components/EventTimeRangeChart";
import { EventDetailPanel } from "@/components/EventDetailPanel";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SavedViews } from "@/components/SavedViews";
import { FailureState } from "@/components/FailureState";
import { relativeFrom } from "@/tools/timeRange.tools";

export default function Home() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventQueryParams>({ limit: 100 });
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [selectedRange, setSelectedRange] = useState<
    "1h" | "6h" | "24h" | "7d" | "30d"
  >("24h");
  /**
   * Bumped by every range click and folded into the chart's `key`.
   *
   * The key is what resets the chart: a new range mounts a fresh chart that
   * fetches ONCE for it. The reset effect this replaced ran on mount as well,
   * so every events-page load fetched both timeseries twice. The nonce covers
   * the one click the range alone misses — the SAME range again after a brush
   * zoom, which must still return the chart to the full range.
   */
  const [rangeNonce, setRangeNonce] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  /**
   * Bumped by every fetchEvents call; a response that is no longer the newest
   * is dropped. Five things call fetchEvents (mount/filters, the range, the
   * Search button, AutoRefresh, Refresh/Retry), so an effect-local `cancelled`
   * flag cannot see them all — and without this a slow auto-refresh for the
   * previous range could land after the new range's answer and fill the table
   * with the wrong window.
   */
  const fetchGenRef = useRef(0);

  // Convert EventQueryParams filters to AnalyticsFilter[] for the chart
  const analyticsFilters: AnalyticsFilter[] = useMemo(() => {
    const result: AnalyticsFilter[] = [];

    // Include level filter if set
    if (filters.level) {
      result.push({ field: "level", operator: "eq", value: filters.level });
    }

    Object.entries(filters).forEach(([key, value]) => {
      const excludeKeys = ["level", "limit", "offset", "from", "to"];
      if (excludeKeys.includes(key) || value === undefined || value === "") {
        return;
      }

      // Parse Django-style filter key
      const operators = [
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
      let field = key;
      let operator: AnalyticsFilter["operator"] = "eq";

      for (const op of operators) {
        if (key.endsWith(`__${op}`)) {
          field = key.slice(0, -(op.length + 2));
          operator = op as AnalyticsFilter["operator"];
          break;
        }
      }

      result.push({ field, operator, value: String(value) });
    });

    return result;
  }, [filters]);

  const handleTimeRangeChange = useCallback((from: string, to: string) => {
    setFilters((prev) => ({ ...prev, from, to, offset: 0 }));
  }, []);

  // Back to the selected range from a brush zoom: drop the absolute bounds so
  // the table follows the RELATIVE window again (see fetchEvents).
  const handleRangeReset = useCallback(() => {
    setFilters((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { from: _from, to: _to, ...rest } = prev;
      return { ...rest, offset: 0 };
    });
  }, []);

  const handleAddFilter = useCallback((field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value, offset: 0 }));
  }, []);

  const fetchEvents = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      // ⚠️ THE TABLE IS BOUNDED BY THE SELECTED RANGE, resolved HERE. Without a
      // `from`, the count() and ORDER BY behind this request scanned the whole
      // 30-day project on every load, and the table ignored the range buttons
      // above it entirely. A brush zoom writes absolute from/to into `filters`
      // and wins; otherwise the window is computed now, from the spec — never
      // stored as a timestamp, because a stored `from` would freeze AutoRefresh
      // and Refresh on the old window and be persisted by SavedViews.
      const response = await getEvents({
        ...filters,
        from: filters.from ?? relativeFrom(selectedRange),
      });
      if (gen !== fetchGenRef.current) return;
      if (!response.success) {
        // Explicit: the client no longer throws on a non-2xx, so the catch below
        // is unreachable for HTTP failures and a failing API would render as an
        // empty event list.
        setError(response.error_message || "Failed to fetch events");
        setEvents([]);
        setPagination(null);
        return;
      }
      setEvents(response.data);
      setPagination(response.success ? (response.pagination ?? null) : null);
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      setEvents([]);
    } finally {
      // Only the newest request owns the spinner; a superseded one finishing
      // first must not clear it while the current one is still loading.
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [filters, selectedRange]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleNextPage = () => {
    if (pagination?.next) {
      setFilters((prev) => ({
        ...prev,
        offset: (prev.offset || 0) + (prev.limit || 100),
      }));
    }
  };

  const handlePrevPage = () => {
    if (pagination?.previous) {
      setFilters((prev) => ({
        ...prev,
        offset: Math.max(0, (prev.offset || 0) - (prev.limit || 100)),
      }));
    }
  };

  const handleLoadView = useCallback((queryParams: Record<string, unknown>) => {
    setFilters(queryParams as EventQueryParams);
  }, []);

  return (
    <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="space-y-4 sm:space-y-6">
          {/* Time Range Chart with draggable selection */}
          <div className="space-y-3">
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden w-fit">
              {(["1h", "6h", "24h", "7d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setSelectedRange(r);
                    setRangeNonce((n) => n + 1);
                    setFilters((prev) => {
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const { from: _from, to: _to, ...rest } = prev;
                      return { ...rest, offset: 0 };
                    });
                  }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-zinc-200 dark:border-zinc-700 ${
                    selectedRange === r
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <EventTimeRangeChart
              key={`${selectedRange}:${rangeNonce}`}
              defaultRange={selectedRange}
              filters={analyticsFilters}
              onRangeChange={handleTimeRangeChange}
              onRangeReset={handleRangeReset}
            />
          </div>

          <div className="flex items-center gap-2">
            <EventFilters
              filters={filters}
              onFiltersChange={setFilters}
              onSearch={fetchEvents}
            />
            <SavedViews
              page="events"
              currentFilters={filters as Record<string, unknown>}
              onLoadView={handleLoadView}
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/30">
              <div className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">
                {error ? (
                  // A confident "0 events" beside a failed request is the same
                  // lie in miniature, so the count is withheld rather than
                  // guessed from an empty array.
                  <span className="text-zinc-400 dark:text-zinc-500">
                    Events unavailable
                  </span>
                ) : pagination ? (
                  <span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {Math.min(events.length, filters.limit || 100)}
                    </span>{" "}
                    of{" "}
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {(pagination.count ?? 0).toLocaleString()}
                    </span>{" "}
                    events
                    {/* The total is for the window now, not the whole
                        retention, so it says which window. */}
                    <span className="text-zinc-400 dark:text-zinc-500">
                      {" "}
                      · {filters.from ? "selected range" : `last ${selectedRange}`}
                    </span>
                  </span>
                ) : (
                  <span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {events.length}
                    </span>{" "}
                    events
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <AutoRefresh onRefresh={fetchEvents} loading={loading} />
                <button
                  onClick={fetchEvents}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-50 transition-colors"
                >
                  <FontAwesomeIcon
                    icon={loading ? faSpinner : faArrowsRotate}
                    className={`text-sm ${loading ? "animate-spin" : ""}`}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>

            {/* DOWN, NOT EMPTY. The banner used to sit above this table while
                the table rendered its own "No events found" underneath, so a
                failed query said both things at once. One branch, one fact. */}
            {error ? (
              <FailureState
                what="events"
                message={error}
                onRetry={fetchEvents}
                className="rounded-none border-0"
              />
            ) : (
              <EventTable
                events={events}
                loading={loading}
                onAddFilter={handleAddFilter}
                onSelectEvent={setSelectedEvent}
              />
            )}

            {pagination && (pagination.next || pagination.previous) && (
              <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/30">
                <button
                  onClick={handlePrevPage}
                  disabled={!pagination.previous || loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
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
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  Previous
                </button>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  Page{" "}
                  {Math.floor((filters.offset || 0) / (filters.limit || 100)) +
                    1}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={!pagination.next || loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                >
                  Next
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
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

      {/* Event Detail Panel */}
      <EventDetailPanel
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </main>
  );
}
