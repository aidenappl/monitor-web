import { TimeSeriesInterval } from "@/types";

export interface TimeRange {
    from: string;
    to: string;
    label: string;
}

export const TIME_RANGES: TimeRange[] = [
    { label: "Last 1 hour", from: "1h", to: "now" },
    { label: "Last 6 hours", from: "6h", to: "now" },
    { label: "Last 24 hours", from: "24h", to: "now" },
    { label: "Last 7 days", from: "7d", to: "now" },
    { label: "Last 30 days", from: "30d", to: "now" },
];

export const TIME_RANGE_LABELS: Record<string, string> = {
    "1h": "1h",
    "6h": "6h",
    "24h": "24h",
    "7d": "7d",
    "30d": "30d",
};

export function getTimeRange(range: TimeRange): { from: string; to: string } {
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

export function getIntervalForRange(range: TimeRange): TimeSeriesInterval {
    if (range.from === "1h") return "minute";
    if (range.from === "6h" || range.from === "24h") return "hour";
    if (range.from === "7d") return "hour";
    return "day";
}
