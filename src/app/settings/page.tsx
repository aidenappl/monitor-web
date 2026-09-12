"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { McpTab } from "@/components/settings/McpTab";
import { useZoneHref } from "@/hooks/useZoneHref";

/**
 * Account-level settings.
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
 * would go looking for it in the API instead of one click away.
 */

const tabs = [
    { id: "api-keys", name: "API Keys" },
    { id: "ai", name: "AI Integration" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<TabId>("api-keys");

    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Settings
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Account-level settings. Anything that belongs to a zone or a project
                        lives under that zone.
                    </p>
                </div>

                {/* Tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-700">
                    <nav className="flex gap-1 -mb-px">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                                        : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                                }`}
                            >
                                {tab.name}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Tab content */}
                {activeTab === "api-keys" && (
                    // useZoneHref reads the route and falls back to the remembered
                    // zone, and it needs a Suspense boundary of its own here: this
                    // route is outside [zone]/layout.tsx, so nothing above it
                    // provides one.
                    <Suspense fallback={null}>
                        <ApiKeysSignpost />
                    </Suspense>
                )}
                {activeTab === "ai" && <McpTab />}
            </div>
        </main>
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
                Open zone settings
            </Link>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
                That link uses the zone you were last in. Use the scope control in the
                header to pick a different zone or project once you are there.
            </p>
        </div>
    );
}
