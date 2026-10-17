"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { reqListProjects, reqListZones } from "@/services/api";
import { dataOf, firstError } from "@/services/api.service";
import type { Project, Zone } from "@/types";
import { Modal } from "@/components/ui/modal";
import { useTheme } from "@/components/ThemeProvider";
import { projectSwitchHref, rememberZone, zoneSwitchHref } from "@/components/ScopeSwitcher";
import { PROJECT_PARAM, zoneHref } from "@/tools/routing.tools";

/**
 * The ⌘K / Ctrl+K command palette (GLOBAL-CHROME-16).
 *
 * Scope, deliberately small: go to any page, switch zone or project, open an
 * issue by id (or by a pasted issue URL), and two actions. There is NO backend
 * search — every row is built from the navbar's own destinations and the same
 * two registry reads the scope switcher makes, fetched on first open.
 *
 * Zone and project switches go through `zoneSwitchHref` / `projectSwitchHref`
 * from the switcher, so the palette cannot drift from its rules (drop
 * `?project` on a zone change; keep every other param on a project change).
 */

export type PaletteDestination = {
    name: string;
    href: string;
    /** Extra words that should match, e.g. "errors" for Issues. */
    keywords?: string;
    /** Display hint, e.g. the g-sequence. */
    hint?: string;
};

type Item = {
    id: string;
    group: string;
    label: string;
    hint?: string;
    keywords: string;
    run: () => void;
};

const ISSUE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Reads an issue reference out of what was typed: a bare UUID, or a pasted
 * Monitor URL — in which case its OWN zone wins, because an issue id minted in
 * one zone means nothing in another.
 */
