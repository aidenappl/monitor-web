"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { getTimeSeries } from "@/services/api";
import { TimeSeriesDataPoint, AnalyticsFilter } from "@/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowRotateLeft,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";

interface EventTimeRangeChartProps {
  filters?: AnalyticsFilter[];
  onRangeChange: (from: string, to: string) => void;
  defaultRange?: "1h" | "6h" | "24h" | "7d" | "30d";
}

// Calculate the time range based on defaultRange
function calculateTimeRange(defaultRange: string): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from: Date;

  const match = defaultRange.match(/^(\d+)([hdm])$/);
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

  return { from, to };
}

// Get appropriate interval for time range
function getIntervalForRange(rangeHours: number): "minute" | "hour" | "day" {
  if (rangeHours <= 24) return "minute";
  if (rangeHours <= 720) return "hour";
  return "day";
}

// Aggregate data points to target number of buckets
function aggregateDataPoints(
  points: TimeSeriesDataPoint[],
  targetBuckets: number,
): TimeSeriesDataPoint[] {
  if (points.length <= targetBuckets) return points;

  const bucketSize = Math.ceil(points.length / targetBuckets);
  const aggregated: TimeSeriesDataPoint[] = [];

  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, Math.min(i + bucketSize, points.length));
    const totalValue = bucket.reduce((sum, p) => sum + p.value, 0);
    aggregated.push({
      timestamp: bucket[0].timestamp,
      value: totalValue,
    });
  }

  return aggregated;
}

