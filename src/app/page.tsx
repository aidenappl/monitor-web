"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Event, EventQueryParams, Pagination, AnalyticsFilter } from "@/types";
import { getEvents } from "@/services/api";
import { HealthStatus } from "@/components/HealthStatus";
import { EventFilters } from "@/components/EventFilters";
import { EventTable } from "@/components/EventTable";
import { EventTimeRangeChart } from "@/components/EventTimeRangeChart";

export default function Home() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventQueryParams>({ limit: 100 });
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [selectedRange, setSelectedRange] = useState<
    "1h" | "6h" | "24h" | "7d" | "30d"
  >("24h");

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
      setEvents(response.data || []);
      setPagination(response.pagination?.count ? response.pagination : null);
    } catch (err) {
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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-20 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/Monitor-Logo-Transparent.svg"
                  alt="Monitor Logo"
                  width={40}
                  height={40}
                  className="w-10 h-10"
                />
                <h1 className="text-lg sm:text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Monitor
                </h1>
              </Link>
              <span className="hidden sm:inline text-sm text-zinc-400 dark:text-zinc-500">
                /
              </span>
              <span className="hidden sm:inline text-sm text-zinc-500 dark:text-zinc-400">
                Events
              </span>
            </div>
            <div className="flex items-center gap-3">
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  href="/"
                  className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg"
                >
                  Events
                </Link>
                <Link
                  href="/analytics"
                  className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Analytics
                </Link>
                <Link
                  href="/dashboard"
                  className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Dashboard
                </Link>
              </nav>
              <HealthStatus />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="space-y-4 sm:space-y-6">
          {/* Time Range Chart with draggable selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Time Range
              </label>
              <select
                value={selectedRange}
                onChange={(e) => {
                  setSelectedRange(e.target.value as typeof selectedRange);
                  // Clear from/to filters when changing the time range dropdown
                  setFilters((prev) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { from: _from, to: _to, ...rest } = prev;
                    return { ...rest, offset: 0 };
                  });
                }}
                className="h-8 px-2 text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              >
                <option value="1h">Last 1 hour</option>
                <option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>
            <EventTimeRangeChart
              defaultRange={selectedRange}
              filters={analyticsFilters}
              onRangeChange={handleTimeRangeChange}
            />
          </div>

          <EventFilters
            filters={filters}
            onFiltersChange={setFilters}
            onSearch={fetchEvents}
          />

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

          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/30">
              <div className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">
                {pagination ? (
                  <span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {Math.min(events.length, filters.limit || 100)}
                    </span>{" "}
                    of{" "}
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {pagination.count.toLocaleString()}
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

            <EventTable
              events={events}
              loading={loading}
              onAddFilter={handleAddFilter}
            />

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
      </main>
    </div>
  );
}
