"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * THE TWO SETTINGS HUBS share this frame: a section nav beside the content
 * (a scrolling pill row on phones) and one `<main>`.
 *
 *   /{zone}/settings/*  — everything that belongs to ONE zone (and project):
 *                         API keys, source repos, notification routing, the
 *                         zone's own registry row. `ZoneSettingsNav`.
 *   /settings/*         — everything that does NOT: your account, sign-in,
 *                         this browser's preferences, AI integration, and for
 *                         admins the install-wide SSO / users / zone registry.
 *                         `EcosystemSettingsNav`.
 *
 * ⚠️ WHERE A SETTING GOES IS DECIDED BY WHERE ITS DATA LIVES, not by what it
 * is about. A notification channel is "about" alerting, but it is a row in one
 * zone's database, so it is zone settings. An SSO provider gates every zone's
 * login and lives on the control plane, so it is ecosystem settings. Putting a
 * zone-scoped thing under /settings makes it silently control-plane-scoped
 * (that was the old API-keys bug — see `[zone]/settings/api-keys/page.tsx`).
 *
 * Alert RULES stay on /{zone}/alerts, next to their firing state and history:
 * they are operated, not configured once. Routing (where a firing rule goes) is
 * configuration, so it lives here.
 */

export interface SettingsNavItem {
    name: string;
    href: string;
    /** The pathname this item owns; it is active for that path and below it. */
    path: string;
}

export interface SettingsNavGroup {
    label: string;
    items: SettingsNavItem[];
}

export function SettingsShell({
    eyebrow,
    groups,
    footer,
    children,
}: {
    /** One line above the nav naming the hub ("Zone settings · appleby"). */
    eyebrow: React.ReactNode;
    groups: SettingsNavGroup[];
    /** Optional line under the nav — the link across to the other hub. */
    footer?: React.ReactNode;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isActive = (item: SettingsNavItem) => pathname === item.path || pathname.startsWith(`${item.path}/`);
    const items = groups.flatMap((g) => g.items);

    return (
        <main className="mx-auto max-w-8xl px-4 py-4 sm:px-6 sm:py-6 lg:px-10">
            <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
                <nav aria-label="Settings sections" className="mb-6 lg:mb-0">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {eyebrow}
                    </div>

                    {/* Phones and tablets: one scrolling row. Rendered instead of,
                        not as well as, the column below, so each link exists once
                        in the accessibility tree. */}
                    <ul className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:hidden">
                        {items.map((item) => (
                            <li key={item.href} className="shrink-0">
                                <NavLink item={item} active={isActive(item)} pill />
                            </li>
                        ))}
                    </ul>

                    <div className="hidden space-y-5 lg:block">
                        {groups.map((group) => (
                            <div key={group.label}>
                                {groups.length > 1 && (
                                    <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                        {group.label}
                                    </div>
                                )}
                                <ul className="space-y-0.5">
                                    {group.items.map((item) => (
                                        <li key={item.href}>
                                            <NavLink item={item} active={isActive(item)} />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        {footer && <div className="border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">{footer}</div>}
                    </div>
                </nav>

                <div className="min-w-0">{children}</div>
            </div>
        </main>
    );
}

function NavLink({ item, active, pill }: { item: SettingsNavItem; active: boolean; pill?: boolean }) {
    return (
        <Link
            href={item.href}
            // No prefetch: every section link fetched its RSC payload twice on
            // arrival (~16 requests), on the same sockets as the page's reads —
            // the same trade the Navbar makes (navPrefetch, AGENTS.md §8).
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
                "block rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                pill ? "whitespace-nowrap px-3 py-1.5" : "px-2 py-1.5",
                active
                    ? "bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
            )}
        >
            {item.name}
        </Link>
    );
}
