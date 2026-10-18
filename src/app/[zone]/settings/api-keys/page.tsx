"use client";

import { ApiKeysTab } from "@/components/settings/ApiKeysTab";

/**
 * API keys for this zone and project.
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
export default function ApiKeysPage() {
    return <ApiKeysTab />;
}