function parseIssueRef(query: string, zone: string | null): { zone: string; id: string } | null {
    const fromUrl = query.match(/\/([^/?#\s]+)\/errors\/([0-9a-f-]{36})/i);
    if (fromUrl && ISSUE_ID.test(fromUrl[2])) return { zone: fromUrl[1], id: fromUrl[2].toLowerCase() };
    const bare = query.trim().match(ISSUE_ID);
    if (bare && zone) return { zone, id: bare[0].toLowerCase() };
    return null;
}

/** Tagged with the zone it was read for: a project list is only valid inside its zone. */
type Registry =
    | { phase: "ready"; zone: string | null; zones: Zone[]; projects: Project[] }
    | { phase: "error"; zone: string | null; message: string };

export function CommandPalette({
    open,
    onClose,
    zone,
    destinations,
    onShowShortcuts,
}: {
    open: boolean;
    onClose: () => void;
    /** The zone in the path, or null on zone-agnostic pages and unknown zones. */
    zone: string | null;
    destinations: PaletteDestination[];
    onShowShortcuts: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const project = searchParams.get(PROJECT_PARAM);
    const { resolved, setTheme } = useTheme();

    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [read, setRead] = useState<Registry | null>(null);
    // The zone a read is in flight for; guards against firing it twice.
    const inFlight = useRef<string | null | undefined>(undefined);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const listId = useId();

    const load = useCallback(async (target: string | null) => {
        inFlight.current = target;
        const [zonesRes, projectsRes] = await Promise.all([
            reqListZones(),
            target ? reqListProjects(target) : Promise.resolve(null),
        ]);
        // Same rule as the switcher: a failed read is said, never rendered as
        // "no zones".
        const failed = projectsRes ? firstError(zonesRes, projectsRes) : firstError(zonesRes);
        if (inFlight.current !== target) return;
        inFlight.current = undefined;
        if (failed) {
            setRead({ phase: "error", zone: target, message: failed.error_message });
            return;
        }
        setRead({
            phase: "ready",
            zone: target,
            zones: dataOf(zonesRes) ?? [],
            projects: (projectsRes ? dataOf(projectsRes)?.projects : null) ?? [],
        });
    }, []);

    // Only a read for THIS zone counts; anything else is "still loading".
    const registry = useMemo<Registry | { phase: "loading" }>(
        () => (read && read.zone === zone ? read : { phase: "loading" }),
        [read, zone],
    );

    useEffect(() => {
        if (!open || (read && read.zone === zone) || inFlight.current === zone) return;
        inFlight.current = zone;
        // Every setState in `load` is after its first await; the microtask hop
        // just makes that visible to the effect lint.
        void Promise.resolve().then(() => load(zone));
    }, [open, zone, read, load]);

    const go = useCallback(
        (href: string) => {
            onClose();
            router.push(href);
        },
        [onClose, router],
    );

    const items = useMemo<Item[]>(() => {
        const out: Item[] = [];
        const ref = parseIssueRef(query, zone);
        if (ref) {
            out.push({
                id: `issue:${ref.zone}:${ref.id}`,
                group: "Issue",
                label: `Open issue ${ref.id.slice(0, 8)}…`,
                hint: ref.zone,
                keywords: query,
                // The project selection carries only within the same zone.
                run: () => go(zoneHref(ref.zone, `/errors/${ref.id}`, ref.zone === zone ? project : null)),
            });
        }

        for (const d of destinations) {
            out.push({
                id: `nav:${d.href}`,
                group: "Go to",
                label: d.name,
                hint: d.hint,
                keywords: `${d.name} ${d.keywords ?? ""}`,
                run: () => go(d.href),
            });
        }

        if (registry.phase === "ready") {
            for (const z of registry.zones) {
                if (z.slug === zone) continue;
                out.push({
                    id: `zone:${z.slug}`,
                    group: "Switch zone",
                    label: z.display_name || z.slug,
                    hint: z.slug,
                    keywords: `zone ${z.slug} ${z.display_name}`,
                    run: () => {
                        rememberZone(z.slug);
                        go(zone ? zoneSwitchHref(pathname, searchParams.toString(), z.slug) : zoneHref(z.slug));
                    },
                });
            }
            if (zone) {
                const options: { slug: string | null; label: string }[] = [
                    { slug: null, label: "Default project" },
                    ...registry.projects.map((p) => ({ slug: p.slug, label: p.display_name || p.slug })),
                ];
                for (const p of options) {
                    if (p.slug === project) continue;
                    if (p.slug === null && !project) continue;
                    out.push({
                        id: `project:${p.slug ?? "__default__"}`,
                        group: `Switch project in ${zone}`,
                        label: p.label,
                        hint: p.slug ?? undefined,
                        keywords: `project ${p.slug ?? "default"} ${p.label}`,
                        run: () => go(projectSwitchHref(pathname, searchParams.toString(), p.slug)),
                    });
                }
            }
        }

        out.push({
            id: "action:theme",
            group: "Actions",
            label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
            keywords: "theme dark light appearance",
            run: () => {
                setTheme(resolved === "dark" ? "light" : "dark");
                onClose();
            },
        });
        out.push({
            id: "action:shortcuts",
            group: "Actions",
            label: "Keyboard shortcuts",
            hint: "?",
            keywords: "help keys hotkeys shortcuts",
            run: () => {
                onClose();
                onShowShortcuts();
            },
        });

        const q = query.trim().toLowerCase();
        if (!q) return out;
        return out.filter((item) => item.group === "Issue" || `${item.label} ${item.keywords}`.toLowerCase().includes(q));
    }, [query, zone, project, destinations, registry, pathname, searchParams, resolved, setTheme, go, onClose, onShowShortcuts]);

    const active = Math.min(activeIndex, Math.max(items.length - 1, 0));

    // Keep the highlighted row in view while arrowing through a long list.
    useEffect(() => {
        listRef.current
            ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [active]);

    const close = () => {
        setQuery("");
        setActiveIndex(0);
        onClose();
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex(items.length ? (active + 1) % items.length : 0);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex(items.length ? (active - 1 + items.length) % items.length : 0);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const item = items[active];
            if (item) {
                setQuery("");
                setActiveIndex(0);
                item.run();
            }
        }
    };

    let lastGroup = "";

    return (
        <Modal open={open} onClose={close} title="Go to…" widthClass="max-w-lg" initialFocusRef={inputRef}>
            <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
                aria-label="Search pages, zones and projects, or paste an issue id"
                placeholder="Search pages, zones, projects — or paste an issue id"
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />

            {registry.phase === "error" && (
                <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                    Couldn&apos;t load zones and projects: {registry.message}{" "}
                    <button
                        type="button"
                        onClick={() => void load(zone)}
                        className="underline underline-offset-2 hover:text-red-500"
                    >
                        Retry
                    </button>
                </p>
            )}

            <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label="Results"
                className="mt-3 max-h-[50vh] overflow-y-auto"
            >
                {items.map((item, i) => {
                    const header = item.group !== lastGroup ? item.group : null;
                    lastGroup = item.group;
                    return (
                        <li key={item.id} role="presentation">
                            {header && (
                                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                    {header}
                                </p>
                            )}
                            <div
                                id={`${listId}-${i}`}
                                data-index={i}
                                role="option"
                                aria-selected={i === active}
                                onMouseMove={() => setActiveIndex(i)}
                                onClick={() => {
                                    setQuery("");
                                    setActiveIndex(0);
                                    item.run();
                                }}
                                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm ${
                                    i === active
                                        ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                        : "text-zinc-700 dark:text-zinc-300"
                                }`}
                            >
                                <span className="truncate">{item.label}</span>
                                {item.hint && (
                                    <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                                        {item.hint}
                                    </span>
                                )}
                            </div>
                        </li>
                    );
                })}
                {items.length === 0 && (
                    <li className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        Nothing matches “{query}”. Paste a full issue id to open an issue.
                    </li>
                )}
                {registry.phase === "loading" && (
                    <li className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">Loading zones and projects…</li>
                )}
            </ul>
        </Modal>
    );
}
