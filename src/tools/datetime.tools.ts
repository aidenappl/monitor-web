import { useSyncExternalStore } from "react";

/**
 * Date/time display preferences — timezone and format — and the formatter that
 * applies them.
 *
 *   const prefs = useDateTimePrefs();
 *   formatDateTime(row.created_at, prefs);                 // "Oct 16, 2026, 5:18 PM"
 *   formatDateTime(row.created_at, prefs, { dateOnly: true });
 *
 * WHY: timestamps used to follow the browser's zone with `en-US` hardcoded, so
 * an on-call engineer comparing the dashboard against a server log in UTC had
 * to do the conversion in their head, at 3am.
 *
 * Stored CLIENT-SIDE (localStorage, `mon-datetime-prefs`), per browser — there
 * is no server-side preferences record. Set on /settings → Preferences.
 *
 * Adopting it elsewhere: call `useDateTimePrefs()` in the component and pass the
 * result to `formatDateTime`. The hook re-renders on a change made in this tab
 * or another one. ⚠️ During SSR and the first client render it returns the
 * DEFAULTS (the server cannot read localStorage), so a server-rendered timestamp
 * is in the browser's zone until hydration completes.
 */

export type DateFormat = "locale" | "iso";
export type HourCycle = "12" | "24";

export interface DateTimePrefs {
    /** "local" (the browser's zone), "UTC", or an IANA name like "Europe/London". */
    timeZone: string;
    /** "locale" = "Oct 16, 2026, 5:18 PM"; "iso" = "2026-10-16 17:18". */
    format: DateFormat;
    /** Ignored by the ISO format, which is always 24-hour. */
    hourCycle: HourCycle;
}

export const DEFAULT_DATETIME_PREFS: DateTimePrefs = {
    timeZone: "local",
    format: "locale",
    hourCycle: "12",
};

const STORAGE_KEY = "mon-datetime-prefs";
// `storage` fires only in OTHER tabs; this one announces its own writes.
const CHANGE_EVENT = "mon-datetime-prefs-change";

/** True when the runtime accepts this IANA zone name. */
export function isValidTimeZone(tz: string): boolean {
    if (tz === "local" || tz === "UTC") return true;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function parse(raw: string | null): DateTimePrefs {
    if (!raw) return DEFAULT_DATETIME_PREFS;
    try {
        const v = JSON.parse(raw) as Partial<DateTimePrefs>;
        return {
            timeZone:
                typeof v.timeZone === "string" && isValidTimeZone(v.timeZone)
                    ? v.timeZone
                    : DEFAULT_DATETIME_PREFS.timeZone,
            format: v.format === "iso" ? "iso" : "locale",
            hourCycle: v.hourCycle === "24" ? "24" : "12",
        };
    } catch {
        // A hand-edited or corrupt value: fall back to the defaults rather than
        // render every timestamp on the page as "Invalid Date".
        return DEFAULT_DATETIME_PREFS;
    }
}

// useSyncExternalStore needs a referentially stable snapshot, so the parsed
// value is cached against the raw string it came from.
let cachedRaw: string | null | undefined;
let cachedPrefs: DateTimePrefs = DEFAULT_DATETIME_PREFS;

/** The stored preferences, or the defaults (server, no storage, nothing saved). */
export function readDateTimePrefs(): DateTimePrefs {
    if (typeof window === "undefined") return DEFAULT_DATETIME_PREFS;
    let raw: string | null = null;
    try {
        raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        // Storage disabled (private mode, policy): defaults, every time.
    }
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedPrefs = parse(raw);
    }
    return cachedPrefs;
}

/** Saves the preferences. Returns false when the browser refused the write. */
export function writeDateTimePrefs(prefs: DateTimePrefs): boolean {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        return false;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
}

function subscribe(onChange: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY || e.key === null) onChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(CHANGE_EVENT, onChange);
    };
}

/** The current preferences; re-renders when they change in any tab. */
export function useDateTimePrefs(): DateTimePrefs {
    return useSyncExternalStore(subscribe, readDateTimePrefs, () => DEFAULT_DATETIME_PREFS);
}

/** The zone name to hand Intl, or undefined for the browser's own. */
function intlZone(tz: string): string | undefined {
    return tz === "local" ? undefined : tz;
}

/**
 * Formats a timestamp under the given preferences. `fallback` (default "—") is
 * returned for an empty or unparseable value, so a missing date never renders
 * as "Invalid Date".
 */
export function formatDateTime(
    value: string | number | Date | null | undefined,
    prefs: DateTimePrefs = DEFAULT_DATETIME_PREFS,
    { dateOnly = false, fallback = "—" }: { dateOnly?: boolean; fallback?: string } = {},
): string {
    if (value === null || value === undefined || value === "") return fallback;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return fallback;
    const timeZone = intlZone(prefs.timeZone);

    if (prefs.format === "iso") {
        // en-CA gives the parts zero-padded; assembled by hand so the separator
        // is a fixed "YYYY-MM-DD HH:mm" whatever the runtime's locale data says.
        const parts = Object.fromEntries(
            new Intl.DateTimeFormat("en-CA", {
                timeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            })
                .formatToParts(d)
                .map((p) => [p.type, p.value]),
        );
        const date = `${parts.year}-${parts.month}-${parts.day}`;
        return dateOnly ? date : `${date} ${parts.hour}:${parts.minute}`;
    }

    return d.toLocaleString("en-US", {
        timeZone,
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(dateOnly
            ? {}
            : {
                  hour: "numeric",
                  minute: "2-digit",
                  hourCycle: prefs.hourCycle === "24" ? "h23" : "h12",
              }),
    });
}

/** "UTC", "Europe/London", or the browser's zone name for "local". */
export function timeZoneLabel(tz: string): string {
    if (tz !== "local") return tz;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "browser time";
    } catch {
        return "browser time";
    }
}

/** Every IANA zone the runtime knows, or a short list on runtimes without it. */
export function availableTimeZones(): string[] {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    try {
        if (intl.supportedValuesOf) return intl.supportedValuesOf("timeZone");
    } catch {
        // Fall through to the short list.
    }
    return [
        "America/Los_Angeles",
        "America/Denver",
        "America/Chicago",
        "America/New_York",
        "Europe/London",
        "Europe/Berlin",
        "Asia/Tokyo",
        "Australia/Sydney",
    ];
}