// Format time for display
function formatTime(date: Date, showDate: boolean): string {
  if (showDate) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EventTimeRangeChart({
  filters = [],
  onRangeChange,
  defaultRange = "24h",
}: EventTimeRangeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Data state
  const [dataPoints, setDataPoints] = useState<TimeSeriesDataPoint[]>([]);
  const [errorDataPoints, setErrorDataPoints] = useState<TimeSeriesDataPoint[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Time range
  const [timeRange, setTimeRange] = useState(() =>
    calculateTimeRange(defaultRange),
  );
  const [isZoomed, setIsZoomed] = useState(false);

  // Interaction state
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Chart dimensions
  const padding = { top: 8, right: 8, bottom: 24, left: 8 };
  const chartHeight = 100;

  // Always target ~60 bars regardless of zoom level for consistent density
  const rangeMs = timeRange.to.getTime() - timeRange.from.getTime();
  const targetBars = 60;

  // Serialize filters for dependency comparison
  const filtersKey = JSON.stringify(filters);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const rangeHours = rangeMs / (1000 * 60 * 60);
      const interval = getIntervalForRange(rangeHours);

      try {
        // Fetch both total events and error events in parallel
        const [totalResponse, errorResponse] = await Promise.all([
          getTimeSeries({
            aggregation: "count",
            interval,
            filters,
            from: timeRange.from.toISOString(),
            to: timeRange.to.toISOString(),
            fill_zeros: true,
          }),
          getTimeSeries({
            aggregation: "count",
            interval,
            filters: [
              ...filters,
              { field: "level", operator: "eq", value: "error" },
            ],
            from: timeRange.from.toISOString(),
            to: timeRange.to.toISOString(),
            fill_zeros: true,
          }),
        ]);

        const series = totalResponse.data?.series?.[0];
        if (series?.data_points) {
          const aggregated = aggregateDataPoints(
            series.data_points,
            targetBars,
          );
          setDataPoints(aggregated);
        } else {
          setDataPoints([]);
        }

        const errorSeries = errorResponse.data?.series?.[0];
        if (errorSeries?.data_points) {
          const aggregatedErrors = aggregateDataPoints(
            errorSeries.data_points,
            targetBars,
          );
          setErrorDataPoints(aggregatedErrors);
        } else {
          setErrorDataPoints([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        setDataPoints([]);
        setErrorDataPoints([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, filtersKey, targetBars, rangeMs]);

  // Reset when defaultRange changes
  useEffect(() => {
    const newRange = calculateTimeRange(defaultRange);
    setTimeRange(newRange);
    setSelection(null);
    setIsZoomed(false);
  }, [defaultRange]);

  // Reset to default range
  const handleReset = () => {
    const newRange = calculateTimeRange(defaultRange);
    setTimeRange(newRange);
    setSelection(null);
    setIsZoomed(false);
    onRangeChange(newRange.from.toISOString(), newRange.to.toISOString());
  };

  // Observe container width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Create error lookup map by timestamp
  const errorMap = useMemo(() => {
    const map = new Map<string, number>();
    errorDataPoints.forEach((point) => {
      map.set(point.timestamp, point.value);
    });
    return map;
  }, [errorDataPoints]);

  // Calculate bar data
  const bars = useMemo(() => {
    if (!dataPoints.length || !containerWidth) return [];

    // SVG width is containerWidth - 32 (container padding), then subtract chart padding
    const svgWidth = containerWidth - 32;
    const chartWidth = svgWidth - padding.left - padding.right;
    const barAreaHeight = chartHeight - padding.top - padding.bottom;
    const maxValue = Math.max(...dataPoints.map((d) => d.value), 1);

    const barWidth = Math.max(2, (chartWidth / dataPoints.length) * 0.85);
    const gap =
      (chartWidth - barWidth * dataPoints.length) /
      (dataPoints.length - 1 || 1);

    return dataPoints.map((point, index) => {
      const x = padding.left + index * (barWidth + gap);
      const height = (point.value / maxValue) * barAreaHeight;
      const y = padding.top + barAreaHeight - height;
      const errorCount = errorMap.get(point.timestamp) || 0;

      return {
        x,
        y,
        width: barWidth,
        height: Math.max(height, 1),
        value: point.value,
        timestamp: new Date(point.timestamp),
        index,
        hasErrors: errorCount > 0,
        errorCount,
      };
    });
  }, [dataPoints, containerWidth, padding, chartHeight, errorMap]);

  // Get bar index from x position
  const getBarIndexFromX = (clientX: number): number => {
    if (!containerRef.current || !bars.length) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    // Account for container padding (16px) and chart padding
    const containerPadding = 16;
    const x = clientX - rect.left - containerPadding - padding.left;
    const chartWidth = containerWidth - 32 - padding.left - padding.right; // 32 = container padding * 2
    const ratio = Math.max(0, Math.min(1, x / chartWidth));
    return Math.round(ratio * (bars.length - 1));
  };

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const index = getBarIndexFromX(e.clientX);
    setIsDragging(true);
    setDragStart(index);
    setSelection({ start: index, end: index });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const index = getBarIndexFromX(e.clientX);

    // Update tooltip position - offset from cursor, keep on screen
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      let x = e.clientX - rect.left + 12;
      let y = e.clientY - rect.top - 40;

      // Keep tooltip on screen
      const tooltipWidth = 120;
      if (x + tooltipWidth > containerWidth) {
        x = e.clientX - rect.left - tooltipWidth - 12;
      }
      if (y < 0) {
        y = e.clientY - rect.top + 20;
      }

      setTooltipPos({ x, y });
    }

    setHoveredIndex(index);

    // Update selection while dragging
    if (isDragging && dragStart !== null) {
      const start = Math.min(dragStart, index);
      const end = Math.max(dragStart, index);
      setSelection({ start, end });
    }
  };

  const handleMouseUp = () => {
    if (
      isDragging &&
      selection &&
      bars.length &&
      selection.start !== selection.end
    ) {
      const startBar = bars[selection.start];
      const endBar = bars[selection.end];
      if (startBar && endBar) {
        // Zoom into the selected range
        setTimeRange({ from: startBar.timestamp, to: endBar.timestamp });
        setIsZoomed(true);
        setSelection(null);
        onRangeChange(
          startBar.timestamp.toISOString(),
          endBar.timestamp.toISOString(),
        );
      }
    }
    setIsDragging(false);
    setDragStart(null);
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
    if (isDragging) {
      handleMouseUp();
    }
  };

  const rangeHours = rangeMs / (1000 * 60 * 60);
  const showDate = rangeHours > 24;

  // Generate x-axis labels
  const xLabels = useMemo(() => {
    if (!bars.length) return [];
    const labelCount = Math.min(6, bars.length);
    const step = Math.max(1, Math.floor(bars.length / labelCount));
    const labels = [];
    for (let i = 0; i < bars.length; i += step) {
      const bar = bars[i];
      labels.push({
        x: bar.x + bar.width / 2,
        label: formatTime(bar.timestamp, showDate),
      });
    }
    return labels;
  }, [bars, showDate]);

  // Selection overlay position
  const selectionOverlay = useMemo(() => {
    if (!selection || !bars.length) return null;
    const startBar = bars[selection.start];
    const endBar = bars[selection.end];
    if (!startBar || !endBar) return null;

    return {
      x: startBar.x,
      width: endBar.x + endBar.width - startBar.x,
      startTime: startBar.timestamp,
      endTime: endBar.timestamp,
    };
  }, [selection, bars]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Time Range
          </h3>
          {isZoomed && (
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
              {formatTime(timeRange.from, showDate)} →{" "}
              {formatTime(timeRange.to, showDate)}
            </span>
          )}
          {!isZoomed && selectionOverlay && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatTime(selectionOverlay.startTime, showDate)} →{" "}
              {formatTime(selectionOverlay.endTime, showDate)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isZoomed && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
            >
              <FontAwesomeIcon
                icon={faArrowRotateLeft}
                className="text-[10px]"
              />
              Reset
            </button>
          )}
          {loading && (
            <FontAwesomeIcon
              icon={faSpinner}
              className="text-sm text-zinc-400 animate-spin"
            />
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative select-none"
        style={{ height: chartHeight + 32, padding: 16 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {error ? (
          <div className="flex items-center justify-center h-full text-sm text-red-500">
            {error}
          </div>
        ) : !containerWidth || loading ? (
          <div className="flex items-center justify-center h-full">
            <FontAwesomeIcon
              icon={faSpinner}
              className="w-5 h-5 text-zinc-300 dark:text-zinc-600 animate-spin"
            />
          </div>
        ) : !bars.length ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-400">
            No data available
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              width={containerWidth - 32}
              height={chartHeight}
              className="overflow-visible cursor-crosshair"
            >
              {/* Grid lines */}
              {[0, 0.5, 1].map((ratio, i) => (
                <line
                  key={`grid-${i}`}
                  x1={padding.left}
                  y1={
                    padding.top +
                    (chartHeight - padding.top - padding.bottom) * ratio
                  }
                  x2={containerWidth - 32 - padding.right}
                  y2={
                    padding.top +
                    (chartHeight - padding.top - padding.bottom) * ratio
                  }
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-zinc-100 dark:text-zinc-800"
                />
              ))}

              {/* Selection highlight */}
              {selectionOverlay && (
                <rect
                  x={selectionOverlay.x}
                  y={padding.top}
                  width={selectionOverlay.width}
                  height={chartHeight - padding.top - padding.bottom}
                  className="fill-blue-500/10 dark:fill-blue-400/10"
                />
              )}

              {/* Bars */}
              {bars.map((bar) => {
                const isHovered = hoveredIndex === bar.index;
                const isInSelection =
                  selection &&
                  bar.index >= selection.start &&
                  bar.index <= selection.end;
                const isDimmed = hoveredIndex !== null && !isHovered;

                // Determine fill color: errors are always red, selection is blue, otherwise default
                let fillClass: string;
                if (bar.hasErrors) {
                  fillClass = isHovered
                    ? "fill-red-400 dark:fill-red-400"
                    : "fill-red-500 dark:fill-red-500";
                } else if (isInSelection) {
                  fillClass = "fill-blue-500 dark:fill-blue-400";
                } else if (isHovered) {
                  fillClass = "fill-blue-400 dark:fill-blue-300";
                } else {
                  fillClass = "fill-zinc-300 dark:fill-zinc-600";
                }

                return (
                  <rect
                    key={`bar-${bar.index}`}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    rx={1}
                    className={`transition-opacity duration-100 ${fillClass} ${isDimmed ? "opacity-40" : "opacity-100"}`}
                  />
                );
              })}

              {/* X-axis labels */}
              {xLabels.map((label, i) => (
                <text
                  key={`label-${i}`}
                  x={label.x}
                  y={chartHeight - 4}
                  textAnchor="middle"
                  className="text-[9px] fill-zinc-400 dark:fill-zinc-500 pointer-events-none"
                >
                  {label.label}
                </text>
              ))}
            </svg>

            {/* Tooltip */}
            {hoveredIndex !== null && tooltipPos && bars[hoveredIndex] && (
              <div
                className="absolute z-20 px-2.5 py-1.5 text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg shadow-lg pointer-events-none"
                style={{
                  left: tooltipPos.x,
                  top: tooltipPos.y,
                }}
              >
                <div className="font-semibold">
                  {bars[hoveredIndex].value.toLocaleString()} events
                </div>
                {bars[hoveredIndex].hasErrors && (
                  <div className="text-red-400 dark:text-red-500 text-[10px] font-medium">
                    {bars[hoveredIndex].errorCount.toLocaleString()} errors
                  </div>
                )}
                <div className="text-zinc-400 dark:text-zinc-500 text-[10px]">
                  {formatTime(bars[hoveredIndex].timestamp, showDate)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {isZoomed
            ? "Drag to zoom further, or click Reset to return to full range"
            : "Click and drag to zoom into a time range"}
        </p>
      </div>
    </div>
  );
}
