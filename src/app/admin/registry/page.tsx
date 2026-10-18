"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowsRotate,
    faChevronDown,
    faChevronRight,
    faCopy,
    faLock,
    faPen,
    faPlug,
    faPlus,
    faServer,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "@/store/hooks";
import {
    reqListProjects,
    reqListZones,
    reqProbeZone,
    reqRetireProject,
    reqRetireZone,
} from "@/services/api";
import type { Project, Zone } from "@/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { RefetchBar } from "@/components/ui/spinner";
import { FailureState, FailureNote } from "@/components/FailureState";
import {
    ZoneHealthChip,
    ZoneHealthPanel,
    isFreshHealthy,
    probeAge,
    verdictMeta,
} from "@/components/admin/ZoneHealth";
import { copyText } from "@/tools/clipboard.tools";
import { zoneHref } from "@/tools/routing.tools";
import { ZoneFormModal } from "@/components/admin/ZoneFormModal";
import { ProjectFormModal } from "@/components/admin/ProjectFormModal";
import { RetireDialog, type RetireKind } from "@/components/admin/RetireDialog";

/**
 * The tenancy registry admin page — zones and the projects inside them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS FOR, in one sentence: a zone row RECORDS infrastructure that
 * already exists, and a row whose query URL points at the WRONG zone makes the
 * dashboard show one zone's data under another zone's name, silently. Everything
 * below is arranged around making that specific failure impossible to overlook —
 * the health of every row is on screen without being asked for, and the
 * `mismatched` verdict is the loudest thing the page can render.
 *
 * ⚠️ IT LIVES AT THE ROOT, NOT UNDER `[zone]`. Admin surfaces are ZONE-AGNOSTIC:
 * the registry is the map of all zones, so scoping it inside one would be
 * incoherent (which zone do you stand in to retire that zone?). `admin` is in
 * `ZONE_AGNOSTIC_SEGMENTS` in `tools/routing.tools.ts`, `tools/Slug.tool.go`
 * reserves the slug so no zone can ever shadow it, and `ScopeSwitcher` renders
 * NULL here rather than claiming a scope this page does not have. Do not move it
 * under `[zone]` and do not add a scope control to it.
 *
 * ⚠️ EVERY CALL HAS AN EXPLICIT SUCCESS BRANCH. The shared axios client sets
 * `validateStatus: () => true`, so a 500 is a VALUE and not a throw — a
 * try/catch around any of these is dead code for HTTP failures, and
 * `res.success ? res.data : []` would launder a broken control plane into a tidy
 * "no zones". Down must never render as empty; see `FailureState`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * ⚠️ A discriminated union, not `zones + loading + error`.
 *
 * Those three can express states that do not exist (loaded AND loading) and,
 * worse, "not loading and empty" would have to mean both "the fetch has not
 * started" and "this install genuinely has no zones". On THIS page the second
 * reading is a claim about infrastructure, and getting it wrong for a frame
 * teaches the operator that a zone they just recorded is missing.
 */
type ZonesState =
    | { phase: "loading" }
    | { phase: "ready"; zones: Zone[] }
    | { phase: "error"; message: string };

/** Per-zone project list, loaded when a zone is expanded. Same reasoning. */
type ProjectsState =
    | { phase: "loading" }
    // `refreshing`: a re-read after a save/retire. The list on screen stays
    // put under a RefetchBar instead of collapsing back to the skeleton.
    | { phase: "ready"; projects: Project[]; refreshing?: boolean }
    | { phase: "error"; message: string };

type RetireTarget = {
    kind: RetireKind;
    id: number;
    slug: string;
    displayName: string;
    /** For a project — which zone's list to re-read after it lands. */
    zoneSlug?: string;
};

