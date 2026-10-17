"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "@/store/hooks";
import { useAuthContext } from "@/context/AuthContext";
import { HealthStatus } from "@/components/HealthStatus";
import { ScopeSwitcher } from "@/components/ScopeSwitcher";
import { useTheme } from "@/components/ThemeProvider";
import { CommandPalette, type PaletteDestination } from "@/components/CommandPalette";
import { ShortcutHelp, type ShortcutGroup } from "@/components/ShortcutHelp";
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
//
// `hotkey` is the second key of its "g then …" sequence. The Navbar binds it and
// the "?" overlay lists it from this same table, so the two cannot disagree.
type NavItem = { name: string; path: string; zoned: boolean; hotkey?: string; keywords?: string };

// "Issues", not "Errors": the page's H1 and its <title> say Issues, and a nav
// label that names a different thing from the page it opens reads as a wrong
// link (GLOBAL-CHROME-06). The URL stays /errors — bookmarks outlive labels.
const primaryNavItems: NavItem[] = [
    { name: "Events", path: "", zoned: true, hotkey: "e" },
    { name: "Issues", path: "/errors", zoned: true, hotkey: "i", keywords: "errors" },
    { name: "Performance", path: "/performance", zoned: true, hotkey: "p", keywords: "latency" },
    { name: "Live", path: "/live", zoned: true, hotkey: "l", keywords: "tail stream" },
    { name: "Analytics", path: "/analytics", zoned: true, hotkey: "y" },
];

// ⚠️ TWO SETTINGS PAGES, NAMED APART (GLOBAL-CHROME-07). "Zone settings" is
// /{zone}/settings — API keys and repo mappings, per project — and had no way
// in from the chrome at all. "Account" is /settings, which is per person. Both
// used to be reachable only as "Settings", and that one went to the account.
const secondaryNavItems: NavItem[] = [
    { name: "Dashboard", path: "/dashboard", zoned: true, hotkey: "d" },
    { name: "Alerts", path: "/alerts", zoned: true, hotkey: "a" },
    { name: "Notifications", path: "/notifications", zoned: true, hotkey: "n" },
    { name: "Zone settings", path: "/settings", zoned: true, hotkey: "s", keywords: "api keys repos" },
    { name: "Account", path: "/settings", zoned: false, keywords: "settings mcp" },
];

const allNavItems = [...primaryNavItems, ...secondaryNavItems];

/** Admin-only, zone-agnostic destinations. Shared by the avatar menu and the phone sheet. */
const adminItems = [
    { name: "SSO Providers", href: "/admin/sso" },
    { name: "Users", href: "/admin/users" },
    // Zone-agnostic, like every /admin/* page: the registry is the map of ALL
    // zones, so the link carries no zone and no project selector.
    { name: "Zones & Projects", href: "/admin/registry" },
];

// ── 404 awareness ────────────────────────────────────────────────────────────
//
// ⚠️ THE NAVBAR SITS ABOVE THE 404, NOT INSIDE IT (GLOBAL-CHROME-01). On
// /nozone it read "nozone" out of the path like any zone: the switcher showed it
// as the live scope, the health pill polled it and reported it "offline", and
// Events was highlighted — a zone that never existed, presented as one that is
// merely down, under a page body saying it does not exist.
//
// `app/not-found.tsx` knows which 404 it is (it has the registry, server-side)
// and mounts `NotFoundMarker` to say so. A tiny external store rather than
// context because the 404 renders BELOW the Navbar, not around it.

type NotFoundState = { active: boolean; unknownZone: string | null };
const NO_404: NotFoundState = { active: false, unknownZone: null };
let notFoundState = NO_404;
const notFoundListeners = new Set<() => void>();

function subscribeNotFound(listener: () => void) {
    notFoundListeners.add(listener);
    return () => notFoundListeners.delete(listener);
}

function setNotFound(next: NotFoundState) {
    notFoundState = next;
    for (const l of notFoundListeners) l();
}

/**
 * Rendered by `app/not-found.tsx`. `unknownZone` is the path's zone slug when the
 * registry does not have it, null when the 404 is a missing page inside a real
 * zone (or outside any zone).
 */
export function NotFoundMarker({ unknownZone }: { unknownZone: string | null }) {
    useEffect(() => {
        const state = { active: true, unknownZone };
        setNotFound(state);
        return () => {
            if (notFoundState === state) setNotFound(NO_404);
        };
    }, [unknownZone]);
    return null;
}

