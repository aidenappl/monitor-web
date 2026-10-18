"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getZoneHealth, reqListProjects, reqListZones } from "@/services/api";
import { dataOf, firstError } from "@/services/api.service";
import type { Project, Zone } from "@/types";
import { PROJECT_PARAM, zoneFromPathname, zoneHref } from "@/tools/routing.tools";
import { rememberZone } from "@/context/RememberedZoneContext";

// ── Scope navigation, shared with the command palette ────────────────────────
//
// Both controls change the scope, and they must change it the SAME way: the
// rules below (drop `?project` on a zone change, drop the record id, keep every
// other param on a project change) are load-bearing, and a second copy in the
// palette would agree only until someone edited one of them.

// Written here before navigating, so a full load mid-switch already has it;
// ScopeBoundary writes it again (and updates the in-tab context) on arrival.
export { rememberZone };

/**
 * Where choosing zone `slug` goes from `pathname`.
 *
 * ⚠️ THE PROJECT SELECTION IS DROPPED, ALWAYS. A project slug is unique only
 * WITHIN its zone, so the same string in the new zone is either a different
 * tenant or nothing at all — and "nothing at all" is a 400 on every subsequent
 * request from a param the user never typed.
 *
 * ⚠️ The record id is DROPPED too: `/{zone}/errors/9f3` → `/{new}/errors`. A
 * zone is a whole separate ClickHouse instance, so an id minted in one means
 * nothing in another.
 */
export function zoneSwitchHref(pathname: string, search: string, slug: string): string {
    const segments = pathname.split("/").filter(Boolean);
    const tail = segments.length > 1 ? `/${segments[1]}` : "";
    const params = new URLSearchParams(search);
    params.delete(PROJECT_PARAM);
    const query = params.toString();
    return `/${encodeURIComponent(slug)}${tail}${query ? `?${query}` : ""}`;
}

/**
 * Where choosing project `slug` (null = the default) goes. Every other param
 * survives — the page's own filters and time range are orthogonal to which
 * tenant is being read.
 */
export function projectSwitchHref(pathname: string, search: string, slug: string | null): string {
    const params = new URLSearchParams(search);
    if (slug) params.set(PROJECT_PARAM, slug);
    else params.delete(PROJECT_PARAM);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
}

/** The trigger's and the palette's name for the project half of the scope. */
export function projectLabelOf(project: string | null): string {
    return project ?? "Default project";
}

/**
 * The scope control: which zone, and which project inside it.
 *
 * Both halves of the scope live in the URL and are read back from it — the zone
 * as a path segment, the project as `?project`. See `tools/routing.tools.ts` for
 * why they are shaped differently. This component never holds the selection in
 * state; it renders the URL and navigates to change it, so a copied link always
 * reproduces what was on screen.
 *
 * ⚠️ IT IS NOT A PERMISSION CONTROL. The project a session reads is a SELECTOR,
 * validated server-side against the registry but gated by nothing — Monitor has
 * no per-user project membership table, so there is no row that could say this
 * user may see one project and not another. A check that consults nothing is a
 * decoration, and the danger of shipping one is that the next reader trusts it.
 * (Ingest and API-key reads ARE boundaries — see the asymmetry register in
 * `services/api.service.ts` and monitor-core's `withSessionProject`, which is
 * where a membership table would land.)
 */

/**
 * One selectable row. The flat list is what the arrow keys walk.
 *
 * ⚠️ Keyboard focus is tracked by `key`, NOT by position. The panel opens before
 * the registry read lands, so rows appear ABOVE the focused one mid-interaction —
 * an index captured on open would silently come to mean a different row, and the
 * roving `tabIndex` would land on one row while the focus ring sat on another.
 */
type ScopeRow =
    | { key: string; kind: "zone"; slug: string; label: string; hint?: string; selected: boolean; health?: ZoneHealth }
    | { key: string; kind: "project"; slug: string | null; label: string; hint?: string; selected: boolean; health?: undefined };

