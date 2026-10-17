import toast from "react-hot-toast";
import type { AnalyticsFilter, TimeSeriesSeries } from "@/types";

/**
 * Context written alongside the rows: which range, interval and filters
 * produced them. An export without it is a column of numbers nobody can place
 * a week later — two exports of different ranges were indistinguishable.
 */
export type ExportMeta = Record<string, unknown>;

export interface ExportOptions {
    /**
     * CSV: written as leading `# key: value` comment lines.
     * JSON: the file becomes `{ meta, data }` instead of a bare array.
     * Omitted → the file is exactly the rows, as before.
     */
    meta?: ExportMeta;
}

/**
 * Says so when there is nothing to export. Returning early in silence left an
 * enabled button that did nothing at all when clicked.
 */
function nothingToExport(data: Record<string, unknown>[]): boolean {
    if (data.length > 0) return false;
    toast.error("No data to export for this range and filters.");
    return true;
}

/** Returns false (after a toast) when there was nothing to export. */
export function exportToCSV(
    data: Record<string, unknown>[],
    filename: string,
    options: ExportOptions = {},
): boolean {
    if (nothingToExport(data)) return false;

    const headers = Array.from(
        data.reduce<Set<string>>((keys, row) => {
            Object.keys(row).forEach((k) => keys.add(k));
            return keys;
        }, new Set())
    );

    const escapeCSV = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        const str = typeof value === "object" ? JSON.stringify(value) : String(value);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const metaLines = Object.entries(options.meta ?? {}).map(([k, v]) => {
        const str = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
        return `# ${k}: ${str.replace(/\n/g, " ")}`;
    });

    const lines = [
        ...metaLines,
        headers.join(","),
        ...data.map((row) => headers.map((h) => escapeCSV(row[h])).join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
    return true;
}

/** Returns false (after a toast) when there was nothing to export. */
export function exportToJSON(
    data: Record<string, unknown>[],
    filename: string,
    options: ExportOptions = {},
): boolean {
    if (nothingToExport(data)) return false;

    const body = options.meta ? { meta: options.meta, data } : data;
    // An `undefined` property is dropped by JSON.stringify, so a row whose
    // `series` was unnamed lost the key outright. Keep every key as null.
    const blob = new Blob([JSON.stringify(body, (_k, v) => (v === undefined ? null : v), 2)], {
        type: "application/json;charset=utf-8;",
    });
    triggerDownload(blob, filename.endsWith(".json") ? filename : `${filename}.json`);
    return true;
}

/**
 * Flattens time series into export rows, one per point, with `series` always
 * filled. monitor-core leaves an ungrouped series unnamed, which exported as an
 * empty column; it takes `fallbackName` (e.g. "events"), and further unnamed
 * series are numbered after it.
 */
export function seriesExportRows(
    series: TimeSeriesSeries[],
    fallbackName: string,
): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    series.forEach((s, i) => {
        const name = s.name || (i === 0 ? fallbackName : `${fallbackName} ${i + 1}`);
        for (const dp of s.data_points) {
            rows.push({ series: name, timestamp: dp.timestamp, value: dp.value });
        }
    });
    return rows;
}

/** The standard meta block for an analytics export. */
export function analyticsExportMeta(args: {
    from: string;
    to: string;
    interval?: string;
    filters?: AnalyticsFilter[];
    range?: string;
}): ExportMeta {
    return {
        ...(args.range ? { range: args.range } : {}),
        from: args.from,
        to: args.to,
        ...(args.interval ? { interval: args.interval } : {}),
        filters: args.filters ?? [],
        exported_at: new Date().toISOString(),
    };
}

/**
 * `events-24h-2026-10-16T2240Z`: the range label and the export time in the
 * name, so successive exports neither overwrite each other nor lose which
 * window they came from. `rangeLabel` is a spec ("24h") or any short string;
 * unsafe filename characters become "-".
 */
export function exportFilename(base: string, rangeLabel: string, now: Date = new Date()): string {
    const stamp = now.toISOString().slice(0, 16).replace(/:/g, "") + "Z";
    const safe = rangeLabel.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return [base, safe, stamp].filter(Boolean).join("-");
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
