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

/** A relative window spec: a count and a unit — `h` hours, `d` days, `m` months. */
const SPEC_PATTERN = /^(\d+)([hdm])$/;

/**
 * The start of a relative window ending at `now`. An unparseable spec falls back
 * to 24 hours, which is what every caller of this maths has always done.
 */
function rangeStart(spec: string, now: Date): Date {
    const from = new Date(now);
    const match = spec.match(SPEC_PATTERN);
    if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];
        if (unit === "h") from.setHours(from.getHours() - value);
        else if (unit === "d") from.setDate(from.getDate() - value);
        else if (unit === "m") from.setMonth(from.getMonth() - value);
    } else {
        from.setHours(from.getHours() - 24);
    }
    return from;
}

export function getTimeRange(range: TimeRange): { from: string; to: string } {
    const now = new Date();
    if (isCustomRange(range)) {
        return { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() };
    }
    return { from: rangeStart(range.from, now).toISOString(), to: now.toISOString() };
}

// ── Custom (absolute) ranges ────────────────────────────────────────────────
//
// A custom range is a TimeRange whose `from` and `to` are both ISO timestamps
// rather than a spec and "now". The shape is the same on purpose: every page
// already threads a TimeRange through `getTimeRange` / `getIntervalForRange`,
// so an absolute window flows through them unchanged.
//
// ⚠️ THIS IS NOT THE "STORED TIMESTAMP" BUG `relativeFrom` WARNS ABOUT. That bug
// is resolving a RELATIVE window and freezing the result. An absolute range is
// absolute because the user asked for one — "yesterday 13:00–14:00" is meant
// to stay put under AutoRefresh.

/** True when `range` is an absolute from/to window rather than a "last N" preset. */
export function isCustomRange(range: TimeRange): boolean {
    return !SPEC_PATTERN.test(range.from) && !Number.isNaN(Date.parse(range.from)) && range.to !== "now";
}

