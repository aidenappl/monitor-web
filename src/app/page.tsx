"use client";

import { useState, useEffect, useCallback } from "react";
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
      <header className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Monitor
              </h1>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                Events Dashboard
              </span>
            </div>
            <HealthStatus />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
          <EventFilters
            filters={filters}
            onFiltersChange={setFilters}
            onSearch={fetchEvents}
          />

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {pagination ? (
                  <span>
                    Showing {Math.min(events.length, filters.limit || 100)} of{" "}
                    {pagination.count} events
                  </span>
                ) : (
                  <span>{events.length} events</span>
                )}
              </div>
              <button
                onClick={fetchEvents}
                disabled={loading}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <EventTable events={events} loading={loading} />

            {pagination && (pagination.next || pagination.previous) && (
              <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <button
                  onClick={handlePrevPage}
                  disabled={!pagination.previous || loading}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={!pagination.next || loading}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
