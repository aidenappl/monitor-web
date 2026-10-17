import { AnalyticsFilter, SavedDashboard, WidgetConfig } from "@/types";
import { TIME_RANGES, TimeRange, rangeFromParam } from "@/tools/timeRange.tools";

/**
 * How much of the row a widget takes on a wide screen. Stored per widget in the
 * dashboard config; a widget saved before sizes existed reads `defaultSize`.
 *
 * The grid is 12 columns with `grid-flow-row-dense`, so quarter-width stat
 * cards pack beside each other instead of each one sitting alone next to a
 * 250px chart with 165px of nothing under it.
 */
export type WidgetSize = "sm" | "md" | "lg";

export const WIDGET_SIZES: { value: WidgetSize; label: string }[] = [
  { value: "sm", label: "Quarter" },
  { value: "md", label: "Half" },
  { value: "lg", label: "Full" },
];

/**
 * A widget as this page stores it: the shared `WidgetConfig` plus the
 * dashboard-only fields. Kept local — `types/index.ts` is shared, and nothing
 * outside the dashboard reads these.
 */
export type DashboardWidget = WidgetConfig & {
  size?: WidgetSize;
  /**
   * A range this widget always reads over, in `rangeToParam` form ("30d"),
   * whatever the dashboard's range says. Absent = follow the dashboard.
   */
  range_override?: string;
};

export function defaultSize(widget: WidgetConfig): WidgetSize {
  return widget.type === "gauge" || widget.type === "compare" ? "sm" : "md";
}

/** Literal class strings, so Tailwind's scanner sees every one of them. */
export function sizeClass(size: WidgetSize): string {
  switch (size) {
    case "sm":
      return "md:col-span-6 xl:col-span-3";
    case "md":
      return "md:col-span-6";
    case "lg":
      return "md:col-span-12";
  }
}

/** The widget's pinned range, or null when it follows the dashboard. */
export function widgetRange(widget: DashboardWidget): TimeRange | null {
  return widget.range_override ? rangeFromParam(widget.range_override) : null;
}

export const DEFAULT_RANGE: TimeRange = TIME_RANGES[2];

export interface DashboardVariable {
  name: string;
  label: string;
  source: "service" | "env" | "level";
  value: string;
}

/**
 * What a dashboard's `config` string holds. `range` and `filters` are the
 * dashboard's saved default view — absent on dashboards saved before they were
 * stored, which then open on 24h with no filters, as they always did.
 */
export interface DashboardConfig {
  widgets: DashboardWidget[];
  variables: DashboardVariable[];
  range?: string;
  filters?: AnalyticsFilter[];
}

/** monitor-core's optimistic-concurrency counter, when it sends one. */
export type VersionedDashboard = SavedDashboard & { version?: number };

/** Throws on anything that is not a JSON object; callers decide what that means. */
export function parseConfigStrict(config: string): DashboardConfig {
  const parsed: unknown = JSON.parse(config);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Dashboard config is not a JSON object");
  }
  const p = parsed as Partial<DashboardConfig>;
  return {
    widgets: Array.isArray(p.widgets) ? p.widgets : [],
    variables: Array.isArray(p.variables) ? p.variables : [],
    range: typeof p.range === "string" ? p.range : undefined,
    filters: Array.isArray(p.filters) ? p.filters : undefined,
  };
}

// ── Export / import ─────────────────────────────────────────────────────────

/** Marks a file as one of ours, so an import can refuse an unrelated JSON blob. */
const EXPORT_KIND = "monitor.dashboard";
const EXPORT_VERSION = 1;

export interface DashboardExport {
  kind: typeof EXPORT_KIND;
  version: typeof EXPORT_VERSION;
  name: string;
  description: string;
  config: DashboardConfig;
}

/**
 * The portable form of a dashboard: name, description and config, and nothing
 * that belongs to the install it came from — no id, no timestamps, no project.
 * Importing it into another zone or project creates a NEW dashboard there.
 */
export function exportDashboard(name: string, description: string, config: DashboardConfig): string {
  const doc: DashboardExport = { kind: EXPORT_KIND, version: EXPORT_VERSION, name, description, config };
  return JSON.stringify(doc, null, 2);
}

const WIDGET_TYPES = new Set(["gauge", "timeseries", "topn", "compare"]);

/**
 * Parses an export. Returns a message rather than throwing, because the only
 * thing a caller does with a failure is show it next to the textarea.
 *
 * Widget ids are re-minted: an imported widget sharing an id with one already
 * on screen would share its request generation and its fetched data.
 */
export function parseDashboardImport(text: string): { ok: true; value: DashboardExport } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== EXPORT_KIND) {
    return { ok: false, error: "That is not a Monitor dashboard export." };
  }
  const doc = raw as Partial<DashboardExport>;
  if (typeof doc.name !== "string" || !doc.name.trim()) {
    return { ok: false, error: "The export has no dashboard name." };
  }
  let config: DashboardConfig;
  try {
    config = parseConfigStrict(JSON.stringify(doc.config ?? {}));
  } catch {
    return { ok: false, error: "The export's config is not an object." };
  }
  const bad = config.widgets.find(
    (w) => !w || typeof w !== "object" || !WIDGET_TYPES.has((w as { type?: unknown }).type as string),
  );
  if (bad) return { ok: false, error: "The export contains a widget of an unknown type." };
  const stamp = Date.now();
  config = {
    ...config,
    widgets: config.widgets.map((w, i) => ({ ...w, id: `widget-${stamp}-${i}`, filters: Array.isArray(w.filters) ? w.filters : [] })),
  };
  return {
    ok: true,
    value: {
      kind: EXPORT_KIND,
      version: EXPORT_VERSION,
      name: doc.name.trim(),
      description: typeof doc.description === "string" ? doc.description : "",
      config,
    },
  };
}
