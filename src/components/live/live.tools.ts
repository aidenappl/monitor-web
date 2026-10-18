import type { Event } from "@/types";

/**
 * Pure helpers for the live tail (`[zone]/live/page.tsx`). No React, no I/O.
 */

/** The most rows the tail keeps on screen, and the most it holds while paused. */
export const MAX_BUFFER = 500;

/**
 * One received frame.
 *
 * ⚠️ `id` IS THE ROW KEY, AND IT MUST BE MINTED ON RECEIPT. Events carry no id
 * of their own, and the tail used to key rows on `…-${index}` — so every arrival
 * shifted every index, every row remounted, and an expanded payload snapped shut
 * within a second or two on a busy zone. A per-page counter is stable for the
 * life of the row, which is all a key needs.
 */
export interface LiveEvent {
    id: number;
    event: Event;
    /** Event time (ms). Falls back to `receivedAt` for an unparseable timestamp. */
    t: number;
    receivedAt: number;
    /** Normalised once: lower-case, a missing level is `info`. */
    level: string;
}

export function toLiveEvent(event: Event, id: number, receivedAt = Date.now()): LiveEvent {
    const parsed = Date.parse(event.timestamp);
    return {
        id,
        event,
        t: Number.isNaN(parsed) ? receivedAt : parsed,
        receivedAt,
        level: normaliseLevel(event.level),
    };
}

// ─── Levels ─────────────────────────────────────────────────────────────────

/**
 * A missing level reads as `info` — and is COLOURED as info. It used to say
 * "info" in debug grey, and every level the map did not know (`critical`,
 * `notice`) also fell through to grey, so a critical event looked harmless.
 */
export function normaliseLevel(level?: string): string {
    const l = level?.trim().toLowerCase();
    return l ? l : "info";
}

