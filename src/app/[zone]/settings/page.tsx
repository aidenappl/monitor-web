"use client";

import { ApiKeysTab } from "@/components/settings/ApiKeysTab";
import { useScope } from "@/hooks/useScope";

/**
 * Per-zone settings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THIS PAGE HAD TO EXIST, AND WHY IT IS NOT JUST A TAB ON /settings.
 *
 * API keys are PER PROJECT, per zone. `apikeys.List` reads the project off the
 * request's scope server-side and a minted key is bound to one tenant for good.
 * `/settings` is in ZONE_AGNOSTIC_SEGMENTS, so requests from it carry no `?zone`
 * and `resolveUpstream` answers them from the control plane — which meant the
 * only API-keys UI in the app could only ever show, mint and revoke keys for the
 * control plane's default project. Every other zone's keys had no URL at all,
 * while two admin dialogs pointed operators at "Settings → API keys" to manage
 * exactly those.
 *
 * A page cannot be scoped by being a tab. It has to live under `/{zone}` so the
 * zone is in its path and `ScopeBoundary` is above it — which is what makes the
 * project switcher in the navbar apply here, and what makes switching project
 * actually re-read the list rather than relabel it.
 *
 * ⚠️ WHAT STAYS ON /settings: the genuinely account-level surfaces. An account
 * belongs to a person and does not acquire a tenant by being looked at from one.
 * That page now links HERE for keys rather than pretending to serve them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ZoneSettingsPage() {
    const { zone, project } = useScope();

    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Zone settings
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Configuration that belongs to{" "}
                        <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                            {zone}
                        </strong>
                        {project ? (
                            <>
                                {" "}
                                and the project{" "}
                                <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                                    {project}
                                </strong>
                            </>
                        ) : (
                            " and its default project"
                        )}
                        . Use the scope control in the header to change either — everything on
                        this page re-reads when you do.
                    </p>
                </div>

                {/* Single-surface for now, so no tab strip: a one-tab tab bar is a
                    control that cannot be used, and the page has a heading that
                    already says what it is. Add the strip back when a second
                    per-zone setting exists. */}
                <ApiKeysTab />
            </div>
        </main>
    );
}