/** What one zone's `/health` said when the menu last opened. */
type ZoneHealth = "checking" | "up" | "down";

/**
 * The registry read, tagged with the zone it was read for.
 *
 * A discriminated union rather than `lists + loading + error`, because those
 * three booleans can express states that do not exist — loaded AND loading, an
 * error next to a populated list — and one of them, "not loading and empty", has
 * to mean BOTH "the request has not started yet" (the fetch is kicked off by an
 * effect, so there is a frame of it) and "this install really has nothing".
 * Rendering "no zones" for that frame and then correcting it is the bug the
 * union removes.
 */
type RegistryState =
    | { phase: "idle" }
    | { phase: "loading"; zone: string }
    | {
          phase: "ready";
          zone: string;
          zones: Zone[];
          projects: Project[];
          /** Which project an unset `?project` resolves to — an install property. */
          defaultProjectSlug: string;
      }
    | { phase: "error"; zone: string; message: string };

/**
 * `onSelect` fires after a zone or project is chosen. The mobile navbar uses it
 * to close its dropdown, the same way its links do — without it the menu stays
 * open over the page the selection just navigated to.
 *
 * `unknownZone` is set by the Navbar on a 404 for a zone the registry does not
 * have (GLOBAL-CHROME-01). The path's first segment is then NOT a scope — the
 * page body says so — and the control turns into a plain zone picker labelled
 * "Choose a zone" instead of presenting the bogus slug as the live zone.
 */
