"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Event, EventQueryParams, Pagination } from "@/types";
import { getEvents } from "@/services/api";
import { HealthStatus } from "@/components/HealthStatus";
import { EventFilters } from "@/components/EventFilters";
import { EventTable } from "@/components/EventTable";

export default function Home() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventQueryParams>({ limit: 100 });
  const [pagination, setPagination] = useState<Pagination | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getEvents(filters);
      setEvents(response.data || []);
      setPagination(response.pagination || null);
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
                <div className="w-8 h-8 rounded-lg bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                  <svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </div>
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

            <EventTable events={events} loading={loading} />

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
