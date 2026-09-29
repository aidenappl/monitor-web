"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { reportError } from "@/services/monitor.service";

export default function Home() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventQueryParams>({ limit: 100 });
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [selectedRange, setSelectedRange] = useState<
    "1h" | "6h" | "24h" | "7d" | "30d"
  >("24h");
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

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

  const handleAddFilter = useCallback((field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value, offset: 0 }));
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getEvents(filters);
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
      reportError("events.load.failed", err, {
        filter_keys: Object.keys(filters).join(","),
        outcome: "events page shows its failure state",
      });
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

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
              defaultRange={selectedRange}
              filters={analyticsFilters}
              onRangeChange={handleTimeRangeChange}
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
