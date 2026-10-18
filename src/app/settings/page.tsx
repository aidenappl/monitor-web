"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faChevronRight,
    faKey,
    faShieldHalved,
    faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { McpTab } from "@/components/settings/McpTab";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useUrlState, urlEnum } from "@/hooks/useUrlState";
import { useZoneHref } from "@/hooks/useZoneHref";
import { useAuth } from "@/store/hooks";
import {
    availableTimeZones,
    formatDateTime,
    timeZoneLabel,
    useDateTimePrefs,
    writeDateTimePrefs,
    type DateTimePrefs,
} from "@/tools/datetime.tools";

/**
 * Account-level settings: the account hub. The tab lives in `?tab=`, so a link
 * or a reload lands where it was.
 *
 * ⚠️ API KEYS ARE NOT HERE ANY MORE, AND THAT IS THE FIX RATHER THAN A
 * REGRESSION. They are per project, per zone; this route is in
 * ZONE_AGNOSTIC_SEGMENTS, so every request it makes is answered by the control
 * plane. Mounting the keys UI here did not make it "install-wide" — it made it
 * silently show, mint and revoke keys for exactly one project of one zone, with
 * a heading that claimed otherwise and no way to reach any other tenant's.
 *
 * The tab is kept as a SIGNPOST rather than deleted. Two admin dialogs and a
 * good deal of muscle memory point at "Settings → API keys"; a tab that
 * disappeared would read as the feature having been removed, and the operator
 * would go looking for it in the API instead of one click away. It is no longer
 * the DEFAULT tab: landing on an explanation of where something moved made the
 * page read as a dead end.
 */

const TAB_IDS = ["account", "preferences", "ai", "api-keys"] as const;
type TabId = (typeof TAB_IDS)[number];
const TABS: { id: TabId; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "preferences", label: "Preferences" },
    { id: "ai", label: "AI Integration" },
    { id: "api-keys", label: "API Keys" },
];

export default function SettingsPage() {
    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Settings
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Your account and this browser&apos;s preferences. Anything that
                        belongs to a zone or a project lives under that zone.
                    </p>
                </div>
                {/* useUrlState and useZoneHref read the search params, and this
                    route is outside [zone]/layout.tsx, so nothing above it
                    provides the Suspense boundary they need. */}
                <Suspense fallback={null}>
                    <SettingsTabs />
                </Suspense>
            </div>
        </main>
    );
}

function SettingsTabs() {
    const [tab, setTab] = useUrlState("tab", urlEnum(TAB_IDS), {
        default: "account",
        history: "push",
    });

    return (
        <div className="space-y-6">
            <Tabs id="settings" label="Settings sections" items={TABS} value={tab} onChange={setTab} />
            <TabPanel tabsId="settings" value={tab}>
                {tab === "account" && <AccountPanel />}
                {tab === "preferences" && <PreferencesPanel />}
                {tab === "ai" && <McpTab />}
                {tab === "api-keys" && <ApiKeysSignpost />}
            </TabPanel>
        </div>
    );
}

const linkCard =
    "flex items-center gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-4 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/** Who you are, and the way into the pages that change it. */
function AccountPanel() {
    const { user } = useAuth();
    const zoned = useZoneHref();

    return (
        <div className="space-y-4">
            <h2 className="sr-only">Account</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4">
                <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Signed in as
                    </dt>
                    <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100 truncate" title={user?.email}>
                        {user?.email ?? "—"}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Role
                    </dt>
                    <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100 capitalize">
                        {user?.role ?? "—"}
                    </dd>
                </div>
            </dl>

            <Link href="/settings/security" className={linkCard}>
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <FontAwesomeIcon icon={faShieldHalved} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Account &amp; Security
                    </span>
                    <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                        Linked sign-in accounts and your password.
                    </span>
                </span>
                <FontAwesomeIcon icon={faChevronRight} className="text-xs text-zinc-400" aria-hidden />
            </Link>

            <Link href={zoned("/settings")} className={linkCard}>
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <FontAwesomeIcon icon={faKey} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        API keys
                    </span>
                    <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                        Keys belong to a project inside a zone, so they live in zone
                        settings.
                    </span>
                </span>
                <FontAwesomeIcon icon={faChevronRight} className="text-xs text-zinc-400" aria-hidden />
            </Link>
        </div>
    );
}

// A fixed instant, so the preview is the same on the server and the client and
// the effect of a timezone change is easy to read against it.
const SAMPLE_DATE = Date.UTC(2026, 9, 16, 17, 18);

/**
 * Timezone and date format, kept in this browser (`tools/datetime.tools.ts`).
 * Saved on change — there is no server record to save to, and a separate Save
 * button would only add a way to lose an edit.
 */
function PreferencesPanel() {
    const prefs = useDateTimePrefs();
    const [saveFailed, setSaveFailed] = useState(false);
    const zones = useMemo(() => availableTimeZones(), []);
    const localName = timeZoneLabel("local");

    const update = (patch: Partial<DateTimePrefs>) => {
        setSaveFailed(!writeDateTimePrefs({ ...prefs, ...patch }));
    };

    const zoneMode = prefs.timeZone === "local" || prefs.timeZone === "UTC" ? prefs.timeZone : "custom";
    const select =
        "w-full sm:w-80 min-h-10 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-2 text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
    const label = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

    return (
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
                        {formatDateTime(SAMPLE_DATE, prefs)}
                    </span>{" "}
                    ({timeZoneLabel(prefs.timeZone)})
                </p>
                {saveFailed && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                        This browser refused to save the preference (storage is blocked),
                        so it will reset when you reload.
                    </p>
                )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Applied on the Settings and Account &amp; Security pages today; other
                pages adopt it as they are updated.
            </p>
        </section>
    );
}

/**
 * The pointer into the zone-scoped keys page.
 *
 * It names WHY the move happened rather than just where things went. "Moved to
 * zone settings" invites the reader to assume a reorganisation; the real reason
 * — that a key belongs to one project and this page has no project — is what
 * stops them looking for an install-wide list that never existed.
 */
function ApiKeysSignpost() {
    const zoned = useZoneHref();

    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                API keys live inside a zone
            </h2>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                A key is bound to one project inside one zone — ingest derives an
                event&apos;s project from the key that sent it — so there is no
                install-wide list of them to show here. This page is account-level and
                carries no zone, which means anything it asked for would be answered by
                the control plane alone.
            </p>
            <Link
                href={zoned("/settings")}
                className="inline-flex min-h-10 items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
                Open zone settings
            </Link>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                That link uses the zone you were last in. Use the scope control in the
                header to pick a different zone or project once you are there.
            </p>
        </div>
    );
}
