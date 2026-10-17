"use client";

import {
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { TimeSeriesInterval } from "@/types";
import { intervalMs } from "@/tools/timeRange.tools";

/**
 * A point the chart can draw. `value: null` is "no data in this bucket" and
 * breaks the line — it is never drawn as 0. `TimeSeriesSeries` from the API is
 * assignable to this unchanged.
 */
export interface ChartPoint {
  timestamp: string;
  value: number | null;
}

export interface ChartSeries {
  name?: string;
  data_points: ChartPoint[];
}

interface TimeSeriesChartProps {
  title: string;
  series: ChartSeries[];
  loading?: boolean;
  /** Colour of a single series. With several, the first takes this and the rest the palette. */
  color?: "blue" | "red" | "green" | "amber";
  height?: number;
  /**
   * Formats a value for the y-axis, the tooltip and the accessible summary.
   * Defaults to a compact count ("1.5K"). Pass `formatDurationMs` for latency.
   */
  formatValue?: (value: number) => string;
  /**
   * The bucket width the series was queried with. Enables:
   * - gap detection: a bucket ABSENT from the response (what `fill_zeros:false`
   *   does) breaks the line instead of being bridged — see `emptyBuckets`;
   * - partial-bucket detection for `partialBuckets`.
   */
  interval?: TimeSeriesInterval;
  /**
   * What an absent bucket means. Only consulted with `interval`.
   * - `"gap"` (default): no data — the line breaks. Right for percentiles,
   *   averages, anything where 0 would be a lie ("latency fell to 0ms").
   * - `"zero"`: nothing happened — drawn as 0. Right for counts queried
   *   without fill_zeros.
   */
  emptyBuckets?: "gap" | "zero";
  /**
   * The window that was queried (ISO). Lays points out on real time across it
   * and makes partial-bucket detection exact. Without it the x-axis spans the
   * first to the last point.
   */
  domain?: { from: string; to: string };
  /**
   * The first bucket usually starts before the window and the last one is
   * still filling, so both read as false dips. Requires `interval`.
   * - `"show"` (default): drawn like any other bucket (the old behaviour).
   * - `"dashed"`: the edge segments are dashed and the tooltip says "partial".
   * - `"trim"`: partial edge buckets are left out.
   * Without `domain`, both edges are treated as partial (true of every
   * "last N" window).
   */
  partialBuckets?: "show" | "dashed" | "trim";
  /** Shows a Log/Linear toggle in the header, for data one series dominates. */
  allowLogScale?: boolean;
  /** Initial scale. */
  scale?: "linear" | "log";
  /**
   * Enables drag-to-zoom: called with the ISO edges of the dragged span. The
   * page decides what to do with it (typically set a custom range).
   */
  onBrush?: (from: string, to: string) => void;
  /** Name for an unnamed series. Defaults to `title`. */
  seriesLabel?: string;
  /** Header slot, right-aligned — export buttons and the like. */
  actions?: ReactNode;
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

/** Further series, after the first. Distinguishable in light and dark. */
const PALETTE = [
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
  "#6366f1",
];

function trimZero(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** Compact count: 950, 1.5K, 2M. Non-integers keep up to two decimals. */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZero((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trimZero((value / 1_000).toFixed(1))}K`;
  if (Number.isInteger(value)) return String(value);
  return trimZero(value.toFixed(2));
}

/**
 * A duration in milliseconds as a person reads it: "120 ms", "1.4 s", "80 s",
 * "2 m", "1.5 h". Seconds run to two minutes so a 1/2/5 axis (20 s, 40 s,
 * 60 s, 80 s) never flips unit halfway up.
 */
export function formatDurationMs(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1) return `${trimZero(ms.toFixed(2))} ms`;
  if (abs < 1000) return `${Math.round(ms)} ms`;
  if (abs < 120_000) return `${trimZero((ms / 1000).toFixed(abs < 10_000 ? 1 : 0))} s`;
  if (abs < 7_200_000) return `${trimZero((ms / 60_000).toFixed(1))} m`;
  return `${trimZero((ms / 3_600_000).toFixed(1))} h`;
}

function formatFooterTime(timestamp: string | number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTooltipTime(timestamp: string | number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Round tick values covering [min, max]: steps of 1, 2, 2.5 or 5 × 10ⁿ, the top
 * tick at or above max. Replaces `max − range/3·i`, which labelled the axis
 * 146/97/49 and, for a max of 1–2, rounded two ticks to the same label.
 */
export function niceTicks(min: number, max: number, target = 4, integer = false): number[] {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, Math.ceil(step));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

/**
 * 0, 10, 100 … up to the first decade ≥ max; thinned to at most 6. "1" is
 * kept only for small data — on a log axis it sits a hair above 0 and the two
 * labels collide.
 */
function logTicks(max: number): number[] {
  const ticks = max < 100 ? [0, 1] : [0, 10];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] * 10);
  if (ticks.length <= 6) return ticks;
  const top = ticks[ticks.length - 1];
  const thinned = ticks.filter((_, i) => i === 0 || i % 2 === (ticks.length - 1) % 2);
  return thinned.includes(top) ? thinned : [...thinned, top];
}

const logT = (v: number) => Math.log10(1 + Math.max(0, v));

const PAD = { top: 16, right: 16, bottom: 32, left: 52 };

interface PlotPoint {
  t: number;
  v: number;
  x: number;
  y: number;
}

interface SeriesPlot {
  key: string;
  name: string;
  color: string;
  /** Contiguous runs; a null value or an absent bucket starts a new one. */
  segments: PlotPoint[][];
  byTime: Map<number, number | null>;
}

export function TimeSeriesChart({
  title,
  series,
  loading = false,
  color = "blue",
  height = 200,
  formatValue = formatCompactNumber,
  interval,
  emptyBuckets = "gap",
  domain,
  partialBuckets = "show",
  allowLogScale = false,
  scale: initialScale = "linear",
  onBrush,
  seriesLabel,
  actions,
}: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [scale, setScale] = useState<"linear" | "log">(initialScale);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const singleColor = COLORS[color];

  /** Every series, named and coloured, with its points on milliseconds. */
  const named = useMemo(
    () =>
      series.map((s, i) => ({
        key: `${i}:${s.name ?? ""}`,
        name:
          s.name ||
          (i === 0 ? (seriesLabel ?? title) : `${seriesLabel ?? title} ${i + 1}`),
        color: i === 0 ? singleColor.stroke : PALETTE[(i - 1) % PALETTE.length],
        points: (s.data_points ?? [])
          .map((p) => ({ t: Date.parse(p.timestamp), v: p.value }))
          .filter((p) => !Number.isNaN(p.t))
          .sort((a, b) => a.t - b.t),
      })),
    [series, seriesLabel, title, singleColor.stroke],
  );

  const chart = useMemo(() => {
    const visible = named.filter((s) => !hidden.has(s.key));
    const allTimes = visible.flatMap((s) => s.points.map((p) => p.t));
    if (!allTimes.length || !svgWidth) return null;

    const step = interval ? intervalMs(interval) : null;
    const firstT = Math.min(...allTimes);
    const lastT = Math.max(...allTimes);
    const domFrom = domain ? Date.parse(domain.from) : NaN;
    const domTo = domain ? Date.parse(domain.to) : NaN;

    // Partial edges: the first bucket starts before the window, the last one
    // ends after it (i.e. is still filling).
    const partial = new Set<number>();
    if (step && partialBuckets !== "show") {
      if (Number.isNaN(domFrom) || firstT < domFrom) partial.add(firstT);
      if (Number.isNaN(domTo) || lastT + step > domTo) partial.add(lastT);
    }
    const trimmed = partialBuckets === "trim" ? partial : new Set<number>();

    // With a uniform interval and "zero" semantics, absent buckets become 0
    // points so hovering them reads 0 rather than "no data".
    const uniform = step !== null && (interval === "minute" || interval === "hour" || interval === "day");
    const fillZero = uniform && emptyBuckets === "zero";

    const prepared = visible.map((s) => {
      let pts = s.points.filter((p) => !trimmed.has(p.t));
      if (fillZero && pts.length > 1 && step) {
        const have = new Map(pts.map((p) => [p.t, p.v]));
        const filled: { t: number; v: number | null }[] = [];
        for (let t = pts[0].t; t <= pts[pts.length - 1].t; t += step) {
          filled.push({ t, v: have.has(t) ? (have.get(t) as number | null) : 0 });
        }
        // Points off the grid (DST, odd alignment) are kept as they came.
        for (const p of pts) if (!filled.some((f) => f.t === p.t)) filled.push(p);
        pts = filled.sort((a, b) => a.t - b.t);
      }
      return { ...s, points: pts };
    });

    const times = Array.from(new Set(prepared.flatMap((s) => s.points.map((p) => p.t)))).sort(
      (a, b) => a - b,
    );
    if (!times.length) return null;

    const values = prepared.flatMap((s) =>
      s.points.map((p) => p.v).filter((v): v is number => v !== null && Number.isFinite(v)),
    );
    if (!values.length) return null;
    const integer = values.every((v) => Number.isInteger(v));

    const chartW = Math.max(1, svgWidth - PAD.left - PAD.right);
    const chartH = height - PAD.top - PAD.bottom;

    // ── y ──
    const maxV = Math.max(...values);
    const minV = Math.min(...values, 0);
    let ticks: number[];
    let toY: (v: number) => number;
    if (scale === "log") {
      ticks = logTicks(maxV);
      const top = logT(ticks[ticks.length - 1]) || 1;
      toY = (v) => PAD.top + chartH - (logT(v) / top) * chartH;
    } else {
      ticks = niceTicks(minV, maxV, 4, integer);
      const lo = ticks[0];
      const hi = ticks[ticks.length - 1];
      toY = (v) => PAD.top + chartH - ((v - lo) / (hi - lo || 1)) * chartH;
    }

    // ── x ── on real time, so an absent bucket leaves a real gap.
    const xMin = Number.isNaN(domFrom) ? times[0] : Math.min(times[0], domFrom);
    const xMax = Number.isNaN(domTo) ? times[times.length - 1] : Math.max(times[times.length - 1], domTo);
    const span = xMax - xMin;
    const toX = (t: number) => (span > 0 ? PAD.left + ((t - xMin) / span) * chartW : PAD.left + chartW / 2);
    const fromX = (x: number) => xMin + ((x - PAD.left) / chartW) * span;

    const plots: SeriesPlot[] = prepared.map((s) => {
      const segments: PlotPoint[][] = [];
      let current: PlotPoint[] = [];
      let prevT: number | null = null;
      for (const p of s.points) {
        const absentBefore =
          step !== null && emptyBuckets === "gap" && prevT !== null && p.t - prevT > step * 1.5;
        if (p.v === null || !Number.isFinite(p.v) || absentBefore) {
          if (current.length) segments.push(current);
          current = [];
        }
        if (p.v !== null && Number.isFinite(p.v)) {
          current.push({ t: p.t, v: p.v, x: toX(p.t), y: toY(p.v) });
        }
        prevT = p.t;
      }
      if (current.length) segments.push(current);
      return {
        key: s.key,
        name: s.name,
        color: s.color,
        segments,
        byTime: new Map(s.points.map((p) => [p.t, p.v])),
      };
    });

    const yLabels = ticks.map((value) => ({ value, y: toY(value) }));

    // x ticks: roughly one per 110px, labelled by time within a day and a half,
    // by date beyond it.
    const xTickCount = Math.max(2, Math.min(8, Math.floor(chartW / 110)));
    const showDate = span > 36 * 3_600_000;
    const xLabels =
      span > 0
        ? Array.from({ length: xTickCount }, (_, i) => {
            const t = xMin + (span * i) / (xTickCount - 1);
            return {
              x: toX(t),
              label: new Date(t).toLocaleString(
                undefined,
                showDate ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" },
              ),
              anchor: (i === 0 ? "start" : i === xTickCount - 1 ? "end" : "middle") as "start" | "end" | "middle",
            };
          })
        : [];

    return {
      plots,
      times,
      partial,
      yLabels,
      xLabels,
      chartH,
      chartW,
      baseY: PAD.top + chartH,
      toX,
      fromX,
      xMin,
      xMax,
    };
  }, [named, hidden, svgWidth, height, interval, emptyBuckets, domain, partialBuckets, scale]);

  const multi = named.length > 1;
  const visibleCount = named.length - hidden.size;

  const pathOf = (pts: PlotPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

  const nearestIndex = (x: number): number | null => {
    if (!chart) return null;
    let best = 0;
    let bestD = Infinity;
    chart.times.forEach((t, i) => {
      const d = Math.abs(chart.toX(t) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const localX = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!onBrush || !chart || e.button !== 0) return;
    const x = Math.max(PAD.left, Math.min(PAD.left + chart.chartW, localX(e)));
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x0: x, x1: x });
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const x = localX(e);
    if (drag) {
      setDrag({ ...drag, x1: Math.max(PAD.left, Math.min(PAD.left + chart.chartW, x)) });
    }
    setKeyboardActive(false);
    setHoveredIndex(nearestIndex(x));
  };

  const handlePointerUp = () => {
    if (!drag || !chart || !onBrush) return;
    const lo = Math.min(drag.x0, drag.x1);
    const hi = Math.max(drag.x0, drag.x1);
    setDrag(null);
    // A click is not a brush.
    if (hi - lo < 6) return;
    onBrush(new Date(chart.fromX(lo)).toISOString(), new Date(chart.fromX(hi)).toISOString());
  };

  const handlePointerLeave = () => {
    if (!drag) setHoveredIndex(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!chart) return;
    const last = chart.times.length - 1;
    const cur = hoveredIndex ?? last;
    let next: number | null = cur;
    switch (e.key) {
      case "ArrowLeft":
        next = Math.max(0, hoveredIndex === null ? last : cur - 1);
        break;
      case "ArrowRight":
        next = Math.min(last, hoveredIndex === null ? last : cur + 1);
        break;
      case "PageUp":
        next = Math.max(0, cur - 10);
        break;
      case "PageDown":
        next = Math.min(last, cur + 10);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Escape":
        next = null;
        break;
      default:
        return;
    }
    e.preventDefault();
    setKeyboardActive(next !== null);
    setHoveredIndex(next);
  };

  const hoveredT = chart && hoveredIndex !== null ? (chart.times[hoveredIndex] ?? null) : null;
  const hoveredX = chart && hoveredT !== null ? chart.toX(hoveredT) : null;
  const tooltipLeft =
    hoveredX === null ? 0 : hoveredX + 190 > svgWidth - PAD.right ? Math.max(0, hoveredX - 194) : hoveredX + 14;

  const readings =
    chart && hoveredT !== null
      ? chart.plots.map((p) => ({ name: p.name, color: p.color, value: p.byTime.get(hoveredT) ?? null }))
      : [];
  const hoveredPartial = chart && hoveredT !== null && chart.partial.has(hoveredT);

  /** One sentence per series — the chart's text alternative. */
  const summary = (() => {
    if (!chart) return `${title}: no data.`;
    const range = `${formatFooterTime(chart.xMin)} to ${formatFooterTime(chart.xMax)}`;
    const parts = chart.plots.slice(0, 4).map((p) => {
      const pts = p.segments.flat();
      if (!pts.length) return `${p.name}: no data.`;
      const peak = pts.reduce((a, b) => (b.v > a.v ? b : a));
      const latest = pts[pts.length - 1];
      return `${p.name}: peak ${formatValue(peak.v)} at ${formatFooterTime(peak.t)}, latest ${formatValue(latest.v)}.`;
    });
    const more = chart.plots.length > 4 ? ` And ${chart.plots.length - 4} more series.` : "";
    return `${title}, ${range}. ${parts.join(" ")}${more}`;
  })();

  const liveText =
    keyboardActive && hoveredT !== null
      ? `${formatTooltipTime(hoveredT)}${hoveredPartial ? " (partial bucket)" : ""}: ${readings
          .map((r) => `${multi ? `${r.name} ` : ""}${r.value === null ? "no data" : formatValue(r.value)}`)
          .join(", ")}`
      : "";

  const gradientId = `grad-${uid}`;
  const showArea = chart?.plots.length === 1;
  const dashedEdges = partialBuckets === "dashed";

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex items-center justify-between gap-2 min-h-[45px]">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {title}
        </h3>
        {(allowLogScale || actions) && (
          <div className="flex items-center gap-1 shrink-0">
            {allowLogScale && (
              <button
                type="button"
                onClick={() => setScale((s) => (s === "log" ? "linear" : "log"))}
                aria-pressed={scale === "log"}
                title={scale === "log" ? "Switch to a linear scale" : "Switch to a logarithmic scale"}
                className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                  scale === "log"
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                }`}
              >
                Log
              </button>
            )}
            {actions}
          </div>
        )}
      </div>

      {multi && !loading && (
        <div
          className="px-4 pt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label={`${title} series`}
        >
          {named.map((s) => {
            const on = !hidden.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                title={on ? `Hide ${s.name}` : `Show ${s.name}`}
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                className={`inline-flex items-center gap-1.5 px-2 py-1 min-h-6 text-xs rounded border transition-colors ${
                  on
                    ? "border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                    : "border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-500 line-through"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: on ? s.color : "transparent", border: `1.5px solid ${s.color}` }}
                />
                <span className="truncate max-w-[12rem]">{s.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <div ref={containerRef} className="px-4 pt-4 pb-2 relative">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <div className="w-6 h-6 border-2 border-zinc-200 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !chart ? (
          <div
            className="flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-500"
            style={{ height }}
          >
            {multi && visibleCount === 0 ? "All series hidden" : "No data available"}
          </div>
        ) : (
          <div
            className="relative rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            tabIndex={0}
            role="group"
            aria-label={`${title} chart. Use the arrow keys to read values.`}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              // Keyboard focus only — a click focuses this too, and the
              // pointer already drives the tooltip.
              if (hoveredIndex === null && e.currentTarget.matches(":focus-visible")) {
                setKeyboardActive(true);
                setHoveredIndex(chart.times.length - 1);
              }
            }}
            onBlur={() => {
              if (keyboardActive) {
                setKeyboardActive(false);
                setHoveredIndex(null);
              }
            }}
          >
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {liveText}
            </div>
            <svg
              width={svgWidth}
              height={height}
              role="img"
              aria-label={summary}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              className="overflow-visible cursor-crosshair block select-none"
              style={onBrush ? { touchAction: "pan-y" } : undefined}
            >
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={singleColor.gradient[0]} />
                  <stop offset="100%" stopColor={singleColor.gradient[1]} />
                </linearGradient>
              </defs>

              {/* Grid lines + Y-axis labels */}
              {chart.yLabels.map((label) => (
                <g key={label.value}>
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
                    className="fill-zinc-500 dark:fill-zinc-400"
                  >
                    {formatValue(label.value)}
                  </text>
                </g>
              ))}

              {/* X-axis labels */}
              {chart.xLabels.map((label, i) => (
                <text
                  key={i}
                  x={label.x}
                  y={chart.baseY + 18}
                  textAnchor={label.anchor}
                  fontSize="11"
                  className="fill-zinc-500 dark:fill-zinc-400"
                >
                  {label.label}
                </text>
              ))}

              {chart.plots.map((plot) => (
                <g key={plot.key}>
                  {plot.segments.map((seg, si) => {
                    // Edge pieces touching a partial bucket are drawn dashed.
                    const first = seg[0];
                    const last = seg[seg.length - 1];
                    const dashFirst = dashedEdges && seg.length > 1 && chart.partial.has(first.t);
                    const dashLast = dashedEdges && seg.length > 1 && chart.partial.has(last.t);
                    const solid = seg.slice(dashFirst ? 1 : 0, dashLast ? seg.length - 1 : seg.length);
                    return (
                      <g key={si}>
                        {showArea && seg.length > 1 && (
                          <path
                            d={`${pathOf(seg)} L ${last.x.toFixed(2)} ${chart.baseY} L ${first.x.toFixed(2)} ${chart.baseY} Z`}
                            fill={`url(#${gradientId})`}
                          />
                        )}
                        {solid.length > 1 && (
                          <path
                            d={pathOf(solid)}
                            fill="none"
                            stroke={plot.color}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        {dashFirst && (
                          <path
                            d={pathOf(seg.slice(0, 2))}
                            fill="none"
                            stroke={plot.color}
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                            opacity="0.6"
                          />
                        )}
                        {dashLast && (
                          <path
                            d={pathOf(seg.slice(-2))}
                            fill="none"
                            stroke={plot.color}
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                            opacity="0.6"
                          />
                        )}
                        {/* A lone bucket between gaps has no line to sit on. */}
                        {seg.length === 1 && (
                          <circle cx={first.x} cy={first.y} r="3" fill={plot.color} />
                        )}
                      </g>
                    );
                  })}
                </g>
              ))}

              {/* Brush selection */}
              {drag && Math.abs(drag.x1 - drag.x0) > 0 && (
                <rect
                  x={Math.min(drag.x0, drag.x1)}
                  y={PAD.top}
                  width={Math.abs(drag.x1 - drag.x0)}
                  height={chart.chartH}
                  className="fill-blue-500/15 stroke-blue-500"
                  strokeWidth="1"
                />
              )}

              {/* Hover indicator */}
              {hoveredX !== null && (
                <g>
                  <line
                    x1={hoveredX}
                    y1={PAD.top}
                    x2={hoveredX}
                    y2={chart.baseY}
                    stroke="currentColor"
                    className="text-zinc-400 dark:text-zinc-500"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {chart.plots.map((plot) => {
                    const pt = plot.segments.flat().find((p) => p.t === hoveredT);
                    return pt ? (
                      <circle
                        key={plot.key}
                        cx={pt.x}
                        cy={pt.y}
                        r="4"
                        fill={plot.color}
                        stroke="white"
                        strokeWidth="1.5"
                      />
                    ) : null;
                  })}
                </g>
              )}
            </svg>

            {/* Tooltip */}
            {hoveredT !== null && !drag && (
              <div
                className="absolute z-20 px-2.5 py-2 text-xs bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg shadow-lg pointer-events-none max-w-[180px]"
                style={{ left: tooltipLeft, top: PAD.top }}
                aria-hidden="true"
              >
                <div className="text-zinc-300 dark:text-zinc-600 mb-1">
                  {formatTooltipTime(hoveredT)}
                  {hoveredPartial && <span className="block italic">Partial bucket</span>}
                </div>
                {readings.map((r) => (
                  <div key={r.name} className="flex items-center gap-1.5">
                    {multi && (
                      <span
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: r.color }}
                      />
                    )}
                    {multi && <span className="truncate">{r.name}</span>}
                    <span className={`font-semibold tabular-nums ${multi ? "ml-auto pl-2" : ""}`}>
                      {r.value === null ? "no data" : formatValue(r.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* The data itself, for screen readers. */}
            <table className="sr-only">
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  {chart.plots.map((p) => (
                    <th key={p.key} scope="col">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.times.map((t) => (
                  <tr key={t}>
                    <th scope="row">
                      {formatFooterTime(t)}
                      {chart.partial.has(t) ? " (partial)" : ""}
                    </th>
                    {chart.plots.map((p) => {
                      const v = p.byTime.get(t);
                      return <td key={p.key}>{v === null || v === undefined ? "no data" : formatValue(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {chart && (
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{formatFooterTime(chart.xMin)}</span>
          {dashedEdges && chart.partial.size > 0 && (
            <span className="hidden sm:inline">Dashed: partial bucket</span>
          )}
          {onBrush && <span className="hidden sm:inline">Drag to zoom</span>}
          <span>{formatFooterTime(chart.xMax)}</span>
        </div>
      )}
    </div>
  );
}
