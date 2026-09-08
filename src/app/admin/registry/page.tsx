"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowsRotate,
    faChevronDown,
    faChevronRight,
    faLock,
    faPen,
    faPlus,
    faServer,
    faSpinner,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
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
import { FailureState, FailureNote } from "@/components/FailureState";
import { ZoneHealthChip, ZoneHealthPanel } from "@/components/admin/ZoneHealth";
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
    | { phase: "ready"; projects: Project[] }
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

    const [probing, setProbing] = useState<number | null>(null);
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
        setProjects((prev) => ({ ...prev, [zoneSlug]: { phase: "loading" } }));
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

    /** Retry from the failure state: put the spinner back, then re-read. */
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
        setProbing(zone.id);
        setProbeErrors((prev) => {
            const next = { ...prev };
            delete next[zone.id];
            return next;
        });

        const res = await reqProbeZone(zone.id);
        setProbing(null);

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

    if (isLoading) {
        return (
            <main className="mx-auto flex max-w-5xl justify-center px-4 py-16 sm:px-6 lg:px-8">
                <FontAwesomeIcon icon={faSpinner} className="animate-spin text-lg text-muted" />
            </main>
        );
    }

    if (!isAdmin) {
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
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold text-primary">Zones & Projects</h1>
                        <p className="mt-1 max-w-2xl text-sm text-muted">
                            The tenancy registry: which zones this install knows about, where each
                            one lives, and the projects inside them.
                        </p>
                    </div>
                    <Button size="lg" className="gap-2" onClick={() => setZoneForm({ open: true, zone: null })}>
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Record a zone
                    </Button>
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

                {state.phase === "loading" && (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon icon={faSpinner} className="animate-spin text-lg text-muted" />
                    </div>
                )}

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
                                probing={probing === zone.id}
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
                    onClose={() => setZoneForm({ open: false, zone: null })}
                    onChanged={() => void loadZones()}
                />
            )}

            {projectForm && (
                <ProjectFormModal
                    zone={projectForm.zone}
                    project={projectForm.project}
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
    const healthy = zone.reachability === "healthy";

    return (
        <div className="overflow-hidden rounded-xl border border-border-strong">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                    <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        className="w-3 shrink-0 text-xs text-muted"
                    />
                    <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-primary">
                                {zone.display_name}
                            </span>
                            <code className="font-mono text-xs text-muted">{zone.slug}</code>
                        </span>
                        <span className="mt-1 flex">
                            <ZoneHealthChip
                                reachability={zone.reachability}
                                lastProbeAt={zone.last_probe_at}
                                detail={zone.reachability_detail}
                            />
                        </span>
                    </span>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                        variant="secondary"
                        size="sm"
                        loading={probing}
                        onClick={onProbe}
                        className="gap-1.5"
                        title="Ask the query URL who it is, and record the answer"
                    >
                        {!probing && <FontAwesomeIcon icon={faArrowsRotate} className="text-[11px]" />}
                        Verify
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1.5">
                        <FontAwesomeIcon icon={faPen} className="text-[11px]" />
                        Edit
                    </Button>
                    {/* ⚠️ faLock, not faTrash. This is not a delete and the icon must
                        not suggest one — what the action does is lock the slug away
                        forever. */}
                    <Button variant="ghost" size="sm" onClick={onRetire} className="gap-1.5">
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
                    <ZoneHealthPanel zone={zone} />
                </div>
            )}

            {expanded && (
                <div className="space-y-4 border-t border-border-strong bg-surface-elevated/30 px-4 py-4">
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Endpoint
                            label="Ingest URL"
                            value={zone.ingest_url}
                            note="Public origin SDKs post events to."
                        />
                        <Endpoint
                            label="Query URL"
                            value={zone.query_url}
                            note="What this control plane reads through, and what Verify probes."
                        />
                    </dl>

                    <div className="flex items-center justify-between gap-3 border-t border-border-strong pt-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">
                            Projects
                        </h3>
                        <Button variant="secondary" size="sm" className="gap-1.5" onClick={onNewProject}>
                            <FontAwesomeIcon icon={faPlus} className="text-[11px]" />
                            New project
                        </Button>
                    </div>

                    {projects?.phase === "loading" && (
                        <p className="py-2 text-xs text-muted">
                            <FontAwesomeIcon icon={faSpinner} className="mr-1.5 animate-spin" />
                            Loading projects…
                        </p>
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

                    {projects?.phase === "ready" && projects.projects.length === 0 && (
                        <p className="py-2 text-xs text-muted">
                            No projects in this zone yet.
                        </p>
                    )}

                    {projects?.phase === "ready" && projects.projects.length > 0 && (
                        <ul className="divide-y divide-border-subtle">
                            {projects.projects.map((project) => (
                                <li
                                    key={project.id}
                                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                                >
                                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                                        <span className="text-sm text-primary">
                                            {project.display_name}
                                        </span>
                                        <code className="font-mono text-xs text-muted">
                                            {project.slug}
                                        </code>
                                        {project.status !== "active" && (
                                            <span className="rounded-full border border-border-strong bg-surface-elevated px-2 py-0.5 text-[11px] leading-none text-muted">
                                                retired — slug spent
                                            </span>
                                        )}
                                    </span>
                                    {/* A retired project offers no actions: the API
                                        refuses a second retirement with a 409, and
                                        renaming a row nothing can reach is noise. */}
                                    {project.status === "active" && (
                                        <span className="flex shrink-0 items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => onEditProject(project)}
                                            >
                                                <FontAwesomeIcon icon={faPen} className="text-[11px]" />
                                                Edit
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => onRetireProject(project)}
                                            >
                                                <FontAwesomeIcon icon={faLock} className="text-[11px]" />
                                                Retire
                                            </Button>
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function Endpoint({
    label,
    value,
    note,
}: {
    label: string;
    value: string;
    note: string;
}) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-secondary">
                {label}
            </dt>
            {/* An unrecorded URL is a real state and says so, rather than showing a
                blank line that reads as a rendering bug. */}
            <dd className="mt-0.5 break-all font-mono text-xs text-primary">
                {value === "" ? (
                    <span className="font-sans text-pending">not recorded</span>
                ) : (
                    value
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
                <span className="text-sm text-secondary">{zone.display_name}</span>
                <code className="font-mono text-xs text-muted">{zone.slug}</code>
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
