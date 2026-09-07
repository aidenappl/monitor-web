"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { FixedSlug } from "@/components/admin/ZoneFormModal";
import { reqCreateProject, reqUpdateProject } from "@/services/api";
import type { Project, Zone } from "@/types";

/**
 * Create or rename a project inside one zone.
 *
 * ⚠️ NO PROBE STEP, AND THAT ASYMMETRY WITH THE ZONE FORM IS DELIBERATE. A zone
 * row points at infrastructure that may or may not be the infrastructure it
 * names, which is why recording one has to be followed by asking the far end who
 * it is. A project is a dimension INSIDE a zone that has already been verified —
 * there is no second box to point at and nothing to confuse it with, so there is
 * nothing to probe.
 *
 * ⚠️ A PROJECT SLUG IS UNIQUE ONLY WITHIN ITS ZONE, so create hangs off the zone
 * (`POST /admin/zones/{id}/projects`) while update and retire take the project's
 * own global id. A project is never meaningful without the zone it was listed
 * from.
 *
 * The reserved-slug list is NOT mirrored here — see the note in ZoneFormModal.
 */
const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const SLUG_MIN = 3;
const SLUG_MAX = 30;

function slugProblem(slug: string): string | undefined {
    if (slug === "") return "Slug is required.";
    if (slug.length < SLUG_MIN || slug.length > SLUG_MAX)
        return `Must be ${SLUG_MIN}–${SLUG_MAX} characters.`;
    if (!SLUG_PATTERN.test(slug))
        return "Lowercase letters, digits and hyphens; must start with a letter and end with a letter or digit.";
    return undefined;
}

export function ProjectFormModal({
    zone,
    /** null → create inside `zone`. A Project → rename that row. */
    project,
    onClose,
    onSaved,
}: {
    zone: Zone;
    project: Project | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const isCreate = project === null;

    const [slug, setSlug] = useState(project?.slug ?? "");
    const [displayName, setDisplayName] = useState(project?.display_name ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);

    const slugError = isCreate ? slugProblem(slug.trim()) : undefined;
    const nameError = displayName.trim() === "" ? "Required." : undefined;
    const invalid = Boolean(slugError || nameError);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (invalid) return;

        setSaving(true);
        setError(null);

        // Explicit success branch on both paths — the shared axios client returns
        // a non-2xx as a value, so nothing here would throw on a 409 and a
        // try/catch would be dead code.
        const res = isCreate
            ? await reqCreateProject(zone.id, {
                  slug: slug.trim(),
                  display_name: displayName.trim(),
              })
            : await reqUpdateProject(project.id, {
                  display_name: displayName.trim(),
              });

        if (!res.success) {
            // Two refusals reach here with messages worth reading verbatim: a slug
            // already spent (409, including by a retired project) and a retired
            // zone that cannot take new tenants (409).
            setError(
                res.error_message ||
                    (isCreate ? "Failed to create the project" : "Failed to save the project"),
            );
            setSaving(false);
            return;
        }
        onSaved();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
            <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
            <div className="relative w-full max-w-lg rounded-2xl border border-border-strong bg-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-border-strong px-5 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-primary">
                            {isCreate ? "New project" : `Edit ${project.display_name}`}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted">
                            in zone <span className="font-mono">{zone.slug}</span>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-elevated"
                        aria-label="Close"
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>

                <form onSubmit={submit} className="space-y-4 px-5 py-4">
                    {error && <Alert variant="error">{error}</Alert>}

                    {isCreate ? (
                        <Input
                            label="Slug *"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            placeholder="atlas"
                            error={slug === "" ? undefined : slugError}
                            hint="Permanent, and unique within this zone. Every event is filed under it."
                            autoFocus
                        />
                    ) : (
                        <FixedSlug slug={slug} kind="project" />
                    )}

                    <Input
                        label="Display name *"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Atlas"
                        error={displayName === "" ? undefined : nameError}
                        hint="The label in the project switcher. Change it any time."
                    />

                    {isCreate && (
                        <Alert variant="info">
                            Creating the project does not start any ingestion. Events arrive
                            once something posts with an API key scoped to it — mint that in{" "}
                            <strong>Settings → API keys</strong>.
                        </Alert>
                    )}

                    <div className="flex justify-end gap-2 border-t border-border-strong pt-4">
                        <Button type="button" variant="secondary" size="lg" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" size="lg" loading={saving} disabled={invalid}>
                            {isCreate ? "Create project" : "Save changes"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