// ── Popover plumbing ─────────────────────────────────────────────────────────

/**
 * Click-outside AND Escape for a popover, with focus returned to its trigger.
 *
 * Every navbar popover needs all three, and two of them (the theme and user
 * menus) had only the first — so a keyboard user could open them and not close
 * them (GLOBAL-CHROME-03).
 */
function useDismissable(
    open: boolean,
    setOpen: (open: boolean) => void,
    wrapRef: React.RefObject<HTMLElement | null>,
    triggerRef: React.RefObject<HTMLElement | null>,
) {
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, setOpen, wrapRef, triggerRef]);

    // Focus lands in the menu on open — on the checked item when there is one.
    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => {
            const menu = wrapRef.current?.querySelector<HTMLElement>('[role="menu"]');
            const target =
                menu?.querySelector<HTMLElement>('[aria-checked="true"], [aria-current="page"]') ??
                menu?.querySelector<HTMLElement>('[role^="menuitem"]');
            target?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open, wrapRef]);
}

/** Arrow / Home / End between a menu's items. Attach to the role="menu" element. */
function menuKeyNav(e: React.KeyboardEvent<HTMLElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
}

const menuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 transition-colors";

function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    useDismissable(open, setOpen, ref, triggerRef);

    const options = [
        {
            value: "light" as const, label: "Light",
            icon: (
                <svg className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
            ),
        },
        {
            value: "dark" as const, label: "Dark",
            icon: (
                <svg className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
            ),
        },
        {
            value: "system" as const, label: "System",
            icon: (
                <svg className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
            ),
        },
    ];

    const current = options.find((o) => o.value === theme) ?? options[2];

    return (
        <div className="relative" ref={ref}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-haspopup="menu"
                title={`Theme: ${current.label}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                aria-label={`Theme: ${current.label}. Change theme`}
            >
                {current.icon}
            </button>
            {open && (
                <div role="menu" aria-label="Theme" onKeyDown={menuKeyNav} className="absolute right-0 top-full mt-1 w-36 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg animate-slide-up z-50">
                    {options.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={theme === opt.value}
                            onClick={() => { setTheme(opt.value); setOpen(false); triggerRef.current?.focus(); }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
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

/**
 * The secondary destinations, folded into one menu between md and 2xl.
 *
 * Inline, the nine links plus the scope switcher and the right-hand cluster do
 * not fit a laptop: at 1280px "Settings" ran underneath the health pill, and at
 * 1024px the row overflowed outright. The primary five stay inline at every
 * desktop width because they are the pages people move between constantly.
 */
function MoreMenu({
    items,
    hrefFor,
    isActive,
}: {
    items: NavItem[];
    hrefFor: (item: NavItem) => string;
    isActive: (item: NavItem) => boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const activeItem = items.find(isActive);
    useDismissable(open, setOpen, ref, triggerRef);

    return (
        <div className="relative" ref={ref}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="menu"
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    activeItem
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
            >
                {/* Name the page you are on when it lives in here, so the nav
                    never loses its "you are here". */}
                {activeItem ? activeItem.name : "More"}
                <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div role="menu" onKeyDown={menuKeyNav} className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg animate-slide-up">
                    {items.map((item) => (
                        <Link
                            key={item.name}
                            role="menuitem"
                            href={hrefFor(item)}
                            onClick={() => setOpen(false)}
                            aria-current={isActive(item) ? "page" : undefined}
                            className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                                isActive(item)
                                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                            }`}
                        >
                            {item.name}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    useDismissable(open, setOpen, ref, triggerRef);

    const label = user.name || user.email;
    const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

    return (
        <div className="relative" ref={ref}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(!open)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                aria-label="User menu"
                title={label}
                aria-expanded={open}
                aria-haspopup="menu"
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
                        <span className="mt-1 inline-block text-[10px] uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400">
                            {user.role}
                        </span>
                    </div>
                    <div role="menu" aria-label="Account" onKeyDown={menuKeyNav}>
                        <Link
                            href="/settings/security"
                            role="menuitem"
                            onClick={() => setOpen(false)}
                            className={menuItemClass}
                        >
                            Account & Security
                        </Link>
                        {user.role === "admin" &&
                            adminItems.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    role="menuitem"
                                    onClick={() => setOpen(false)}
                                    className={menuItemClass}
                                >
                                    {item.name}
                                </Link>
                            ))}
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setOpen(false); onLogout(); }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 transition-colors cursor-pointer"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * The phone navigation, as a SHEET over the page (GLOBAL-CHROME-10).
 *
 * It used to be an in-flow block under the header, so opening it shoved the
 * page ~540px down, and only its own X closed it. Now: fixed below the header,
 * a backdrop that closes on tap, Escape that closes and returns focus to the
 * hamburger, Tab kept inside, and the page behind it does not scroll.
 *
 * ⚠️ PORTALLED TO <body>. The header has `backdrop-blur`, and a
 * `backdrop-filter` makes an element the containing block for its `fixed`
 * descendants — rendered inside the header, `inset-0` would mean "inset of the
 * 56px header", not of the viewport.
 */
