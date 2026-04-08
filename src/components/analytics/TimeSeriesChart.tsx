"use client";

import { useMemo, useRef, useState, useEffect } from "react";
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
    gradient: ["rgba(59, 130, 246, 0.2)", "rgba(59, 130, 246, 0)"],
  },
  red: {
    stroke: "#ef4444",
    gradient: ["rgba(239, 68, 68, 0.2)", "rgba(239, 68, 68, 0)"],
  },
  green: {
    stroke: "#22c55e",
    gradient: ["rgba(34, 197, 94, 0.2)", "rgba(34, 197, 94, 0)"],
  },
  amber: {
    stroke: "#f59e0b",
    gradient: ["rgba(245, 158, 11, 0.2)", "rgba(245, 158, 11, 0)"],
  },
};

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatFooterTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTooltipTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

export function TimeSeriesChart({
  title,
  series,
  loading = false,
  color = "blue",
  height = 200,
}: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    if (!series[0]?.data_points?.length || !svgWidth) return null;

    const dataPoints = series[0].data_points;
    const values = dataPoints.map((p) => p.value);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const range = maxValue - minValue || 1;
    const chartW = svgWidth - PAD.left - PAD.right;
    const chartH = height - PAD.top - PAD.bottom;
    const n = dataPoints.length;

    const points = dataPoints.map((p, i) => ({
      x: PAD.left + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2),
      y: PAD.top + chartH - ((p.value - minValue) / range) * chartH,
      value: p.value,
      timestamp: p.timestamp,
    }));

    const path = points
      .map((p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`))
      .join(" ");
    const areaPath = `${path} L ${points[n - 1].x.toFixed(2)} ${(PAD.top + chartH).toFixed(2)} L ${points[0].x.toFixed(2)} ${(PAD.top + chartH).toFixed(2)} Z`;

    const labelCount = 4;
    const labels = Array.from({ length: labelCount }, (_, i) => ({
      value: Math.round(maxValue - (range / (labelCount - 1)) * i),
      y: PAD.top + (chartH / (labelCount - 1)) * i,
    }));

    return { points, path, areaPath, labels, chartH };
  }, [series, svgWidth, height]);

  const colorConfig = COLORS[color];
  const gradientId = `grad-${color}-${title.replace(/\W/g, "")}`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chart || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const chartW = svgWidth - PAD.left - PAD.right;
    const ratio = Math.max(0, Math.min(1, (x - PAD.left) / chartW));
    const index = Math.round(ratio * (chart.points.length - 1));
    setHoveredIndex(index);

    const pt = chart.points[index];
    let tx = pt.x + 14;
    if (tx + 160 > svgWidth - PAD.right) tx = pt.x - 174;
    setTooltipPos({ x: tx, y: Math.max(PAD.top, pt.y - 52) });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
      </div>

      <div ref={containerRef} className="px-4 pt-4 pb-2 relative">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <div className="w-6 h-6 border-2 border-zinc-200 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !chart ? (
          <div
            className="flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500"
            style={{ height }}
          >
            No data available
          </div>
        ) : (
          <div className="relative">
            <svg
              width={svgWidth}
              height={height}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              className="overflow-visible cursor-crosshair block"
            >
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={colorConfig.gradient[0]} />
                  <stop offset="100%" stopColor={colorConfig.gradient[1]} />
                </linearGradient>
              </defs>

              {/* Grid lines + Y-axis labels */}
              {chart.labels.map((label, i) => (
                <g key={i}>
                  <line
                    x1={PAD.left}
                    y1={label.y}
                    x2={svgWidth - PAD.right}
                    y2={label.y}
                    stroke="currentColor"
                    strokeWidth="1"
                    className="text-zinc-200 dark:text-zinc-800"
                  />
                  <text
                    x={PAD.left - 6}
                    y={label.y + 4}
                    textAnchor="end"
                    fontSize="11"
                    className="fill-zinc-400 dark:fill-zinc-500"
                  >
                    {formatAxisValue(label.value)}
                  </text>
                </g>
              ))}

              {/* Area fill */}
              <path d={chart.areaPath} fill={`url(#${gradientId})`} />

              {/* Line */}
              <path
                d={chart.path}
                fill="none"
                stroke={colorConfig.stroke}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Hover indicator */}
              {hoveredIndex !== null && chart.points[hoveredIndex] && (() => {
                const pt = chart.points[hoveredIndex];
                return (
                  <g>
                    <line
                      x1={pt.x}
                      y1={PAD.top}
                      x2={pt.x}
                      y2={PAD.top + chart.chartH}
                      stroke={colorConfig.stroke}
                      strokeWidth="1"
                      strokeDasharray="3 3"
                      opacity="0.4"
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="4"
                      fill={colorConfig.stroke}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })()}
            </svg>

            {/* Tooltip */}
            {hoveredIndex !== null &&
              tooltipPos &&
              chart.points[hoveredIndex] && (
                <div
                  className="absolute z-20 px-2.5 py-2 text-xs bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg shadow-lg pointer-events-none"
                  style={{ left: tooltipPos.x, top: tooltipPos.y }}
                >
                  <div className="font-semibold">
                    {chart.points[hoveredIndex].value.toLocaleString()}
                  </div>
                  <div className="text-zinc-400 dark:text-zinc-500 mt-0.5">
                    {formatTooltipTime(chart.points[hoveredIndex].timestamp)}
                  </div>
                </div>
              )}
          </div>
        )}
      </div>

      {chart && chart.points.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>{formatFooterTime(chart.points[0].timestamp)}</span>
          <span>
            {formatFooterTime(chart.points[chart.points.length - 1].timestamp)}
          </span>
        </div>
      )}
    </div>
  );
}
