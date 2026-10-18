"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { reqListProjects, reqListZones } from "@/services/api";
import type { ListProjectsResponse, Zone } from "@/types";
import { useScope } from "@/hooks/useScope";
import { useRole } from "@/hooks/useRole";
import { FailureState } from "@/components/FailureState";
import { ZoneHealthPanel } from "@/components/admin/ZoneHealth";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { zoneHref } from "@/tools/routing.tools";

/**
 * This zone as the registry records it: its name, its two URLs, the last
 * health verdict, and its projects. READ-ONLY on purpose.
 *
 * ⚠️ WHY EDITS ARE NOT HERE. A zone's row and its projects live on the CONTROL
 * PLANE, and the registry page (`/settings/admin/registry`) is where the
 * record / verify / retire flows already are, admin-gated, with their probe
 * step and type-to-confirm. A second copy of those dialogs here would agree
 * with the first only until someone edited one. This page answers "what is
 * this zone and what's in it" for everyone; admins get a link to change it.
 */
export default function ZoneInfoPage() {
    const { zone, project } = useScope();
    const { isAdmin } = useRole();
    const [row, setRow] = useState<Zone | null>(null);
    const [projects, setProjects] = useState<ListProjectsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        let cancelled = false;
        Promise.all([reqListZones(), reqListProjects(zone)]).then(([zonesRes, projectsRes]) => {
            if (cancelled) return;
            if (!zonesRes.success) {
                setError(zonesRes.error_message || "The zone registry did not answer.");
            } else if (!projectsRes.success) {
                setError(projectsRes.error_message || "This zone's projects did not load.");
            } else {
                // Absent from the list = retired since the page loaded; the
                // layout let us in, so say so rather than render blanks.
                const found = zonesRes.data.find((z) => z.slug === zone) ?? null;
                if (!found) setError(`The registry has no active zone "${zone}".`);
                setRow(found);
                setProjects(projectsRes.data);
            }
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [zone, reloadToken]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Zone &amp; projects</h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    How the registry records <strong className="font-medium text-zinc-700 dark:text-zinc-300">{zone}</strong>.
                    {isAdmin ? (
                        <>
                            {" "}
                            Change it in{" "}
                            <Link href="/settings/admin/registry" className="text-blue-600 hover:underline dark:text-blue-400">
                                Zones &amp; projects
                            </Link>
                            .
                        </>
                    ) : (
                        " Only an admin can change it."
                    )}
                </p>
            </div>

            {error ? (
                <FailureState
                    what="this zone's registry record"
                    message={error}
                    onRetry={() => {
                        // Reset here, not in the effect: the effect only answers.
                        setError(null);
                        setLoading(true);
                        setReloadToken((n) => n + 1);
                    }}
                />
            ) : loading || !row || !projects ? (
                <div className="space-y-6" role="status" aria-label="Loading zone">
                    <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-80 max-w-full" />
                        <Skeleton className="h-3 w-72 max-w-full" />
                        <Skeleton className="h-16 w-full bg-zinc-100 dark:bg-zinc-800/60" />
                    </div>
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                        <SkeletonRows rows={2} label="Loading projects" rowClass="h-12" leading={false} />
                    </div>
                </div>
            ) : (
                <>
                    <section aria-labelledby="zone-record" className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <h2 id="zone-record" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                            {row.display_name} <span className="font-mono text-sm font-normal text-zinc-500">{row.slug}</span>
                        </h2>
                        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                            <dt className="text-zinc-500 dark:text-zinc-400">Ingest URL</dt>
                            <dd className="break-all font-mono text-zinc-800 dark:text-zinc-200">{row.ingest_url || "—"}</dd>
                            <dt className="text-zinc-500 dark:text-zinc-400">Query URL</dt>
                            <dd className="break-all font-mono text-zinc-800 dark:text-zinc-200">{row.query_url || "—"}</dd>
                        </dl>
                        <ZoneHealthPanel zone={row} />
                    </section>

                    <section aria-labelledby="zone-projects" className="space-y-3">
                        <h2 id="zone-projects" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                            Projects
                        </h2>
                        {projects.projects.length === 0 ? (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                No projects yet — events go to the install default, {projects.default_project_slug}.
                            </p>
                        ) : (
                            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                                {projects.projects.map((p) => {
                                    const isDefault = p.slug === projects.default_project_slug;
                                    const current = (project ?? projects.default_project_slug) === p.slug;
                                    return (
                                        <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                                            <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.display_name}</span>
                                            <span className="font-mono text-xs text-zinc-500">{p.slug}</span>
                                            {isDefault && <Badge>default</Badge>}
                                            {current && <Badge>selected</Badge>}
                                            <Link
                                                href={zoneHref(zone, "/settings/api-keys", isDefault ? null : p.slug)}
                                                className="ml-auto text-blue-600 hover:underline dark:text-blue-400"
                                            >
                                                API keys →
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
