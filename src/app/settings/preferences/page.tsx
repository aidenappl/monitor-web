"use client";

import { useMemo, useState } from "react";
import { useHydrated } from "@/hooks/useHydrated";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import {
    availableTimeZones,
    formatDateTime,
    timeZoneLabel,
    useDateTimePrefs,
    writeDateTimePrefs,
    type DateTimePrefs,
} from "@/tools/datetime.tools";

// A fixed instant, so the preview is the same on the server and the client and
// the effect of a timezone change is easy to read against it.
const SAMPLE_DATE = Date.UTC(2026, 9, 16, 17, 18);

/**
 * Timezone and date format, kept in this browser (`tools/datetime.tools.ts`).
 * Saved on change — there is no server record to save to, and a separate Save
 * button would only add a way to lose an edit.
 */
export default function PreferencesPage() {
    const prefs = useDateTimePrefs();
    const [saveFailed, setSaveFailed] = useState(false);
    const zones = useMemo(() => availableTimeZones(), []);
    // ⚠️ The browser's zone and anything formatted in "local" time differ from
    // the server's (UTC): rendered during hydration they were React #418
    // ("text") on every load of this page. Placeholders until hydrated.
    const hydrated = useHydrated();
    const localName = hydrated ? timeZoneLabel("local") : "this browser";

    const update = (patch: Partial<DateTimePrefs>) => {
        setSaveFailed(!writeDateTimePrefs({ ...prefs, ...patch }));
    };

    const zoneMode = prefs.timeZone === "local" || prefs.timeZone === "UTC" ? prefs.timeZone : "custom";
    const select =
        "w-full sm:w-80 min-h-10 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-2 text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
    const label = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Preferences</h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">How this browser shows things. Nothing here is stored on the server.</p>
            </div>
            <section className="space-y-5" aria-labelledby="prefs-heading">
                <div>
                    <h2 id="prefs-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        Date &amp; time
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        How timestamps are shown. Saved in this browser only.
                    </p>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-4">
                    <div>
                        <label htmlFor="pref-tz-mode" className={label}>
                            Timezone
                        </label>
                        <select
                            id="pref-tz-mode"
                            value={zoneMode}
                            onChange={(e) => {
                                const v = e.target.value;
                                // "Other" starts on the browser's own zone, so the
                                // picker below opens on something recognisable.
                                update({ timeZone: v === "custom" ? localName : v });
                            }}
                            className={select}
                        >
                            <option value="local">Browser time ({localName})</option>
                            <option value="UTC">UTC</option>
                            <option value="custom">Other…</option>
                        </select>
                    </div>
                    {zoneMode === "custom" && (
                        <div>
                            <label htmlFor="pref-tz" className={label}>
                                Zone
                            </label>
                            <select
                                id="pref-tz"
                                value={prefs.timeZone}
                                onChange={(e) => update({ timeZone: e.target.value })}
                                className={select}
                            >
                                {!zones.includes(prefs.timeZone) && (
                                    <option value={prefs.timeZone}>{prefs.timeZone}</option>
                                )}
                                {zones.map((z) => (
                                    <option key={z} value={z}>
                                        {z.replace(/_/g, " ")}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label htmlFor="pref-format" className={label}>
                            Date format
                        </label>
                        <select
                            id="pref-format"
                            value={prefs.format}
                            onChange={(e) => update({ format: e.target.value === "iso" ? "iso" : "locale" })}
                            className={select}
                        >
                            <option value="locale">Readable (Oct 16, 2026)</option>
                            <option value="iso">ISO (2026-10-16)</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="pref-hours" className={label}>
                            Clock
                        </label>
                        <select
                            id="pref-hours"
                            value={prefs.format === "iso" ? "24" : prefs.hourCycle}
                            disabled={prefs.format === "iso"}
                            aria-describedby={prefs.format === "iso" ? "pref-hours-hint" : undefined}
                            onChange={(e) => update({ hourCycle: e.target.value === "24" ? "24" : "12" })}
                            className={`${select} disabled:opacity-50`}
                        >
                            <option value="12">12-hour (5:18 PM)</option>
                            <option value="24">24-hour (17:18)</option>
                        </select>
                        {prefs.format === "iso" && (
                            <p id="pref-hours-hint" className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                ISO format is always 24-hour.
                            </p>
                        )}
                    </div>

                    <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
                        <FontAwesomeIcon icon={faCircleCheck} className="text-emerald-500 mr-1.5" aria-hidden />
                        17:18 UTC on Oct 16, 2026 shows as{" "}
                        <span className="font-mono text-zinc-900 dark:text-zinc-100">
                            {hydrated ? (
                                formatDateTime(SAMPLE_DATE, prefs)
                            ) : (
                                <span className="inline-block h-3.5 w-36 animate-pulse rounded bg-zinc-200 align-middle dark:bg-zinc-800" aria-hidden />
                            )}
                        </span>{" "}
                        ({hydrated ? timeZoneLabel(prefs.timeZone) : "…"})
                    </p>
                    {saveFailed && (
                        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                            This browser refused to save the preference (storage is blocked),
                            so it will reset when you reload.
                        </p>
                    )}
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Applied to the events page (table, detail panel and chart) and the
                    settings pages; other pages adopt it as they are updated.
                </p>
            </section>
        </div>
    );
}

