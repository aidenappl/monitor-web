"use client";

import { useMemo } from "react";
import { TimeSeriesSeries } from "@/types";

interface TimeSeriesChartProps {
  title: string;
  series: TimeSeriesSeries[];
  loading?: boolean;
  color?: "blue" | "red" | "green" | "amber";
  height?: number;
}

const COLORS = {
  blue: {
    stroke: "#3b82f6",
    fill: "rgba(59, 130, 246, 0.1)",
    gradient: ["rgba(59, 130, 246, 0.3)", "rgba(59, 130, 246, 0)"],
  },
  red: {
    stroke: "#ef4444",
    fill: "rgba(239, 68, 68, 0.1)",
    gradient: ["rgba(239, 68, 68, 0.3)", "rgba(239, 68, 68, 0)"],
  },
  green: {
    stroke: "#22c55e",
    fill: "rgba(34, 197, 94, 0.1)",
    gradient: ["rgba(34, 197, 94, 0.3)", "rgba(34, 197, 94, 0)"],
  },
  amber: {
    stroke: "#f59e0b",
    fill: "rgba(245, 158, 11, 0.1)",
    gradient: ["rgba(245, 158, 11, 0.3)", "rgba(245, 158, 11, 0)"],
  },
};

export function TimeSeriesChart({
  title,
  series,
  loading = false,
  color = "blue",
  height = 200,
}: TimeSeriesChartProps) {
  const chartData = useMemo(() => {
    if (!series.length || !series[0]?.data_points?.length) {
      return {
        path: "",
        areaPath: "",
        points: [],
        maxValue: 0,
        minValue: 0,
        labels: [],
      };
    }

    const dataPoints = series[0].data_points;
    const values = dataPoints.map((p) => p.value);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const range = maxValue - minValue || 1;

    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartWidth = 100; // percentage
    const chartHeight = height - padding.top - padding.bottom;

    const points = dataPoints.map((point, index) => {
      const x =
        padding.left +
        (index / (dataPoints.length - 1 || 1)) *
          (chartWidth - padding.left - padding.right);
      const y =
        padding.top +
        chartHeight -
        ((point.value - minValue) / range) * chartHeight;
      return { x, y, value: point.value, timestamp: point.timestamp };
    });

    // Create smooth path
    const path = points.reduce((acc, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      return `${acc} L ${point.x} ${point.y}`;
    }, "");

    // Create area path
    const areaPath = points.length
      ? `${path} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`
      : "";

    // Generate Y-axis labels
    const labelCount = 5;
    const labels = Array.from({ length: labelCount }, (_, i) => {
      const value =
        minValue + (range * (labelCount - 1 - i)) / (labelCount - 1);
      return {
        value: Math.round(value),
        y: padding.top + (i / (labelCount - 1)) * chartHeight,
      };
    });

    return { path, areaPath, points, maxValue, minValue, labels };
  }, [series, height]);

  const colorConfig = COLORS[color];
  const gradientId = `gradient-${color}-${title.replace(/\s/g, "")}`;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
      </div>
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <div className="w-6 h-6 border-2 border-zinc-200 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !chartData.points.length ? (
          <div
            className="flex items-center justify-center text-zinc-400 dark:text-zinc-500"
            style={{ height }}
          >
            No data available
          </div>
        ) : (
          <svg
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={colorConfig.gradient[0]} />
                <stop offset="100%" stopColor={colorConfig.gradient[1]} />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {chartData.labels.map((label, i) => (
              <line
                key={i}
                x1="50"
                y1={label.y}
                x2="100"
                y2={label.y}
                stroke="currentColor"
                strokeWidth="0.1"
                className="text-zinc-200 dark:text-zinc-700"
              />
            ))}

            {/* Y-axis labels */}
            {chartData.labels.map((label, i) => (
              <text
                key={i}
                x="48"
                y={label.y + 1}
                textAnchor="end"
                className="text-zinc-500 dark:text-zinc-400"
                style={{ fontSize: "3px" }}
              >
                {label.value >= 1000
                  ? `${(label.value / 1000).toFixed(1)}k`
                  : label.value}
              </text>
            ))}

            {/* Area fill */}
            <path d={chartData.areaPath} fill={`url(#${gradientId})`} />

            {/* Line */}
            <path
              d={chartData.path}
              fill="none"
              stroke={colorConfig.stroke}
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Data points */}
            {chartData.points.map((point, i) => (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r="0.8"
                fill={colorConfig.stroke}
                className="opacity-0 hover:opacity-100 transition-opacity"
              >
                <title>{`${new Date(point.timestamp).toLocaleString()}: ${point.value.toLocaleString()}`}</title>
              </circle>
            ))}
          </svg>
        )}
      </div>
      {chartData.points.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {new Date(chartData.points[0].timestamp).toLocaleString()}
          </span>
          <span>
            {new Date(
              chartData.points[chartData.points.length - 1].timestamp,
            ).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
