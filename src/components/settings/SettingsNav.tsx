"use client";

import { Suspense } from "react";
import Link from "next/link";
import { LoadingBlock } from "@/components/ui/spinner";
import { SettingsShell, type SettingsNavGroup } from "@/components/settings/SettingsShell";
import { useScope } from "@/hooks/useScope";
import { useRememberedZone } from "@/context/RememberedZoneContext";
import { useAuth } from "@/store/hooks";
import { FALLBACK_ZONE, zoneHref } from "@/tools/routing.tools";

/**
 * The per-zone hub, `/{zone}/settings/*`. Inside ScopeBoundary, so the links
 * carry the zone AND the project selection, and switching either in the header
 * remounts whichever section is open.
 */
export function ZoneSettingsFrame({ children }: { children: React.ReactNode }) {
    const { zone, project } = useScope();
    const item = (name: string, tail: string) => ({
        name,
        href: zoneHref(zone, `/settings${tail}`, project),
        path: `/${zone}/settings${tail}`,
    });

    const groups: SettingsNavGroup[] = [
        {
            label: "Ingest",
            items: [item("API keys", "/api-keys"), item("Source repositories", "/repos")],
        },
        { label: "Alerting", items: [item("Notification routing", "/notifications")] },
        { label: "Zone", items: [item("Zone & projects", "/zone")] },
    ];

    return (
        <SettingsShell
            eyebrow={<>Zone settings · {zone}</>}
            groups={groups}
            footer={
                <div className="space-y-2 px-2">
                    <Link href={zoneHref(zone, "/alerts", project)} className="block text-blue-600 hover:underline dark:text-blue-400">
                        Alert rules →
                    </Link>
                    <Link href="/settings/account" className="block text-blue-600 hover:underline dark:text-blue-400">
                        Account &amp; ecosystem settings →
                    </Link>
                </div>
            }
        >
            {children}
        </SettingsShell>
    );
}

/**
 * The ecosystem hub, `/settings/*`: the person, this browser, and (for admins)
 * the install. No zone in the path, so nothing here is tenant-scoped; the link
 * back into a zone uses the remembered zone.
 */
export function EcosystemSettingsFrame({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const remembered = useRememberedZone() ?? FALLBACK_ZONE;
    const item = (name: string, path: string) => ({ name, href: path, path });

    const groups: SettingsNavGroup[] = [
        {
            label: "You",
            items: [
                item("Account", "/settings/account"),
                item("Sign-in & security", "/settings/security"),
                item("Preferences", "/settings/preferences"),
                item("AI integration", "/settings/ai"),
            ],
        },
    ];
    // Hidden, not just disabled, for non-admins: every one of these pages is
    // refused by the API for them anyway (and each page re-checks the role).
    if (user?.role === "admin") {
        groups.push({
            label: "Install (admin)",
            items: [
                item("Users", "/settings/admin/users"),
                item("SSO providers", "/settings/admin/sso"),
                item("Zones & projects", "/settings/admin/registry"),
            ],
        });
    }

    return (
        <SettingsShell
            eyebrow="Settings"
            groups={groups}
            footer={
                <Link href={zoneHref(remembered, "/settings")} className="block px-2 text-blue-600 hover:underline dark:text-blue-400">
                    Zone settings · {remembered} →
                </Link>
            }
        >
            {/* useZoneHref / useUrlState read the search params, and this hub is
                outside [zone]/layout.tsx, which provides that Suspense boundary
                for the zone pages. */}
            <Suspense fallback={<LoadingBlock label="Loading settings" />}>{children}</Suspense>
        </SettingsShell>
    );
}