export default function AdminRegistryPage() {
    const { user, isLoading } = useAuth();
    const isAdmin = user?.role === "admin";

    const [state, setState] = useState<ZonesState>({ phase: "loading" });
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [projects, setProjects] = useState<Record<string, ProjectsState>>({});

    /**
     * Zones with a probe in flight. A SET, not one id: with a single id, a second
     * Verify overwrote the first's spinner (re-enabling a button whose probe was
     * still running), and whichever probe finished first cleared both.
     */
    const [probing, setProbing] = useState<Set<number>>(new Set());
    /** A probe that could not be RUN. Keyed by zone id, never merged into the row's verdict. */
    const [probeErrors, setProbeErrors] = useState<Record<number, string>>({});

    const [zoneForm, setZoneForm] = useState<{ open: boolean; zone: Zone | null }>({
        open: false,
        zone: null,
    });
    const [projectForm, setProjectForm] = useState<{
        zone: Zone;
        project: Project | null;
    } | null>(null);
    const [retiring, setRetiring] = useState<RetireTarget | null>(null);

    /**
     * ⚠️ `includeRetired` is TRUE here and false everywhere else in the app.
     *
     * Retirement is managed on this page, and a retired row that simply vanished
     * would make its slug look free — the exact impression the never-reuse rule
     * exists to prevent. An operator who cannot see that `atlas` was retired last
     * month will try to create it again, read the 409 as a bug, and go looking for
     * a row they have been told does not exist.
     */
    const loadZones = useCallback(async () => {
        // ⚠️ No `setState({phase:"loading"})` here. The initial state is already
        // loading, and a synchronous setState inside the mount effect is a
        // cascading render (react-hooks/set-state-in-effect). A RETRY does need
        // the spinner back, so the retry button sets the phase itself before
        // calling this — see `retryZones` below.
        const res = await reqListZones(true);
        if (!res.success) {
            // The health of every zone rides on this one response, so a failure
            // here means we know NOTHING about any of them. Rendering the page
            // empty — or worse, rendering rows with no verdict — would be the
            // "everything is green" lie this page exists to prevent.
            setState({ phase: "error", message: res.error_message });
            return;
        }
        setState({ phase: "ready", zones: res.data ?? [] });
    }, []);

    const loadProjects = useCallback(async (zoneSlug: string) => {
        setProjects((prev) => {
            const current = prev[zoneSlug];
            return {
                ...prev,
                [zoneSlug]:
                    current?.phase === "ready"
                        ? { ...current, refreshing: true }
                        : { phase: "loading" },
            };
        });
        const res = await reqListProjects(zoneSlug, true);
        if (!res.success) {
            setProjects((prev) => ({
                ...prev,
                [zoneSlug]: { phase: "error", message: res.error_message },
            }));
            return;
        }
        setProjects((prev) => ({
            ...prev,
            [zoneSlug]: { phase: "ready", projects: res.data.projects ?? [] },
        }));
    }, []);

    useEffect(() => {
        // FALSE POSITIVE. Every setState in loadZones is AFTER
        // `await reqListZones(true)`, so none of them runs synchronously with
        // this effect — the rule cannot see through `void loadZones()` into the
        // async body. The synchronous one that DID exist was already removed
        // (see the note at the top of loadZones), and the retry path sets the
        // phase itself precisely so this one does not have to.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (isAdmin) void loadZones();
    }, [isAdmin, loadZones]);

    /** Retry from the failure state: put the skeleton back, then re-read. */
    const retryZones = useCallback(() => {
        setState({ phase: "loading" });
        void loadZones();
    }, [loadZones]);

    const toggleZone = (zoneSlug: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(zoneSlug)) {
                next.delete(zoneSlug);
            } else {
                next.add(zoneSlug);
                if (!projects[zoneSlug]) void loadProjects(zoneSlug);
            }
            return next;
        });
    };

    /**
     * Probe one zone from the list and write the verdict back into the row.
     *
     * ⚠️ A 200 FROM THIS ENDPOINT IS NOT A HEALTHY ZONE. An unreachable — or
     * mismatched — zone answers 200, because the probe itself succeeded; the
     * verdict is in the payload. `res.success` only distinguishes "we got an
     * answer" from "we could not ask", and the second is recorded separately in
     * `probeErrors` so a control-plane fault is never rendered as a fact about
     * the zone.
     */
    const probeZone = async (zone: Zone) => {
        setProbing((prev) => new Set(prev).add(zone.id));
        setProbeErrors((prev) => {
            const next = { ...prev };
            delete next[zone.id];
            return next;
        });

        const res = await reqProbeZone(zone.id);
        setProbing((prev) => {
            const next = new Set(prev);
            next.delete(zone.id);
            return next;
        });

        if (!res.success) {
            setProbeErrors((prev) => ({ ...prev, [zone.id]: res.error_message }));
            return;
        }

        const refreshed = res.data.zone;
        if (!refreshed) return;
        setState((prev) =>
            prev.phase === "ready"
                ? {
                      phase: "ready",
                      zones: prev.zones.map((z) => (z.id === refreshed.id ? refreshed : z)),
                  }
                : prev,
        );
    };

    // Memoised so the two partitions below do not rebuild on every render — the
    // `[]` fallback is a fresh array each time otherwise.
    const zones = useMemo(
        () => (state.phase === "ready" ? state.zones : []),
        [state],
    );

    // Active first, retired in their own section. Retired rows are kept on the
    // page (their slugs are spent and that has to be visible) but they are not
    // choices, so they do not sit among the ones that are.
    const activeZones = useMemo(
        () => zones.filter((z) => z.status === "active"),
        [zones],
    );
    const retiredZones = useMemo(
        () => zones.filter((z) => z.status !== "active"),
        [zones],
    );

    // Only rows with something to probe; an unconfigured zone can only answer
    // "unconfigured", and re-stamping its timestamp makes it look checked.
    const verifiable = activeZones.filter((z) => z.query_url !== "");
    const verifyAll = () => {
        for (const z of verifiable) if (!probing.has(z.id)) void probeZone(z);
    };

    const zonesLoading = isLoading || state.phase === "loading";

    // ⚠️ Auth still resolving renders the PAGE, not a lone spinner: swapping a
    // centred spinner for the header + cards was most of the 0.27 CLS.
    if (!isLoading && !isAdmin) {
        return (
            <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
                <div className="rounded-xl border border-dashed border-border-strong py-12 text-center">
                    <FontAwesomeIcon icon={faServer} className="mb-3 text-3xl text-dimmed" />
                    <p className="text-sm font-medium text-secondary">Admin only</p>
                    <p className="mt-1 text-xs text-muted">
                        You need an administrator role to manage zones and projects.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 basis-64">
                        <h1 className="text-2xl font-semibold text-primary">Zones & Projects</h1>
                        <p className="mt-1 max-w-2xl text-sm text-muted">
                            The tenancy registry: which zones this install knows about, where each
                            one lives, and the projects inside them.
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {/* Rendered (disabled) while loading too, so the header row
                            doesn't widen when the zones land. */}
                        {(zonesLoading || verifiable.length > 1) && (
                            <Button
                                variant="secondary"
                                size="lg"
                                className="gap-2 whitespace-nowrap"
                                onClick={verifyAll}
                                disabled={zonesLoading || verifiable.every((z) => probing.has(z.id))}
                                title="Probe every zone that has a query URL, in parallel"
                            >
                                <FontAwesomeIcon icon={faArrowsRotate} className="text-xs" />
                                Verify all
                            </Button>
                        )}
                        <Button
                            size="lg"
                            className="gap-2 whitespace-nowrap"
                            // Not over an unread registry: the form's live/retired slug
                            // check reads `zones`, so recording blind would let a spent
                            // slug through to the server.
                            disabled={state.phase !== "ready"}
                            onClick={() => setZoneForm({ open: true, zone: null })}
                        >
                            <FontAwesomeIcon icon={faPlus} className="text-xs" />
                            Record a zone
                        </Button>
                    </div>
                </div>

                {/* The framing, once, at the top. Everything on this page is a
                    record of infrastructure someone else provisioned — the page
                    cannot create, move or destroy any of it. */}
                <Alert variant="info">
                    <strong>These rows record infrastructure; they do not create it.</strong>{" "}
                    Recording a zone writes down where a stack that already exists can be
                    reached. Nothing here reconciles a row against reality, so verify a zone
                    after recording or re-pointing it — a URL aimed at the wrong zone answers
                    perfectly and shows you the wrong tenant&apos;s data under the right name.
                </Alert>

                {zonesLoading && <ZoneCardsSkeleton />}

                {/* ⚠️ The failure branch, NOT an empty list. Every zone's health
                    came from this request, so its failure means we know nothing
                    about any of them — and "no zones" would read as an install
                    with nothing in it. */}
                {state.phase === "error" && (
                    <FailureState
                        what="the zone registry"
                        message={state.message}
                        onRetry={retryZones}
                    />
                )}

                {state.phase === "ready" && zones.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border-strong py-12 text-center">
                        <FontAwesomeIcon icon={faServer} className="mb-3 text-3xl text-dimmed" />
                        <p className="text-sm text-muted">No zones recorded</p>
                        <p className="mt-1 text-xs text-muted">
                            Record the zone this install already runs against to see it here.
                        </p>
                    </div>
                )}

                {state.phase === "ready" && activeZones.length > 0 && (
                    <div className="space-y-3">
                        {activeZones.map((zone) => (
                            <ZoneCard
                                key={zone.id}
                                zone={zone}
                                expanded={expanded.has(zone.slug)}
                                onToggle={() => toggleZone(zone.slug)}
                                projects={projects[zone.slug]}
                                onReloadProjects={() => void loadProjects(zone.slug)}
                                probing={probing.has(zone.id)}
                                probeError={probeErrors[zone.id]}
                                onProbe={() => void probeZone(zone)}
                                onEdit={() => setZoneForm({ open: true, zone })}
                                onRetire={() =>
                                    setRetiring({
                                        kind: "zone",
                                        id: zone.id,
                                        slug: zone.slug,
                                        displayName: zone.display_name,
                                    })
                                }
                                onNewProject={() => setProjectForm({ zone, project: null })}
                                onEditProject={(project) => setProjectForm({ zone, project })}
                                onRetireProject={(project) =>
                                    setRetiring({
                                        kind: "project",
                                        id: project.id,
                                        slug: project.slug,
                                        displayName: project.display_name,
                                        zoneSlug: zone.slug,
                                    })
                                }
                            />
                        ))}
                    </div>
                )}

                {state.phase === "ready" && retiredZones.length > 0 && (
                    <div className="space-y-3">
                        <div className="border-t border-border-strong pt-5">
                            <h2 className="text-sm font-semibold text-secondary">Retired zones</h2>
                            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                                Kept forever, and listed here on purpose. The row is what makes the
                                slug permanently spent — a reused slug would reattach the old
                                zone&apos;s surviving events and its permanent daily rollup to
                                whatever took the name. Retiring never tore down the
                                infrastructure; that may still be running.
                            </p>
                        </div>
                        {retiredZones.map((zone) => (
                            <RetiredZoneRow key={zone.id} zone={zone} />
                        ))}
                    </div>
                )}
            </div>

            {zoneForm.open && (
                <ZoneFormModal
                    zone={zoneForm.zone}
                    existing={zones}
                    onClose={() => setZoneForm({ open: false, zone: null })}
                    onChanged={() => void loadZones()}
                />
            )}

            {projectForm && (
                <ProjectFormModal
                    zone={projectForm.zone}
                    project={projectForm.project}
                    existing={(() => {
                        const p = projects[projectForm.zone.slug];
                        return p?.phase === "ready" ? p.projects : [];
                    })()}
                    onClose={() => setProjectForm(null)}
                    onSaved={() => {
                        const zoneSlug = projectForm.zone.slug;
                        setProjectForm(null);
                        void loadProjects(zoneSlug);
                    }}
                />
            )}

            {retiring && (
                <RetireDialog
                    kind={retiring.kind}
                    slug={retiring.slug}
                    displayName={retiring.displayName}
                    // Carried so the dialog can link at THIS project's API keys.
                    // The page has no zone in its path, so a route-derived link
                    // would point at whichever zone the operator was last in.
                    zoneSlug={retiring.zoneSlug}
                    onCancel={() => setRetiring(null)}
                    onRetire={() =>
                        retiring.kind === "zone"
                            ? reqRetireZone(retiring.id)
                            : reqRetireProject(retiring.id)
                    }
                    onRetired={() => {
                        const target = retiring;
                        setRetiring(null);
                        if (target.kind === "zone") void loadZones();
                        else if (target.zoneSlug) void loadProjects(target.zoneSlug);
                    }}
                />
            )}
        </main>
    );
}

