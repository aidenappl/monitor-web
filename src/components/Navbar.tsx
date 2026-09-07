"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/store/hooks";
import { useAuthContext } from "@/context/AuthContext";
import { HealthStatus } from "@/components/HealthStatus";
import { ScopeSwitcher } from "@/components/ScopeSwitcher";
import { useTheme } from "@/components/ThemeProvider";
import type { User } from "@/types/auth.types";
import {
    FALLBACK_ZONE,
    PROJECT_PARAM,
    zoneFromPathname,
    zoneHref,
} from "@/tools/routing.tools";

// Nav destinations are stored as ZONE-RELATIVE tails, not as absolute hrefs.
// "" is the events home, "/errors" is the issues list, and each is resolved
// against the zone in the current URL at render time. Storing them absolute is
// what would silently drop the zone on every click.
//
// `zoned: false` marks the surfaces that are NOT per-zone — an account and its
// settings belong to the person, not to a backend — so they keep a root path.
type NavItem = { name: string; path: string; zoned: boolean };

const primaryNavItems: NavItem[] = [
    { name: "Events", path: "", zoned: true },
    { name: "Errors", path: "/errors", zoned: true },
    { name: "Performance", path: "/performance", zoned: true },
    { name: "Live", path: "/live", zoned: true },
    { name: "Analytics", path: "/analytics", zoned: true },
];

const secondaryNavItems: NavItem[] = [
    { name: "Dashboard", path: "/dashboard", zoned: true },
    { name: "Alerts", path: "/alerts", zoned: true },
    { name: "Notifications", path: "/notifications", zoned: true },
    { name: "Settings", path: "/settings", zoned: false },
];

const allNavItems = [...primaryNavItems, ...secondaryNavItems];