const LEVEL_CLASS: Record<string, string> = {
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    notice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    debug: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    trace: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const SEVERE = new Set(["fatal", "critical", "crit", "alert", "emergency", "emerg", "panic"]);
const SEVERE_CLASS = "bg-red-600 text-white dark:bg-red-700 dark:text-white";
/** Unknown levels: neutral, but outlined so they never pass for debug. */
const UNKNOWN_CLASS =
    "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300";

export function levelBadgeClass(level: string): string {
    if (SEVERE.has(level)) return SEVERE_CLASS;
    return LEVEL_CLASS[level] ?? UNKNOWN_CLASS;
}

export type LevelBand = "error" | "warn" | "other";

/** The three bands the rate sparkline stacks. */
export function levelBand(level: string): LevelBand {
    if (level === "error" || SEVERE.has(level)) return "error";
    if (level === "warn" || level === "warning") return "warn";
    return "other";
}

// ─── Time ───────────────────────────────────────────────────────────────────

export type TimeZoneMode = "local" | "utc";
export const TIME_ZONE_MODES = ["local", "utc"] as const;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * `HH:mm:ss.SSS`, 24-hour, in local time or UTC. The locale 12-hour form with
 * milliseconds ("03:41:06.882 PM") was ambiguous across zones and wide enough to
 * crush the event name at phone width.
 */
export function formatClock(t: number, mode: TimeZoneMode): string {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "—";
    return mode === "utc"
        ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
        : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `HH:mm:ss` for markers ("stream stopped at …"). */
export function formatClockShort(t: number, mode: TimeZoneMode): string {
    return formatClock(t, mode).slice(0, 8);
}

/** The short zone label shown beside the toggle: "UTC" or e.g. "PDT". */
export function localZoneLabel(): string {
    try {
        const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
            .formatToParts(new Date())
            .find((p) => p.type === "timeZoneName");
        return part?.value ?? "Local";
    } catch {
        // Intl without timeZoneName support — the generic label is still true.
        return "Local";
    }
}

/** "4m 12s", "38s", "1h 3m". */
export function formatSpan(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${pad(s % 60)}s`;
    return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

// ─── Ordering ───────────────────────────────────────────────────────────────

/** Newest event time first; among equal times, the later arrival first. */
function newerFirst(a: LiveEvent, b: LiveEvent): number {
    return b.t - a.t || b.id - a.id;
}

/**
 * Merge a batch into a buffer already sorted newest-first, keeping the newest
 * `cap` by EVENT time.
 *
 * Rows used to be in arrival order, so services with skewed clocks or batching
 * SDKs interleaved (35.550 above 35.536) in a view whose only axis is time. A
 * linear merge is cheap at this size and keeps the buffer sorted invariantly.
 */
export function mergeNewestFirst(buffer: LiveEvent[], batch: LiveEvent[], cap = MAX_BUFFER): LiveEvent[] {
    if (batch.length === 0) return buffer;
    const incoming = [...batch].sort(newerFirst);
    const out: LiveEvent[] = [];
    let i = 0;
    let j = 0;
    while (out.length < cap && (i < buffer.length || j < incoming.length)) {
        if (j >= incoming.length || (i < buffer.length && newerFirst(buffer[i], incoming[j]) <= 0)) {
            out.push(buffer[i++]);
        } else {
            out.push(incoming[j++]);
        }
    }
    return out;
}

// ─── Stream filters ─────────────────────────────────────────────────────────

export interface StreamFilters {
    service: string;
    level: string;
    name: string;
}

/**
 * The server-side subscription filters, applied client-side to what is already
 * buffered. Changing a filter re-subscribes the stream, but the old rows used to
 * stay — an `error` filter over 148 info rows reads as errors labelled "info".
 */
export function matchesStreamFilters(le: LiveEvent, f: StreamFilters): boolean {
    if (f.service && le.event.service !== f.service) return false;
    if (f.level && le.level !== f.level.toLowerCase()) return false;
    if (f.name && le.event.name !== f.name) return false;
    return true;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchToken {
    /** `status_code` in `status_code:500`; absent for free text. */
    key?: string;
    value: string;
}

/**
 * Whitespace-separated, all must match. `key:value` targets one field — a top
 * level field (`service`, `trace_id`, …) or a payload path (`status_code`,
 * `data.response.status`).
 */
export function parseSearch(q: string): SearchToken[] {
    return q
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => {
            const i = raw.indexOf(":");
            if (i > 0 && i < raw.length - 1) {
                return { key: raw.slice(0, i).replace(/^data\./, ""), value: raw.slice(i + 1) };
            }
            return { value: raw };
        });
}

/** The free-text terms, for highlighting the visible fields. */
export function freeTerms(tokens: SearchToken[]): string[] {
    return tokens.filter((t) => !t.key).map((t) => t.value);
}

const HEADER_FIELDS = ["service", "name", "level"] as const;
const ID_FIELDS = ["env", "trace_id", "request_id", "user_id", "job_id"] as const;

const flatCache = new WeakMap<LiveEvent, [string, string][]>();

/** `[path, value]` pairs for the payload, lower-cased paths, capped. */
function flatten(le: LiveEvent): [string, string][] {
    const cached = flatCache.get(le);
    if (cached) return cached;
    const out: [string, string][] = [];
    const walk = (v: unknown, path: string, depth: number) => {
        if (out.length >= 300) return;
        if (v !== null && typeof v === "object" && depth < 6) {
            for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
                walk(child, path ? `${path}.${k}` : k, depth + 1);
            }
            return;
        }
        out.push([path, typeof v === "string" ? v : JSON.stringify(v) ?? String(v)]);
    };
    if (le.event.data) walk(le.event.data, "", 0);
    flatCache.set(le, out);
    return out;
}

export interface SearchMatch {
    /**
     * Where a match the row does not show came from — `data.method: POST`. Without
     * it a search for "POST" returned 56 rows all reading `http.request.end`.
     */
    snippet: string | null;
}

/**
 * Free text matches the VALUES of the visible fields, the id fields and the
 * payload — never payload KEYS. Matching keys is why "method" used to match
 * every request row. Keys are reachable with `key:value`.
 */
export function matchSearch(le: LiveEvent, tokens: SearchToken[]): SearchMatch | null {
    let snippet: string | null = null;
    const e = le.event;
    for (const tok of tokens) {
        if (tok.key) {
            const top = (HEADER_FIELDS as readonly string[]).concat(ID_FIELDS).includes(tok.key)
                ? tok.key === "level"
                    ? le.level
                    : (e[tok.key as keyof typeof e] as string | undefined)
                : undefined;
            if (top !== undefined) {
                if (!String(top).toLowerCase().includes(tok.value)) return null;
                if (!(HEADER_FIELDS as readonly string[]).includes(tok.key)) snippet ??= `${tok.key}: ${top}`;
                continue;
            }
            const hit = flatten(le).find(
                ([p, v]) =>
                    (p.toLowerCase() === tok.key || p.toLowerCase().endsWith(`.${tok.key}`)) &&
                    v.toLowerCase().includes(tok.value),
            );
            if (!hit) return null;
            snippet ??= `data.${hit[0]}: ${hit[1]}`;
            continue;
        }
        if (`${e.service} ${e.name} ${le.level}`.toLowerCase().includes(tok.value)) continue;
        const id = ID_FIELDS.find((f) => e[f]?.toLowerCase().includes(tok.value));
        if (id) {
            snippet ??= `${id}: ${e[id]}`;
            continue;
        }
        const hit = flatten(le).find(([, v]) => v.toLowerCase().includes(tok.value));
        if (!hit) return null;
        snippet ??= `data.${hit[0]}: ${hit[1]}`;
    }
    return { snippet };
}

// ─── Rate ───────────────────────────────────────────────────────────────────

export const RATE_WINDOW_SECONDS = 60;

export interface RateBucket {
    error: number;
    warn: number;
    other: number;
}

/**
 * Frames per second, by level band, for the header's rate meter. Counts every
 * frame the stream delivers — paused or not — because "is it quiet or is it
 * broken?" is a question about the stream, not about what is on screen.
 *
 * A plain mutable object rather than React state: it is written on every frame
 * and read once a second by the meter's own tick.
 */
export function createRateTracker() {
    const buckets = new Map<number, RateBucket>();
    let lastAt: number | null = null;
    return {
        record(level: string, now = Date.now()) {
            const sec = Math.floor(now / 1000);
            let b = buckets.get(sec);
            if (!b) {
                b = { error: 0, warn: 0, other: 0 };
                buckets.set(sec, b);
                for (const k of buckets.keys()) {
                    if (k < sec - RATE_WINDOW_SECONDS - 1) buckets.delete(k);
                }
            }
            b[levelBand(level)]++;
            lastAt = now;
        },
        /** Oldest → newest, one bucket per second, ending with the CURRENT second. */
        series(now = Date.now()): RateBucket[] {
            const sec = Math.floor(now / 1000);
            const out: RateBucket[] = [];
            for (let s = sec - RATE_WINDOW_SECONDS + 1; s <= sec; s++) {
                out.push(buckets.get(s) ?? { error: 0, warn: 0, other: 0 });
            }
            return out;
        },
        lastAt: () => lastAt,
    };
}

export type RateTracker = ReturnType<typeof createRateTracker>;

/** Events/s over the last `seconds` COMPLETE seconds of a series. */
export function averageRate(series: RateBucket[], seconds = 10): number {
    const window = series.slice(-seconds - 1, -1);
    if (window.length === 0) return 0;
    const total = window.reduce((n, b) => n + b.error + b.warn + b.other, 0);
    return total / window.length;
}
