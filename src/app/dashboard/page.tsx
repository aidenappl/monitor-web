"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
  faPlus,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import {
  WidgetConfig,
  TimeSeriesInterval,
  TimeSeriesSeries,
  TopNDataPoint,
  CompareResponse,
  AnalyticsFilter,
} from "@/types";
import { getTimeSeries, getGauge, getCompare, getTopN } from "@/services/api";
import { HealthStatus } from "@/components/HealthStatus";
import { TimeSeriesChart } from "@/components/analytics/TimeSeriesChart";
import { TimeSeriesTable } from "@/components/analytics/TimeSeriesTable";
import { GaugeCard } from "@/components/analytics/GaugeCard";
import { CompareCard } from "@/components/analytics/CompareCard";
import { TopNList } from "@/components/analytics/TopNList";
import { WidgetEditor } from "@/components/dashboard/WidgetEditor";
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

interface WidgetData {
  loading: boolean;
  error: string | null;
  data: unknown;
}

export default function DashboardPage() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [widgetData, setWidgetData] = useState<Record<string, WidgetData>>({});
  const [selectedRange, setSelectedRange] = useState<TimeRange>(TIME_RANGES[2]);
  const [globalFilters, setGlobalFilters] = useState<AnalyticsFilter[]>([]);
  const [editingWidget, setEditingWidget] = useState<WidgetConfig | null>(null);
  const [isAddingWidget, setIsAddingWidget] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchWidgetData = useCallback(
    async (widget: WidgetConfig) => {
      const { from, to } = getTimeRange(selectedRange);
      const interval = getIntervalForRange(selectedRange);
      const allFilters = [...globalFilters, ...widget.filters];

      setWidgetData((prev) => ({
        ...prev,
        [widget.id]: {
          loading: true,
          error: null,
          data: prev[widget.id]?.data,
        },
      }));

      try {
        let data: unknown;

        switch (widget.type) {
          case "gauge": {
            const res = await getGauge({
              aggregation: widget.aggregation,
              field: widget.field,
              filters: allFilters,
              from,
              to,
            });
            data = res.data?.value ?? 0;
            break;
          }
          case "timeseries": {
            const res = await getTimeSeries({
              aggregation: widget.aggregation,
              field: widget.field,
              interval: widget.interval || interval,
              group_by: widget.group_by,
              filters: allFilters,
              from,
              to,
              fill_zeros: widget.fill_zeros ?? true,
            });
            data = res.data?.series ?? [];
            break;
          }
          case "topn": {
            const res = await getTopN({
              aggregation: widget.aggregation,
              field: widget.field,
              group_by: widget.group_by,
              filters: allFilters,
              from,
              to,
              limit: widget.limit || 10,
            });
            data = res.data?.data ?? [];
            break;
          }
          case "compare": {
            const res = await getCompare({
              aggregation: widget.aggregation,
              field: widget.field,
              filters: allFilters,
              from,
              to,
            });
            data = res.data ?? null;
            break;
          }
        }

        setWidgetData((prev) => ({
          ...prev,
          [widget.id]: { loading: false, error: null, data },
        }));
      } catch (err) {
        setWidgetData((prev) => ({
          ...prev,
          [widget.id]: {
            loading: false,
            error: err instanceof Error ? err.message : "Failed to fetch",
            data: null,
          },
        }));
      }
    },
    [selectedRange, globalFilters],
  );

  const fetchAllWidgets = useCallback(async () => {
    setLoading(true);
    await Promise.all(widgets.map(fetchWidgetData));
    setLoading(false);
  }, [widgets, fetchWidgetData]);

  const handleAddWidget = (widget: WidgetConfig) => {
    setWidgets((prev) => [...prev, widget]);
    setIsAddingWidget(false);
    fetchWidgetData(widget);
  };

  const handleUpdateWidget = (widget: WidgetConfig) => {
    setWidgets((prev) => prev.map((w) => (w.id === widget.id ? widget : w)));
    setEditingWidget(null);
    fetchWidgetData(widget);
  };

  const handleDeleteWidget = (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    setWidgetData((prev) => {
      const newData = { ...prev };
      delete newData[id];
      return newData;
    });
  };

  const handleDuplicateWidget = (widget: WidgetConfig) => {
    const newWidget = {
      ...widget,
      id: `widget-${Date.now()}`,
      title: `${widget.title} (Copy)`,
    };
    setWidgets((prev) => [...prev, newWidget]);
    fetchWidgetData(newWidget);
  };

  const renderWidget = (widget: WidgetConfig) => {
    const data = widgetData[widget.id];
    const isLoading = data?.loading ?? true;

    switch (widget.type) {
      case "gauge":
        return (
          <GaugeCard
            title={widget.title}
            value={(data?.data as number) ?? 0}
            loading={isLoading}
            variant={widget.variant}
          />
        );
      case "timeseries":
        if (widget.display === "table") {
          return (
            <TimeSeriesTable
              title={widget.title}
              series={(data?.data as TimeSeriesSeries[]) ?? []}
              loading={isLoading}
            />
          );
        }
        return (
          <TimeSeriesChart
            title={widget.title}
            series={(data?.data as TimeSeriesSeries[]) ?? []}
            loading={isLoading}
            color={widget.color}
          />
        );
      case "topn":
        return (
          <TopNList
            title={widget.title}
            data={(data?.data as TopNDataPoint[]) ?? []}
            loading={isLoading}
          />
        );
      case "compare":
        const compareData = data?.data as CompareResponse | null;
        return (
          <CompareCard
            title={widget.title}
            current={compareData?.current ?? 0}
            previous={compareData?.previous ?? 0}
            changePercent={compareData?.change_percent ?? 0}
            loading={isLoading}
            invertColors={widget.invertColors}
          />
        );
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
                Dashboard Builder
              </span>
            </div>
            <div className="flex items-center gap-3">
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  href="/"
                  className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
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
                  className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg"
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
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <AnalyticsFilters
              filters={globalFilters}
              onFiltersChange={setGlobalFilters}
            />
            <div className="flex items-center gap-2">
              <select
                value={selectedRange.label}
                onChange={(e) => {
                  const range = TIME_RANGES.find(
                    (r) => r.label === e.target.value,
                  );
                  if (range) setSelectedRange(range);
                }}
                className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIME_RANGES.map((range) => (
                  <option key={range.label} value={range.label}>
                    {range.label}
                  </option>
                ))}
              </select>
              <button
                onClick={fetchAllWidgets}
                disabled={loading || widgets.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg disabled:opacity-50 transition-colors"
              >
                <FontAwesomeIcon
                  icon={loading ? faSpinner : faArrowsRotate}
                  className={`text-sm ${loading ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline">Refresh All</span>
              </button>
              <button
                onClick={() => setIsAddingWidget(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <FontAwesomeIcon icon={faPlus} className="text-sm" />
                <span className="hidden sm:inline">Add Widget</span>
              </button>
            </div>
          </div>

          {/* Empty State */}
          {widgets.length === 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-zinc-400 dark:text-zinc-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                Build Your Dashboard
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-md mx-auto">
                Create custom widgets to visualize your monitoring data. Add
                gauges, time series charts, top N lists, and comparison cards.
              </p>
              <button
                onClick={() => setIsAddingWidget(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <FontAwesomeIcon icon={faPlus} />
                Add Your First Widget
              </button>
            </div>
          )}

          {/* Widget Grid */}
          {widgets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {widgets.map((widget) => (
                <div key={widget.id} className="relative group">
                  {renderWidget(widget)}
                  {/* Widget actions overlay */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      onClick={() => setEditingWidget(widget)}
                      className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 shadow-sm"
                      title="Edit"
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
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDuplicateWidget(widget)}
                      className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 shadow-sm"
                      title="Duplicate"
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
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteWidget(widget.id)}
                      className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shadow-sm"
                      title="Delete"
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Widget Editor Modal */}
      {(isAddingWidget || editingWidget) && (
        <WidgetEditor
          widget={editingWidget}
          onSave={editingWidget ? handleUpdateWidget : handleAddWidget}
          onClose={() => {
            setIsAddingWidget(false);
            setEditingWidget(null);
          }}
        />
      )}
    </div>
  );
}