function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const options = [
        {
            value: "light" as const, label: "Light",
            icon: (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
            ),
        },
        {
            value: "dark" as const, label: "Dark",
            icon: (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
            ),
        },
        {
            value: "system" as const, label: "System",
            icon: (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
            ),
        },
    ];

    const current = options.find((o) => o.value === theme) ?? options[2];

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(!open)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                aria-label="Toggle theme"
            >
                {current.icon}
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-36 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg animate-slide-up z-50">
                    {options.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => { setTheme(opt.value); setOpen(false); }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                                theme === opt.value
                                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                            }`}
                        >
                            {opt.icon}
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const label = user.name || user.email;
    const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(!open)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                aria-label="User menu"
                aria-expanded={open}
            >
                {initial}
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg animate-slide-up z-50">
                    <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {label}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {user.email}
                        </p>
                        <span className="mt-1 inline-block text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
                            {user.role}
                        </span>
                    </div>
                    <Link
                        href="/settings/security"
                        onClick={() => setOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                        Account & Security
                    </Link>
                    {user.role === "admin" && (
                        <>
                            <Link
                                href="/admin/sso"
                                onClick={() => setOpen(false)}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                            >
                                SSO Providers
                            </Link>
                            {/* Zone-agnostic, like every /admin/* page: the registry is
                                the map of ALL zones, so the link carries no zone and no
                                project selector. */}
                            <Link
                                href="/admin/registry"
                                onClick={() => setOpen(false)}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                            >
                                Zones &amp; Projects
                            </Link>
                        </>
                    )}
                    <button
                        onClick={() => { setOpen(false); onLogout(); }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                    >
                        Sign out
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * `rememberedZone` is the mon-zone cookie, read server-side by the root layout
 * and passed down.
 *
 * It only matters on the zone-agnostic pages (/settings, /admin/*), where the
 * path holds no zone but the nav still has to offer a way back into one. Reading
 * the cookie here instead would mean reading it during render on the client
 * only, and the hrefs would differ between the server and client passes.
 */
export function Navbar({ rememberedZone }: { rememberedZone?: string }) {
    const pathname = usePathname();
    const project = useSearchParams().get(PROJECT_PARAM);
    const { user } = useAuth();
    const { logout } = useAuthContext();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    if (pathname === "/unauthorized" || pathname === "/login" || pathname === "/pending") return null;

    // Scope comes from the ROUTE, synchronously — usePathname and
    // useSearchParams both resolve before the first paint. Nothing here waits on
    // a fetch, because a navbar whose links only become correct after a request
    // lands is a navbar that hands out wrong URLs for as long as that takes.
    //
    // Off a zone path, fall back to the remembered zone, then to the stock slug.
    // A link into the wrong zone 404s honestly; a link into no zone at all is a
    // dead navbar.
    const zone = zoneFromPathname(pathname) || rememberedZone || FALLBACK_ZONE;

    // A zoned tail resolves against the current zone and carries the project
    // selection across the navigation; an unzoned one stays at the root and
    // deliberately does not, having no tenant dimension to carry.
    const hrefFor = (item: NavItem) =>
        item.zoned ? zoneHref(zone, item.path, project) : item.path;

    // Active state compares PATHS, never hrefs: the href carries ?project and
    // the pathname does not.
    const isActive = (item: NavItem) => {
        const full = item.zoned ? `/${zone}${item.path}` : item.path;
        return item.path === "" ? pathname === full : pathname.startsWith(full);
    };

    return (
        <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-8xl items-center justify-between px-4 sm:px-6 lg:px-8">
                {/* Left: Logo + nav */}
                <div className="flex items-center gap-6">
                    <Link href={zoneHref(zone, "", project)} className="flex items-center gap-1.5">
                        <Image
                            src="/Monitor-Logo-Transparent.svg"
                            alt="Monitor"
                            width={36}
                            height={36}
                            className="h-9 w-9"
                        />
                        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                            Monitor
                        </span>
                    </Link>

                    {/* Scope: which zone, and which project inside it. It sits
                        between the logo and the nav because it qualifies every
                        destination to its right — the same reason Sentry and
                        Grafana put theirs there.

                        It reads the zone from the path ITSELF rather than taking
                        the `zone` computed above: that one falls back to
                        `rememberedZone` so the nav links always point somewhere,
                        and the switcher must NOT inherit that fallback. On
                        /settings and /admin/* there is genuinely no scope, and it
                        hides rather than displaying one the page does not apply.

                        Hidden below sm: the trigger, the logo and the right-hand
                        cluster do not fit a phone at once. The mobile menu below
                        carries its own copy. */}
                    <div className="hidden sm:block">
                        <ScopeSwitcher />
                    </div>

                    {/* Desktop nav */}
                    <nav className="hidden md:flex items-center">
                        <div className="flex items-center gap-0.5">
                            {primaryNavItems.map((item) => {
                                return (
                                    <Link
                                        key={item.path}
                                        href={hrefFor(item)}
                                        className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                                            isActive(item)
                                                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                        }`}
                                    >
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </div>
                        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-2" />
                        <div className="flex items-center gap-0.5">
                            {secondaryNavItems.map((item) => {
                                return (
                                    <Link
                                        key={item.path}
                                        href={hrefFor(item)}
                                        className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                                            isActive(item)
                                                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                        }`}
                                    >
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </div>
                    </nav>
                </div>

                {/* Right: Health status + theme toggle + user menu */}
                <div className="flex items-center gap-3">
                    <HealthStatus />
                    <ThemeToggle />

                    {/* User menu */}
                    {user && <UserMenu user={user} onLogout={logout} />}

                    {/* Mobile hamburger */}
                    <button
                        onClick={() => setMobileNavOpen(!mobileNavOpen)}
                        className="flex md:hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                        aria-label="Toggle menu"
                        aria-expanded={mobileNavOpen}
                    >
                        {mobileNavOpen ? (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Mobile nav dropdown */}
            {mobileNavOpen && (
                <div className="md:hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <nav className="flex flex-col p-2 gap-0.5">
                        {/* The phone's copy of the scope control — the header
                            one is hidden below sm. It renders null on the
                            zone-agnostic pages exactly as that one does. */}
                        <div className="sm:hidden mb-1 px-1">
                            <ScopeSwitcher onSelect={() => setMobileNavOpen(false)} />
                        </div>
                        {allNavItems.map((item) => {
                            return (
                                <Link
                                    key={item.path}
                                    href={hrefFor(item)}
                                    onClick={() => setMobileNavOpen(false)}
                                    className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                        isActive(item)
                                            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                    }`}
                                >
                                    {item.name}
                                </Link>
                            );
                        })}
                    </nav>
                </div>
            )}
        </header>
    );
}