export function ScopeSwitcher({
    onSelect,
    unknownZone = false,
}: {
    onSelect?: () => void;
    unknownZone?: boolean;
}) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();

    // ⚠️ Read the zone from the PATH only, with no `rememberedZone` fallback —
    // unlike the navbar's links, which do fall back so they can point somewhere.
    // A null zone here means the page is genuinely zone-agnostic (/settings,
    // /admin/*), and the control hides rather than claiming a scope the page
    // does not apply. A scope control on a page that ignores scope is a lie
    // about what the page shows.
    const zone = zoneFromPathname(pathname);
    const project = searchParams.get(PROJECT_PARAM);

    const [open, setOpen] = useState(false);
    const [registry, setRegistry] = useState<RegistryState>({ phase: "idle" });
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [health, setHealth] = useState<Record<string, ZoneHealth>>({});

    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef(new Map<string, HTMLButtonElement | null>());
    // Guards against a slow response for a zone the user has already left.
    const requestSeq = useRef(0);

    // ⚠️ Everything read out of the registry is gated on the load having been for
    // THIS zone. A project slug is unique only within its zone, so zone A's list
    // resolving zone B's `?project` to a display name is a label that is wrong
    // while looking right. Tagging the state with its zone makes that
    // impossible by construction rather than by an effect that clears it a frame
    // late.
    const current = registry.phase !== "idle" && registry.zone === zone ? registry : null;
    // Memoised only to keep the identity stable for the row builder below; the
    // fallback is a fresh [] otherwise, which would rebuild every row on every
    // render.
    const zones = useMemo(() => (current?.phase === "ready" ? current.zones : []), [current]);
    const projects = useMemo(() => (current?.phase === "ready" ? current.projects : []), [current]);
    const defaultProjectSlug = current?.phase === "ready" ? current.defaultProjectSlug : "";
    const error = current?.phase === "error" ? current.message : null;
    const settled = current?.phase === "ready";

    const load = useCallback(async (target: string, zonesOnly: boolean) => {
        const seq = ++requestSeq.current;
        setRegistry({ phase: "loading", zone: target });

        // An unknown zone has no project list to read — asking would only add a
        // second failure under the one the page already explains.
        const [zonesRes, projectsRes] = await Promise.all([
            reqListZones(),
            zonesOnly ? Promise.resolve(null) : reqListProjects(target),
        ]);
        if (seq !== requestSeq.current) return;

        // firstError, not a try/catch: the shared client returns a non-2xx as a
        // VALUE, so a failed registry read would otherwise render as an empty
        // switcher — indistinguishable from an install with nothing in it.
        const failed = projectsRes ? firstError(zonesRes, projectsRes) : firstError(zonesRes);
        if (failed) {
            setRegistry({ phase: "error", zone: target, message: failed.error_message });
            return;
        }

        const projectsData = projectsRes ? dataOf(projectsRes) : null;
        setRegistry({
            phase: "ready",
            zone: target,
            zones: dataOf(zonesRes) ?? [],
            projects: projectsData?.projects ?? [],
            defaultProjectSlug: projectsData?.default_project_slug ?? "",
        });
    }, []);

    // Lazy, on first open. The trigger renders the slugs straight from the URL,
    // which is what the operator typed and bookmarked, so upgrading them to
    // display names is not worth two requests on every page load.
    //
    // `current` covers all three reasons not to fire: already loaded, already in
    // flight, or already failed for this zone — a failure is retried by the
    // button in the panel, never by a re-render.
    useEffect(() => {
        if (!open || !zone || current) return;
        void load(zone, unknownZone);
    }, [open, zone, current, load, unknownZone]);

    // Each zone's liveness, re-asked every time the menu opens (GLOBAL-CHROME-15):
    // picking an offline zone used to be the only way to find out it was
    // offline. In parallel, each with a short timeout, and never blocking the
    // rows — a dot that has not answered yet reads "checking", never "up".
    const zoneSlugsKey = zones.map((z) => z.slug).join(",");
    useEffect(() => {
        if (!open || !zoneSlugsKey) return;
        let cancelled = false;
        const slugs = zoneSlugsKey.split(",");
        void (async () => {
            setHealth(Object.fromEntries(slugs.map((s) => [s, "checking" as const])));
            await Promise.all(
                slugs.map(async (slug) => {
                    const res = await getZoneHealth(slug);
                    if (cancelled) return;
                    setHealth((prev) => ({ ...prev, [slug]: res.success ? "up" : "down" }));
                }),
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [open, zoneSlugsKey]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    // ⚠️ THE TRIGGER SHOWS SLUGS, NEVER DISPLAY NAMES (GLOBAL-CHROME-08). The
    // registry is read lazily on first open, so a trigger that upgraded to
    // display names once it landed said "appleby" on load and "Appleby" a click
    // later — the scope appearing to change under a menu that changed nothing.
    // The slug is what the URL says and what the operator typed; the menu rows
    // carry the display names.
    const projectLabel = projectLabelOf(project);
    const zoneLabel = zone ?? "";

    // Kept as two named groups AND one flat list: the groups are what renders,
    // the flat list is what the arrow keys walk, and deriving one from the other
    // is what keeps the visual order and the focus order from drifting apart.
    const { zoneRows, projectRows, rows } = useMemo(() => {
        const zoneRows: Extract<ScopeRow, { kind: "zone" }>[] = zones.map((z) => ({
            key: `zone:${z.slug}`,
            kind: "zone",
            slug: z.slug,
            label: z.display_name || z.slug,
            hint: z.display_name && z.display_name !== z.slug ? z.slug : undefined,
            selected: !unknownZone && z.slug === zone,
            health: health[z.slug],
        }));

        // ⚠️ THE UNSET ROW IS "DEFAULT PROJECT", NOT "ALL PROJECTS", and the
        // difference is not cosmetic. monitor-core's `selectedProject` resolves a
        // missing `?project` to `env.DefaultProjectSlug` — ONE project — and
        // refuses a repeated param outright, so this phase is single-select.
        // Labelling that state "All projects" would put one project's numbers
        // under an all-projects heading: a chart that is wrong while looking
        // right, which is the exact outcome the backend refuses a fallback for.
        // The label becomes "All projects" when the backend can actually answer
        // for a union, and not before.
        //
        // It is also always rendered, even when the registry read FAILED, because
        // it is the escape hatch: a stale `?project` 400s every other request on
        // the page, and clearing it is the one move that always works.
        // The install default is rendered ONCE, as the unset row, and dropped
        // from the list below it. It would otherwise appear twice — as "Default
        // project" and again under its own name — two rows selecting the SAME
        // tenant by two different URLs (no `?project` versus `?project=default`),
        // with two checked states that can never both be right.
        //
        // The unset form is the canonical one: it is what the backend resolves to
        // anyway, it is the shorter link to share, and it is the only row that
        // still works when the registry read failed.
        //
        // The row's LABEL is the trigger's label — "Default project" in both
        // places (GLOBAL-CHROME-08: they used to say "Default project" and
        // "Default (default)"); which project that resolves to is the hint.
        const defaultRow = projects.find((p) => p.slug === defaultProjectSlug);

        const projectRows: Extract<ScopeRow, { kind: "project" }>[] = unknownZone ? [] : [
            {
                key: "project:__default__",
                kind: "project",
                slug: null,
                label: projectLabelOf(null),
                hint: defaultRow ? `Resolves to ${defaultRow.display_name || defaultRow.slug}` : undefined,
                selected: !project || project === defaultProjectSlug,
            },
            ...projects
                .filter((p) => p.slug !== defaultProjectSlug)
                .map((p) => ({
                    key: `project:${p.slug}`,
                    kind: "project" as const,
                    slug: p.slug,
                    label: p.display_name || p.slug,
                    hint: p.display_name && p.display_name !== p.slug ? p.slug : undefined,
                    selected: p.slug === project,
                })),
        ];

        return { zoneRows, projectRows, rows: [...zoneRows, ...projectRows] as ScopeRow[] };
    }, [zones, projects, zone, project, defaultProjectSlug, unknownZone, health]);

    const close = useCallback((returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    }, []);

    /** Whether the user has driven focus themselves since the panel opened. */
    const userMoved = useRef(false);

    const focusKey = useCallback((key: string | null) => {
        setActiveKey(key);
        if (key) itemRefs.current.get(key)?.focus();
    }, []);

    /** Moves focus `delta` rows from the active one, wrapping at both ends. */
    const moveFocus = useCallback(
        (delta: number) => {
            if (rows.length === 0) return;
            userMoved.current = true;
            const from = rows.findIndex((r) => r.key === activeKey);
            const next = (((from < 0 ? 0 : from + delta) % rows.length) + rows.length) % rows.length;
            focusKey(rows[next].key);
        },
        [rows, activeKey, focusKey],
    );

    const focusEdge = useCallback(
        (edge: "first" | "last") => {
            if (rows.length === 0) return;
            userMoved.current = true;
            focusKey(edge === "first" ? rows[0].key : rows[rows.length - 1].key);
        },
        [rows, focusKey],
    );

    /** The row focus should sit on when the user has not moved it: the live one. */
    const defaultFocusKey = (rows.find((r) => r.selected) ?? rows[0])?.key ?? null;

    // Opening lands focus on the current selection, so Enter is a no-op rather
    // than a surprise.
    useEffect(() => {
        userMoved.current = false;
        if (!open) {
            setActiveKey(null);
            return;
        }
        setActiveKey(defaultFocusKey);
        if (!defaultFocusKey) return;
        const frame = requestAnimationFrame(() => itemRefs.current.get(defaultFocusKey)?.focus());
        return () => cancelAnimationFrame(frame);
        // Deliberately only on `open`: re-running as the lists load would yank
        // focus out from under someone already arrowing through them. The effect
        // below is what handles the load landing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // ⚠️ Re-aims focus once the lists land, and ONLY if the user has not moved it.
    //
    // The panel opens before the registry read returns, so at open time the row
    // for the selected project does not exist yet and focus falls to the first
    // row — which is "Default project". Leaving it there means the first Enter
    // after opening CLEARS the selection instead of confirming it: a scope change
    // the user did not ask for, from a keystroke that should have been a no-op.
    useEffect(() => {
        if (!open || !settled || userMoved.current) return;
        if (!defaultFocusKey || defaultFocusKey === activeKey) return;
        focusKey(defaultFocusKey);
    }, [open, settled, defaultFocusKey, activeKey, focusKey]);

    /**
     * The section tail a zone change keeps: `/{zone}/errors/9f3` → `/errors`.
     *
     * ⚠️ The record id is DROPPED on purpose. A zone is a whole separate
     * ClickHouse instance, so an issue id minted in one means nothing in
     * another — carrying it across would land the user on a detail page for a
     * record that does not exist, which reads as data loss rather than as a
     * scope change.
     */
    // See `zoneSwitchHref` / `projectSwitchHref` above for the rules — shared
    // with the command palette so the two cannot drift.
    //
    // Focus returns to the trigger rather than being dropped on the body when
    // the row unmounts — the trigger survives the navigation, so a keyboard
    // user stays exactly where they were.
    const selectZone = useCallback(
        (slug: string) => {
            rememberZone(slug);
            close(true);
            onSelect?.();
            router.push(zoneSwitchHref(pathname, searchParams.toString(), slug));
        },
        [router, pathname, searchParams, close, onSelect],
    );

    const selectProject = useCallback(
        (slug: string | null) => {
            close(true);
            onSelect?.();
            router.push(projectSwitchHref(pathname, searchParams.toString(), slug));
        },
        [router, pathname, searchParams, close, onSelect],
    );

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            if (open) {
                e.stopPropagation();
                close(true);
            }
            return;
        }
        if (!open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                moveFocus(1);
                break;
            case "ArrowUp":
                e.preventDefault();
                moveFocus(-1);
                break;
            case "Home":
                e.preventDefault();
                focusEdge("first");
                break;
            case "End":
                e.preventDefault();
                focusEdge("last");
                break;
            case "Tab":
                // Let focus leave naturally rather than trapping it.
                setOpen(false);
                break;
        }
    };

    if (!zone) return null;

    return (
        <div className="relative" ref={wrapRef} onKeyDown={onKeyDown}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={
                    unknownZone
                        ? "Choose a zone"
                        : `Scope: zone ${zoneLabel}, project ${projectLabel}. Change scope`
                }
                className="flex h-8 max-w-[15rem] items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-[13px] transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 cursor-pointer"
            >
                <svg
                    className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3zM4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3"
                    />
                </svg>
                {/* Both halves are always shown: the zone alone does not say which
                    tenant is on screen, and the project alone does not say which
                    backend answered. */}
                {unknownZone ? (
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        Choose a zone
                    </span>
                ) : (
                    <>
                        <span className="truncate text-zinc-500 dark:text-zinc-400">{zoneLabel}</span>
                        <span className="text-zinc-400 dark:text-zinc-500">/</span>
                        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                            {projectLabel}
                        </span>
                    </>
                )}
                {error && (
                    <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                        title="The zone and project lists could not be loaded"
                    />
                )}
                <svg
                    className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Zone and project"
                    className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg animate-slide-up"
                >
                    {error && (
                        <div className="m-1 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                Could not load zones and projects
                            </p>
                            <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-500 break-words">
                                {error}
                            </p>
                            <button
                                type="button"
                                onClick={() => void load(zone, unknownZone)}
                                className="mt-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 cursor-pointer"
                            >
                                Try again
                            </button>
                        </div>
                    )}

                    <div role="group" aria-label="Zone">
                        <SectionLabel>Zone</SectionLabel>
                        {!settled && !error && <LoadingRow />}
                        {settled && zones.length === 0 && (
                            <EmptyRow>This install reports no zones.</EmptyRow>
                        )}
                        {zoneRows.map((row) => (
                            <OptionRow
                                key={row.key}
                                itemRef={(el) => {
                                    itemRefs.current.set(row.key, el);
                                }}
                                row={row}
                                tabIndex={row.key === activeKey ? 0 : -1}
                                onSelect={() => selectZone(row.slug)}
                            />
                        ))}
                        {/* Said out loud so a single row reads as a fact about the
                            install rather than as a list that failed to load. */}
                        {settled && zones.length === 1 && (
                            <p className="px-3 pb-1.5 pt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">
                                This install has one zone.
                            </p>
                        )}
                    </div>

                    {!unknownZone && (
                        <>
                            <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

                            <div role="group" aria-label={`Project in ${zoneLabel}`}>
                                <SectionLabel>Project in {zoneLabel}</SectionLabel>
                                {projectRows.map((row) => (
                                    <OptionRow
                                        key={row.key}
                                        itemRef={(el) => {
                                            itemRefs.current.set(row.key, el);
                                        }}
                                        row={row}
                                        tabIndex={row.key === activeKey ? 0 : -1}
                                        onSelect={() => selectProject(row.slug)}
                                    />
                                ))}
                                {!settled && !error && <LoadingRow />}
                                {settled && projects.length === 0 && (
                                    <EmptyRow>No named projects in this zone yet.</EmptyRow>
                                )}
                            </div>

                            {/* The way into the zone's own settings (API keys, repo
                                mappings) from the chrome (GLOBAL-CHROME-07). It
                                lives here because a key belongs to THIS zone and
                                project — the scope the menu is showing. Reached by
                                Tab, like any link after a radio group. */}
                            <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                            <Link
                                href={zoneHref(zone, "/settings", project)}
                                role="menuitem"
                                onClick={() => {
                                    setOpen(false);
                                    onSelect?.();
                                }}
                                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                                Zone settings &amp; API keys
                                <span aria-hidden="true">→</span>
                            </Link>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {children}
        </p>
    );
}

function LoadingRow() {
    return (
        <div className="flex items-center gap-2 px-3 py-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</span>
        </div>
    );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    );
}

/**
 * One option.
 *
 * `menuitemradio` rather than `menuitem`: these are two single-choice groups,
 * and `aria-checked` is what tells a screen-reader user which zone and which
 * project are live — the tick beside the label only tells a sighted one.
 */
function OptionRow({
    itemRef,
    row,
    tabIndex,
    onSelect,
}: {
    itemRef: (el: HTMLButtonElement | null) => void;
    row: ScopeRow;
    tabIndex: number;
    onSelect: () => void;
}) {
    return (
        <button
            ref={itemRef}
            type="button"
            role="menuitemradio"
            aria-checked={row.selected}
            tabIndex={tabIndex}
            onClick={onSelect}
            // The hint is truncated at this width; the tooltip carries all of it.
            title={row.hint ? `${row.label} — ${row.hint}${row.health === "down" ? " (offline)" : ""}` : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 cursor-pointer ${
                row.selected
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
        >
            {row.health && <HealthDot health={row.health} />}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{row.label}</span>
                {(row.hint || row.health === "down") && (
                    <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {row.health === "down" && (
                            <span className="font-medium text-red-600 dark:text-red-400">offline</span>
                        )}
                        {row.health === "down" && row.hint && " · "}
                        {row.hint}
                    </span>
                )}
            </span>
            {row.selected && (
                <svg
                    className="h-3.5 w-3.5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            )}
        </button>
    );
}

/** A zone's liveness as of this menu opening. Text, not just colour, for "down". */
function HealthDot({ health }: { health: ZoneHealth }) {
    const tone = {
        checking: "bg-zinc-300 dark:bg-zinc-600 animate-pulse",
        up: "bg-emerald-500",
        down: "bg-red-500",
    }[health];
    const label = { checking: "checking", up: "online", down: "offline" }[health];
    return (
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} role="img" aria-label={label} title={label} />
    );
}