/**
 * One active zone: identity, health, endpoints, and its projects.
 *
 * ⚠️ HEALTH IS NEVER BEHIND A CLICK. The chip is in the collapsed header, and
 * anything that is not `healthy` also renders the full panel — meaning, remedy,
 * and what the far end said it was next to what we expected — without the row
 * being expanded. A wrong-zone verdict hidden inside a collapsed accordion is a
 * wrong-zone verdict nobody reads.
 */
function ZoneCard({
    zone,
    expanded,
    onToggle,
    projects,
    onReloadProjects,
    probing,
    probeError,
    onProbe,
    onEdit,
    onRetire,
    onNewProject,
    onEditProject,
    onRetireProject,
}: {
    zone: Zone;
    expanded: boolean;
    onToggle: () => void;
    projects: ProjectsState | undefined;
    onReloadProjects: () => void;
    probing: boolean;
    probeError: string | undefined;
    onProbe: () => void;
    onEdit: () => void;
    onRetire: () => void;
    onNewProject: () => void;
    onEditProject: (project: Project) => void;
    onRetireProject: (project: Project) => void;
}) {
    // A STALE healthy is not healthy here either: it gets the panel saying so.
    const healthy = isFreshHealthy(zone);
    const meta = verdictMeta(zone.reachability, zone.last_probe_at);
    const name = zone.display_name;
    const hasQueryURL = zone.query_url !== "";

    return (
        <div className="overflow-hidden rounded-xl border border-border-strong">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5">
                {/* basis-full below sm: the actions wrap onto their own line
                    instead of squeezing this to ~100px and painting over it. */}
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    // An explicit name: built from content it read out the whole
                    // probe detail string. Expanded/collapsed comes from aria-expanded.
                    aria-label={`${name} (${zone.slug}), ${meta.label}, ${probeAge(zone.last_probe_at)}`}
                    className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-auto"
                >
                    <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        className="w-3 shrink-0 text-xs text-muted"
                    />
                    <span className="min-w-0 flex-1">
                        {/* break-all on the slug and break-words on the name: a long
                            unbroken code string has no wrap point of its own and
                            painted across the Verify button at 320–464px. */}
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words text-sm font-medium text-primary">
                                {zone.display_name}
                            </span>
                            <code className="min-w-0 break-all font-mono text-xs text-muted">{zone.slug}</code>
                        </span>
                        <span className="mt-1 flex">
                            <ZoneHealthChip
                                reachability={zone.reachability}
                                lastProbeAt={zone.last_probe_at}
                            />
                        </span>
                    </span>
                </button>

                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {/* Disabled with no query URL: the probe could only answer
                        "unconfigured", and re-stamping "checked just now" made an
                        uncheckable row look freshly checked. */}
                    <Button
                        variant="secondary"
                        size="sm"
                        loading={probing}
                        disabled={!hasQueryURL}
                        onClick={onProbe}
                        className="gap-1.5"
                        aria-label={`Verify zone ${name}`}
                        title={
                            hasQueryURL
                                ? "Ask the query URL who it is, and record the answer"
                                : "Record a query URL first — there is nothing to probe"
                        }
                    >
                        {!probing && <FontAwesomeIcon icon={faArrowsRotate} className="text-[11px]" />}
                        Verify
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onEdit}
                        className="gap-1.5"
                        aria-label={`Edit zone ${name}`}
                        title={`Edit zone ${name}`}
                    >
                        <FontAwesomeIcon icon={faPen} className="text-[11px]" />
                        Edit
                    </Button>
                    {/* ⚠️ faLock, not faTrash. This is not a delete and the icon must
                        not suggest one — what the action does is lock the slug away
                        forever. */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onRetire}
                        className="gap-1.5"
                        aria-label={`Retire zone ${name}`}
                        title={`Retire zone ${name}`}
                    >
                        <FontAwesomeIcon icon={faLock} className="text-[11px]" />
                        Retire
                    </Button>
                </div>
            </div>

            {/* ⚠️ "We could not run the probe" — kept apart from every verdict.
                Merging it into the row's reachability would report a control-plane
                fault as a fact about the zone. */}
            {probeError && (
                <div className="px-4 pb-3">
                    <Alert variant="error">
                        <strong>Could not run the check.</strong> {probeError} This is a failure
                        to ask, not an answer — the verdict above is still whatever the last
                        successful probe found.
                    </Alert>
                </div>
            )}

            {/* Anything short of healthy explains itself in place, collapsed or not. */}
            {!healthy && (
                <div className="px-4 pb-3">
                    {/* The chip is already in the header right above. */}
                    <ZoneHealthPanel zone={zone} showChip={false}>
                        {!hasQueryURL && (
                            <Button variant="secondary" size="sm" className="gap-1.5" onClick={onEdit}>
                                <FontAwesomeIcon icon={faPen} className="text-[11px]" />
                                Add query URL
                            </Button>
                        )}
                    </ZoneHealthPanel>
                </div>
            )}

            {expanded && (
                <div className="space-y-4 border-t border-border-strong bg-surface-elevated/30 px-4 py-4">
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Endpoint
                            label="Ingest URL"
                            value={zone.ingest_url}
                            note="Public origin SDKs post events to."
                            zoneName={name}
                        />
                        <Endpoint
                            label="Query URL"
                            zoneName={name}
                            value={zone.query_url}
                            note="What this control plane reads through, and what Verify probes."
                        />
                    </dl>

                    <div className="flex items-center justify-between gap-3 border-t border-border-strong pt-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">
                            Projects
                        </h3>
                        <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1.5"
                            onClick={onNewProject}
                            // Same reason as "Record a zone": the form's slug check
                            // needs this zone's project list.
                            disabled={projects?.phase !== "ready"}
                            aria-label={`New project in zone ${name}`}
                        >
                            <FontAwesomeIcon icon={faPlus} className="text-[11px]" />
                            New project
                        </Button>
                    </div>

                    {/* One row at ProjectRow's height (py-2 around an h-7 button
                        row) — most zones hold one project, so that is what lands. */}
                    {projects?.phase === "loading" && (
                        <div role="status" aria-label="Loading projects" className="flex h-11 items-center justify-between gap-2 py-2">
                            <span className="flex items-center gap-2">
                                <Skeleton className="h-3.5 w-24" />
                                <Skeleton className="h-3 w-14" />
                            </span>
                            <span className="flex items-center gap-1">
                                <Skeleton className="h-7 w-20 rounded-lg" />
                                <Skeleton className="h-7 w-14 rounded-lg" />
                                <Skeleton className="h-7 w-16 rounded-lg" />
                            </span>
                        </div>
                    )}

                    {/* Down is not empty, at this scale too: an inline note rather
                        than a silently empty project list. */}
                    {projects?.phase === "error" && (
                        <FailureNote
                            what="projects"
                            message={projects.message}
                            onRetry={onReloadProjects}
                            className="py-2"
                        />
                    )}

                    {projects?.phase === "ready" && (
                        <RefetchBar active={projects.refreshing === true} className="-my-2" />
                    )}

                    {projects?.phase === "ready" && projects.projects.length === 0 && (
                        <p className="py-2 text-xs text-muted">
                            No projects in this zone yet.
                        </p>
                    )}

                    {projects?.phase === "ready" && projects.projects.length > 0 && (
                        <ul className="divide-y divide-border-subtle">
                            {projects.projects.map((project) => (
                                <ProjectRow
                                    key={project.id}
                                    zone={zone}
                                    project={project}
                                    onEdit={() => onEditProject(project)}
                                    onRetire={() => onRetireProject(project)}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * One project inside an expanded zone, with its "Connect" drawer: the zone's
 * ingest endpoint and a test event ready to paste, so wiring up a new service
 * does not start with reading the SDK's source for the wire format.
 *
 * ⚠️ NO KEY IS EVER IN THE SNIPPET. Keys are shown once at mint time and this
 * page never holds one; the snippet carries a placeholder and links to the page
 * that mints one — built from THIS ROW's zone and slug, never the route (this
 * page has no zone in its path; see RetireDialog's `zoneSlug`).
 */
function ProjectRow({
    zone,
    project,
    onEdit,
    onRetire,
}: {
    zone: Zone;
    project: Project;
    onEdit: () => void;
    onRetire: () => void;
}) {
    const [connectOpen, setConnectOpen] = useState(false);
    const label = `${project.display_name} in ${zone.slug}`;
    const active = project.status === "active";

    return (
        <li className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words text-sm text-primary">{project.display_name}</span>
                    <code className="min-w-0 break-all font-mono text-xs text-muted">{project.slug}</code>
                    {!active && (
                        <span className="rounded-full border border-border-strong bg-surface-elevated px-2 py-0.5 text-[11px] leading-none text-muted">
                            retired — slug spent
                        </span>
                    )}
                </span>
                {/* A retired project offers no actions: the API refuses a second
                    retirement with a 409, and renaming a row nothing can reach is
                    noise. */}
                {active && (
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setConnectOpen((o) => !o)}
                            aria-expanded={connectOpen}
                            aria-label={`Connect a service to project ${label}`}
                            title="Ingest endpoint and a test event to paste"
                        >
                            <FontAwesomeIcon icon={faPlug} className="text-[11px]" />
                            Connect
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={onEdit}
                            aria-label={`Edit project ${label}`}
                            title={`Edit project ${label}`}
                        >
                            <FontAwesomeIcon icon={faPen} className="text-[11px]" />
                            Edit
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={onRetire}
                            aria-label={`Retire project ${label}`}
                            title={`Retire project ${label}`}
                        >
                            <FontAwesomeIcon icon={faLock} className="text-[11px]" />
                            Retire
                        </Button>
                    </span>
                )}
            </div>
            {active && connectOpen && <ConnectSnippets zone={zone} project={project} />}
        </li>
    );
}

/** `https://host` + `/v1/events`, tolerating a recorded trailing slash. */
function ingestEndpoint(ingestURL: string): string {
    return `${ingestURL.replace(/\/+$/, "")}/v1/events`;
}

function ConnectSnippets({ zone, project }: { zone: Zone; project: Project }) {
    const keysHref = zoneHref(zone.slug, "/settings", project.slug);

    if (zone.ingest_url === "") {
        return (
            <p className="mt-2 rounded-lg border border-border-strong bg-surface-elevated/50 px-3 py-2 text-xs text-muted">
                No ingest URL is recorded for {zone.slug}, so there is nothing to post to yet.
                Edit the zone and record one first.
            </p>
        );
    }

    const endpoint = ingestEndpoint(zone.ingest_url);
    const keyPlaceholder = `<ingest key for ${project.slug}>`;
    // The project is NOT in the payload: ingest derives it from the key and
    // overwrites anything the sender claims. Which key you use IS the project.
    // `timestamp`, `service` and `name` are the fields monitor-core requires.
    const curl = [
        `export MONITOR_API_KEY="${keyPlaceholder}"`,
        `curl -sS -X POST "${endpoint}" \\`,
        `  -H "X-Api-Key: $MONITOR_API_KEY" \\`,
        `  -H "Content-Type: application/x-ndjson" \\`,
        `  --data-binary "{\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\",\\"service\\":\\"my-service\\",\\"env\\":\\"production\\",\\"name\\":\\"setup.test_event.success\\",\\"level\\":\\"info\\",\\"data\\":{}}"`,
    ].join("\n");
    const js = [
        `import { Monitor } from "@aidenappleby/monitor-js";`,
        ``,
        `const monitor = new Monitor({`,
        `  service: "my-service",`,
        `  ingestUrl: "${endpoint}",`,
        `  apiKey: process.env.MONITOR_API_KEY!, // ${keyPlaceholder}`,
        `  env: "production",`,
        `});`,
        ``,
        `monitor.info("setup.test_event.success");`,
    ].join("\n");

    return (
        <div className="mt-2 space-y-3 rounded-lg border border-border-strong bg-surface-elevated/40 px-3 py-3">
            <p className="text-xs leading-relaxed text-secondary">
                Events land in <span className="font-mono text-primary">{project.slug}</span>{" "}
                because of the key they are sent with — ingest files every event under its
                key&apos;s project. Mint a key in{" "}
                <Link href={keysHref} className="text-primary underline underline-offset-2">
                    {zone.slug} → zone settings → API keys
                </Link>
                , then send a test event:
            </p>
            <Snippet label="curl" code={curl} copyLabel={`curl example for ${project.slug}`} />
            <Snippet
                label="monitor-js"
                code={js}
                copyLabel={`monitor-js example for ${project.slug}`}
            />
        </div>
    );
}

function Snippet({ label, code, copyLabel }: { label: string; code: string; copyLabel: string }) {
    return (
        <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-secondary">
                    {label}
                </span>
                <CopyButton text={code} label={copyLabel} />
            </div>
            <pre className="overflow-x-auto rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-primary">
                {code}
            </pre>
        </div>
    );
}

/** Icon-only copy; `label` names what is copied (for the toast and the button). */
function CopyButton({ text, label }: { text: string; label: string }) {
    return (
        <button
            type="button"
            onClick={() => void copyText(text, { label })}
            aria-label={`Copy ${label}`}
            title={`Copy ${label}`}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-elevated hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <FontAwesomeIcon icon={faCopy} className="text-[11px]" />
        </button>
    );
}

function Endpoint({
    label,
    value,
    note,
    zoneName,
}: {
    label: string;
    value: string;
    note: string;
    zoneName: string;
}) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-secondary">
                {label}
            </dt>
            {/* An unrecorded URL is a real state and says so, rather than showing a
                blank line that reads as a rendering bug. */}
            <dd className="mt-0.5 flex items-start gap-1.5 break-all font-mono text-xs text-primary">
                {value === "" ? (
                    <span className="font-sans text-pending">not recorded</span>
                ) : (
                    <>
                        <span className="min-w-0 pt-0.5">{value}</span>
                        <CopyButton text={value} label={`${zoneName} ${label.toLowerCase()}`} />
                    </>
                )}
            </dd>
            <p className="mt-0.5 text-[11px] text-muted">{note}</p>
        </div>
    );
}

/**
 * A retired zone. Rendered flat and without actions — the row exists to prove the
 * slug is spent, not to be operated on.
 */
function RetiredZoneRow({ zone }: { zone: Zone }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3 opacity-80">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm text-secondary">{zone.display_name}</span>
                <code className="min-w-0 break-all font-mono text-xs text-muted">{zone.slug}</code>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-elevated px-2 py-0.5 text-[11px] leading-none text-muted">
                    <FontAwesomeIcon icon={faLock} className="text-[9px]" />
                    retired — slug spent forever
                </span>
            </span>
            <code className="break-all font-mono text-[11px] text-muted">
                {zone.query_url || "no query URL"}
            </code>
        </div>
    );
}

/**
 * Placeholders for the zone list, shaped like a ZoneCard AS IT USUALLY LANDS:
 * the header (name + slug over the health chip, with the three actions wrapping
 * onto their own line below sm) AND the health panel under it. Nothing
 * re-probes on a timer, so most verdicts are past 24h and render "Healthy ·
 * stale" with its panel; a skeleton of only the header was ~88px against a
 * ~360px card at 390px, and the whole list jumped when it landed.
 */
function ZoneCardsSkeleton() {
    return (
        <div className="space-y-3" role="status" aria-label="Loading zones">
            {[0, 1, 2].map((i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-border-strong">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5">
                        <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
                            <Skeleton className="h-3 w-3 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="flex h-5 items-center gap-2">
                                    <Skeleton className="h-3.5" style={{ width: [96, 80, 112][i] }} />
                                    <Skeleton className="h-3" style={{ width: [64, 56, 72][i] }} />
                                </div>
                                <div className="mt-1 flex h-[18px] items-center gap-2">
                                    <Skeleton className="h-[18px] w-24 rounded-full" />
                                    <Skeleton className="h-2.5 w-16 bg-zinc-100 dark:bg-zinc-800/60" />
                                </div>
                            </div>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                            <Skeleton className="h-7 w-[74px] rounded-lg" />
                            <Skeleton className="h-7 w-14 rounded-lg" />
                            <Skeleton className="h-7 w-16 rounded-lg" />
                        </div>
                    </div>
                    {/* The health panel: meaning, remedy and the probe detail —
                        three lines from sm, ~eight once they wrap at phone width. */}
                    <div className="px-4 pb-3">
                        <div className="space-y-2 rounded-lg border border-border px-3.5 py-3">
                            <Skeleton className="h-3 w-11/12" />
                            <Skeleton className="h-3 w-4/5 sm:hidden" />
                            <Skeleton className="h-3 w-3/4 sm:hidden" />
                            <Skeleton className="h-3 w-2/3" />
                            <Skeleton className="h-3 w-5/6 sm:hidden" />
                            <Skeleton className="h-3 w-1/2 sm:hidden" />
                            <Skeleton className="mt-3 h-2.5 w-3/5 bg-zinc-100 dark:bg-zinc-800/60" />
                            <Skeleton className="h-2.5 w-2/5 bg-zinc-100 dark:bg-zinc-800/60 sm:hidden" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