function MobileSheet({
    onClose,
    triggerRef,
    children,
}: {
    onClose: () => void;
    triggerRef: React.RefObject<HTMLButtonElement | null>;
    children: React.ReactNode;
}) {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const trigger = triggerRef.current;
        const panel = panelRef.current;
        const first = panel?.querySelector<HTMLElement>("a, button");
        first?.focus();

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                trigger?.focus();
                return;
            }
            if (e.key !== "Tab" || !panel) return;
            const focusable = panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
            if (focusable.length === 0) return;
            const head = focusable[0];
            const tail = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === head) {
                e.preventDefault();
                tail.focus();
            } else if (!e.shiftKey && document.activeElement === tail) {
                e.preventDefault();
                head.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = previous;
        };
    }, [onClose, triggerRef]);

    return createPortal(
        <div className="fixed inset-x-0 bottom-0 top-14 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
            <div
                ref={panelRef}
                id="mobile-nav"
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
                className="relative max-h-full overflow-y-auto border-b border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900 animate-slide-up"
            >
                {children}
            </div>
        </div>,
        document.body,
    );
}

/** Text fields own their keys; a shortcut must never eat a typed letter. */
function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
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
    const router = useRouter();
    const { user } = useAuth();
    const { logout } = useAuthContext();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const hamburgerRef = useRef<HTMLButtonElement>(null);
    const notFound = useSyncExternalStore(subscribeNotFound, () => notFoundState, () => NO_404);

    // Scope comes from the ROUTE, synchronously — usePathname and
    // useSearchParams both resolve before the first paint. Nothing here waits on
    // a fetch, because a navbar whose links only become correct after a request
    // lands is a navbar that hands out wrong URLs for as long as that takes.
    //
    // The one exception is a 404 for a zone the registry does not have: then
    // the path's first segment is not a zone at all, and is treated as absent.
    const rawPathZone = zoneFromPathname(pathname);
    const pathZoneUnknown = notFound.active && notFound.unknownZone !== null && notFound.unknownZone === rawPathZone;
    const pathZone = pathZoneUnknown ? null : rawPathZone;

    // Off a zone path, fall back to the remembered zone, then to the stock slug.
    // A link into the wrong zone 404s honestly; a link into no zone at all is a
    // dead navbar.
    const zone = pathZone || rememberedZone || FALLBACK_ZONE;

    // A zoned tail resolves against the current zone and carries the project
    // selection across the navigation; an unzoned one stays at the root and
    // deliberately does not, having no tenant dimension to carry. On an unknown
    // zone the project is dropped too: it was qualifying a zone that is not one.
    const carriedProject = pathZoneUnknown ? null : project;
    const hrefFor = useCallback(
        (item: NavItem) => (item.zoned ? zoneHref(zone, item.path, carriedProject) : item.path),
        [zone, carriedProject],
    );

    // Active state compares PATHS, never hrefs: the href carries ?project and
    // the pathname does not. Nothing is "here" on a 404.
    const isActive = (item: NavItem) => {
        if (notFound.active) return false;
        const full = item.zoned ? `/${zone}${item.path}` : item.path;
        return item.path === "" ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
    };

    // ── Keyboard shortcuts (GLOBAL-CHROME-16/17) ─────────────────────────────
    // Mod+K: palette. "?": the shortcut sheet. "g" then a nav item's hotkey: go
    // there. Ignored while typing in a field, with any other modifier held, or
    // with a dialog open — except Mod+K, which is a chord nothing types.
    const hrefForRef = useRef(hrefFor);
    const paletteOpenRef = useRef(paletteOpen);
    useEffect(() => {
        hrefForRef.current = hrefFor;
        paletteOpenRef.current = paletteOpen;
    }, [hrefFor, paletteOpen]);

    useEffect(() => {
        if (pathname === "/unauthorized" || pathname === "/login" || pathname === "/pending") return;
        let gPressedAt = 0;
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.repeat) return;
            const dialogOpen = !!document.querySelector('[aria-modal="true"]');
            if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
                if (dialogOpen && !paletteOpenRef.current) return;
                e.preventDefault();
                setHelpOpen(false);
                setPaletteOpen((v) => !v);
                return;
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (isEditable(e.target) || dialogOpen) return;

            if (e.key === "?") {
                e.preventDefault();
                setHelpOpen(true);
                return;
            }
            if (gPressedAt && Date.now() - gPressedAt < 1500) {
                gPressedAt = 0;
                const item = allNavItems.find((n) => n.hotkey === e.key.toLowerCase());
                if (item) {
                    e.preventDefault();
                    router.push(hrefForRef.current(item));
                }
                return;
            }
            if (e.key === "g") gPressedAt = Date.now();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [pathname, router]);

    const closePalette = useCallback(() => setPaletteOpen(false), []);
    const closeHelp = useCallback(() => setHelpOpen(false), []);
    const showShortcuts = useCallback(() => setHelpOpen(true), []);
    const closeMobile = useCallback(() => setMobileNavOpen(false), []);

    const destinations = useMemo<PaletteDestination[]>(() => {
        const out: PaletteDestination[] = allNavItems.map((item) => ({
            name: item.zoned ? `${item.name} — ${zone}` : item.name,
            href: hrefFor(item),
            keywords: item.keywords,
            hint: item.hotkey ? `g ${item.hotkey}` : undefined,
        }));
        out.push({ name: "Account & Security", href: "/settings/security", keywords: "password sso identities" });
        if (user?.role === "admin") {
            for (const a of adminItems) out.push({ name: a.name, href: a.href, keywords: "admin" });
        }
        return out;
    }, [hrefFor, zone, user?.role]);

    const globalShortcuts = useMemo<ShortcutGroup[]>(
        () => [
            {
                title: "Anywhere",
                shortcuts: [
                    { keys: ["Mod", "K"], description: "Open the command palette" },
                    { keys: ["?"], description: "Show this list" },
                    { keys: ["Esc"], description: "Close a menu or dialog" },
                ],
            },
            {
                title: "Go to",
                shortcuts: allNavItems
                    .filter((n) => n.hotkey)
                    .map((n) => ({ keys: ["g", n.hotkey as string], sequence: true, description: n.name })),
            },
        ],
        [],
    );

    if (pathname === "/unauthorized" || pathname === "/login" || pathname === "/pending") return null;

    const linkClass = (item: NavItem, idle: string) =>
        `rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
            isActive(item)
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : idle
        }`;

    return (
        <>
        <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-8xl items-center justify-between px-4 sm:px-6 lg:px-10">
                {/* Left: Logo + nav */}
                <div className="flex min-w-0 items-center gap-4 xl:gap-6">
                    {/* shrink-0: at laptop widths the row is full, and the brand was
                        the one item allowed to shrink — it clipped to "Monito".
                        The word shows from 2xl; below that the logo alone. */}
                    <Link href={zoneHref(zone, "", carriedProject)} className="flex shrink-0 items-center gap-1.5">
                        <Image
                            src="/Monitor-Logo-Transparent.svg"
                            alt="Monitor"
                            width={36}
                            height={36}
                            className="h-9 w-9"
                        />
                        <span className="hidden 2xl:inline text-lg font-semibold text-zinc-900 dark:text-zinc-50">
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
                        On an unknown zone's 404 it becomes a plain zone picker.

                        Hidden below sm: the trigger, the logo and the right-hand
                        cluster do not fit a phone at once. The mobile sheet
                        carries its own copy. */}
                    <div className="hidden sm:block">
                        <ScopeSwitcher unknownZone={pathZoneUnknown} />
                    </div>

                    {/* Desktop nav — from lg. At md (768px) the logo, the scope
                        trigger and these links ran 120px into the right-hand
                        cluster; tablets get the sheet instead. */}
                    <nav aria-label="Main" className="hidden lg:flex items-center">
                        <div className="flex items-center gap-0.5">
                            {primaryNavItems.map((item) => (
                                <Link
                                    key={item.name}
                                    href={hrefFor(item)}
                                    aria-current={isActive(item) ? "page" : undefined}
                                    title={item.hotkey ? `${item.name} (g ${item.hotkey})` : undefined}
                                    className={linkClass(item, "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800")}
                                >
                                    {item.name}
                                </Link>
                            ))}
                        </div>
                        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-2" />
                        <div className="2xl:hidden">
                            <MoreMenu items={secondaryNavItems} hrefFor={hrefFor} isActive={isActive} />
                        </div>
                        <div className="hidden 2xl:flex items-center gap-0.5">
                            {secondaryNavItems.map((item) => (
                                <Link
                                    key={item.name}
                                    href={hrefFor(item)}
                                    aria-current={isActive(item) ? "page" : undefined}
                                    title={item.hotkey ? `${item.name} (g ${item.hotkey})` : undefined}
                                    className={linkClass(item, "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800")}
                                >
                                    {item.name}
                                </Link>
                            ))}
                        </div>
                    </nav>
                </div>

                {/* Right: search + health status + theme toggle + user menu */}
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                    <button
                        type="button"
                        onClick={() => setPaletteOpen(true)}
                        aria-label="Search and jump to a page, zone, project or issue"
                        title="Search and jump (⌘K / Ctrl+K)"
                        aria-haspopup="dialog"
                        className="hidden lg:flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                        <FontAwesomeIcon icon={faMagnifyingGlass} className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    {/* Not on an unknown zone's 404: "nozone offline" presented a
                        name that never existed as a zone that is merely down. */}
                    {!pathZoneUnknown && <HealthStatus />}
                    <ThemeToggle />

                    {/* User menu */}
                    {user && <UserMenu user={user} onLogout={logout} />}

                    {/* Mobile hamburger */}
                    <button
                        ref={hamburgerRef}
                        type="button"
                        onClick={() => setMobileNavOpen(!mobileNavOpen)}
                        className="flex lg:hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                        aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
                        title={mobileNavOpen ? "Close menu" : "Open menu"}
                        aria-expanded={mobileNavOpen}
                        aria-controls="mobile-nav"
                    >
                        {mobileNavOpen ? (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {mobileNavOpen && (
                <MobileSheet onClose={closeMobile} triggerRef={hamburgerRef}>
                    <nav aria-label="Main" className="flex flex-col p-2 gap-0.5">
                        {/* The phone's copy of the scope control — the header
                            one is hidden below sm. It renders null on the
                            zone-agnostic pages exactly as that one does. */}
                        <div className="sm:hidden mb-1 px-1">
                            <ScopeSwitcher onSelect={closeMobile} unknownZone={pathZoneUnknown} />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                closeMobile();
                                setPaletteOpen(true);
                            }}
                            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            <FontAwesomeIcon icon={faMagnifyingGlass} className="h-3.5 w-3.5" aria-hidden />
                            Search and jump…
                        </button>
                        {allNavItems.map((item) => (
                            <Link
                                key={item.name}
                                href={hrefFor(item)}
                                onClick={closeMobile}
                                aria-current={isActive(item) ? "page" : undefined}
                                className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                    isActive(item)
                                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                }`}
                            >
                                {item.name}
                            </Link>
                        ))}
                        {/* Admin destinations lived only in the avatar menu, so
                            on a phone they were two taps deeper than everything
                            else and easy to miss (GLOBAL-CHROME-10). */}
                        {user?.role === "admin" && (
                            <>
                                <p className="mt-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                    Admin
                                </p>
                                {adminItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={closeMobile}
                                        aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                                        className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                            pathname.startsWith(item.href)
                                                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                                                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                        }`}
                                    >
                                        {item.name}
                                    </Link>
                                ))}
                            </>
                        )}
                    </nav>
                </MobileSheet>
            )}

        </header>

        {/* Siblings of the header, not children: its backdrop-filter would make
            it the containing block for the dialogs' `fixed inset-0`. */}
        <CommandPalette
            open={paletteOpen}
            onClose={closePalette}
            zone={pathZone}
            destinations={destinations}
            onShowShortcuts={showShortcuts}
        />
        <ShortcutHelp open={helpOpen} onClose={closeHelp} global={globalShortcuts} />
        </>
    );
}
