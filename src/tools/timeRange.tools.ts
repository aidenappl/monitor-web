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
    return { from: rangeStart(range.from, now).toISOString(), to: now.toISOString() };
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
    if (range.from === "1h") return "minute";
    if (range.from === "6h" || range.from === "24h") return "hour";
    if (range.from === "7d") return "hour";
    return "day";
}