function formatRangeEdge(d: Date, withDate: boolean): string {
    return d.toLocaleString(undefined, {
        ...(withDate ? { month: "short", day: "numeric" } : {}),
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * Builds a custom range. Returns null for an unparseable edge or an empty or
 * inverted window — callers show that as a validation error, never a query.
 */
export function customRange(from: Date | string, to: Date | string): TimeRange | null {
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f >= t) return null;
    const sameDay = f.toDateString() === t.toDateString();
    return {
        from: f.toISOString(),
        to: t.toISOString(),
        label: `${formatRangeEdge(f, true)} – ${formatRangeEdge(t, !sameDay)}`,
    };
}

/** Duration of a range in ms. Reads the clock for a preset; don't call it during render. */
export function rangeDurationMs(range: TimeRange, now: Date = new Date()): number {
    const { from, to } = isCustomRange(range)
        ? { from: new Date(range.from), to: new Date(range.to) }
        : { from: rangeStart(range.from, now), to: now };
    return to.getTime() - from.getTime();
}

/** Separates the two edges of a custom range in its URL form. ISO timestamps never contain it. */
const RANGE_PARAM_SEPARATOR = "..";

/**
 * The URL form of a range: the spec for a preset (`24h`), or
 * `<fromISO>..<toISO>` for a custom one. One param, so a page's URL state has
 * one key to keep rather than two that can disagree.
 */
export function rangeToParam(range: TimeRange): string {
    if (isCustomRange(range)) return `${range.from}${RANGE_PARAM_SEPARATOR}${range.to}`;
    return range.from;
}

/**
 * Parses `rangeToParam`'s output. A preset spec resolves to its TIME_RANGES
 * entry (so `label` comparisons keep working); anything malformed is null and
 * the caller falls back to its default range.
 */
export function rangeFromParam(value: string | null | undefined): TimeRange | null {
    if (!value) return null;
    const preset = TIME_RANGES.find((r) => r.from === value);
    if (preset) return preset;
    const parts = value.split(RANGE_PARAM_SEPARATOR);
    if (parts.length !== 2) return null;
    return customRange(parts[0], parts[1]);
}

/** Raw events expire after this many days; the occurrence rollup does not. */
export const EVENT_RETENTION_DAYS = 30;

/**
 * True when the window BEFORE `range` (what a compare query reads as the
 * previous period) starts past event retention, so its count is partly or
 * wholly missing rather than low. A 30d compare reads 30–60 days ago, which is
 * all expired — and an honest-looking "0" from it reads as "no change".
 */
export function previousPeriodBeyondRetention(range: TimeRange, now: Date = new Date()): boolean {
    const duration = rangeDurationMs(range, now);
    const { from } = isCustomRange(range)
        ? { from: new Date(range.from) }
        : { from: rangeStart(range.from, now) };
    const previousStart = from.getTime() - duration;
    return now.getTime() - previousStart > EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * relativeFrom turns a window spec ("1h", "24h", "7d"…) into the ISO `from` of
 * that window as of now, with no `to` — monitor-core reads an absent `to` as
 * "up to now".
 *
 * ⚠️ CALL IT WHEN THE REQUEST IS MADE, NEVER EARLIER. Resolving a relative window
 * to an absolute timestamp and STORING the result is the bug this exists to
 * avoid. The obvious way to bound the events table — have the range buttons
 * write `from`/`to` into its filters — does exactly that, and a stored `from`
 * freezes the window: AutoRefresh and the Refresh button re-ask for the same
 * past span and new events never appear. A saved view would also persist the
 * timestamp, so reopening it next week shows last week. Keep the SPEC in state;
 * resolve it here, inside the fetch.
 *
 * Reads the clock, so it must not run during render (react-hooks `purity`).
 */
export function relativeFrom(spec: string, now: Date = new Date()): string {
    return rangeStart(spec, now).toISOString();
}

/** What a suggestion read is for — each kind has its own default window. */
export type SuggestionKind = "labels" | "keys" | "values";

/**
 * How far back a suggestion read looks when the page has no range of its own.
 *
 * ⚠️ THESE USED TO BE "ALL OF IT", and that was the events page's cost. With no
 * `from`, each label read scanned the project's whole 30-day retention and the
 * data-keys read JSON-parsed every row in it (2.6 s in production) — on every
 * page load, for dropdowns nobody had opened yet. Labels change slowly, so a week
 * finds every live service and level; data keys and values are per-event shapes
 * and a day of them is what the operator is filtering on.
 */
export const SUGGESTION_WINDOWS: Record<SuggestionKind, string> = {
    labels: "7d",
    keys: "24h",
    values: "24h",
};

/**
 * suggestionWindow returns the window SPEC a suggestion read should use: the
 * page's selected range when it has one, otherwise the default for `kind`.
 *
 * Returns the spec, not a timestamp — see `relativeFrom` for why. Pure, so it is
 * safe to call during render and to use as an effect dependency.
 */
export function suggestionWindow(kind: SuggestionKind, range?: TimeRange): string {
    if (range && SPEC_PATTERN.test(range.from)) return range.from;
    return SUGGESTION_WINDOWS[kind];
}

/**
 * withSelected returns `options` with `selected` put first when it is set and
 * not already in the list, so a controlled `<select>` can always show its own
 * value.
 *
 * ⚠️ A WINDOWED LIST DOES NOT HOLD EVERY VALUE A FILTER CAN HOLD. A saved
 * dashboard variable, a service picked at 7d before switching to 1h, a saved
 * view's level: each can name a value with no events in the current window. A
 * controlled `<select>` whose value matches no `<option>` DISPLAYS the first
 * option ("All") while the filter is still applied, so every panel renders empty
 * under a control that says nothing is filtered, and it reads as a project with
 * no data. Render every `<select>` fed by a suggestion read through this.
 */
export function withSelected(options: string[], selected: string | null | undefined): string[] {
    return selected && !options.includes(selected) ? [selected, ...options] : options;
}

export function getIntervalForRange(range: TimeRange): TimeSeriesInterval {
    if (isCustomRange(range)) {
        // Pure: a custom range's duration needs no clock.
        const hours = (Date.parse(range.to) - Date.parse(range.from)) / 3_600_000;
        if (hours <= 2) return "minute";
        if (hours <= 24 * 8) return "hour";
        return "day";
    }
    if (range.from === "1h") return "minute";
    if (range.from === "6h" || range.from === "24h") return "hour";
    if (range.from === "7d") return "hour";
    return "day";
}

/**
 * Nominal width of one bucket. `month` is an approximation (30 days) — fine for
 * spotting a missing or partial bucket, wrong for calendar arithmetic.
 */
export function intervalMs(interval: TimeSeriesInterval): number {
    switch (interval) {
        case "minute":
            return 60_000;
        case "hour":
            return 3_600_000;
        case "day":
            return 86_400_000;
        case "week":
            return 7 * 86_400_000;
        case "month":
            return 30 * 86_400_000;
    }
}
