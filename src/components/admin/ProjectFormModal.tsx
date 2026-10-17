"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { useConfirm } from "@/components/ConfirmProvider";
import { FixedSlug, slugProblem } from "@/components/admin/ZoneFormModal";
import { reqCreateProject, reqUpdateProject } from "@/services/api";
import { zoneHref } from "@/tools/routing.tools";
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
 *
 * ⚠️ IT IS A REAL DIALOG NOW. This was a bare fixed-position div with an overlay
 * — the exact shape `components/ui/modal.tsx` names and forbids. It looked
 * identical and was unusable with a keyboard: no focus trap, so Tab walked into
 * the page behind the backdrop; no Escape; no `role="dialog"`, so a screen
 * reader announced nothing. Worse for this form specifically, the backdrop's
 * onClick was live WHILE SAVING, so a stray click discarded a fully typed form
 * mid-request. `Modal` brings all four, and `onClose` is neutered while the
 * write is in flight.
 */
const FORM_ID = "project-form";

/**
 * A slug this zone has already spent, said before the 409 rather than after it.
 *
 * The page already holds this zone's projects INCLUDING retired ones (it reads
 * with `include_deleted`), and a retired slug is just as spent as a live one —
 * so both are checked, and the message says which. The server's 409 stays the
 * authority; this only saves a round trip the page had the data to avoid.
 */
function duplicateProblem(slug: string, zoneSlug: string, existing: Project[]): string | undefined {
    const hit = existing.find((p) => p.slug === slug);
    if (!hit) return undefined;
    return hit.status === "active"
        ? `${slug} is already a project in ${zoneSlug}.`
        : `${slug} was retired in ${zoneSlug} — a retired slug is spent forever and cannot be reused.`;
}

export function ProjectFormModal({
    zone,
    /** null → create inside `zone`. A Project → rename that row. */
    project,
    existing = [],
    onClose,
    onSaved,
}: {
    zone: Zone;
    project: Project | null;
    /** This zone's projects, active AND retired, for the duplicate-slug check. Empty if not loaded. */
    existing?: Project[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const isCreate = project === null;

    const [slug, setSlug] = useState(project?.slug ?? "");
    const [displayName, setDisplayName] = useState(project?.display_name ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Focus the first field the operator actually has to fill in. On an edit the
    // slug is fixed, so that is the display name.
    const firstFieldRef = useRef<HTMLInputElement>(null);

    const confirm = useConfirm();

    const slugError = isCreate
        ? (slugProblem(slug.trim()) ?? duplicateProblem(slug.trim(), zone.slug, existing))
        : undefined;
    const nameError = displayName.trim() === "" ? "Required." : undefined;
    const dirty =
        slug !== (project?.slug ?? "") || displayName !== (project?.display_name ?? "");
    // An edit with nothing changed would PUT the row back as it was.
    const invalid = Boolean(slugError || nameError) || (!isCreate && !dirty);

    /**
     * Escape, the backdrop and Cancel all land here. A typed form is not thrown
     * away on one keypress: Modal's stack means Escape on the confirm answers
     * the confirm, not this dialog.
     */
    const requestClose = async () => {
        if (saving) return;
        if (
            dirty &&
            !(await confirm({
                title: "Discard changes?",
                description: "What you typed in this form will be lost.",
                confirmLabel: "Discard",
                destructive: true,
            }))
        )
            return;
        onClose();
    };

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

    /**
     * ⚠️ BUILT FROM THE ROW, NEVER FROM THE CURRENT ROUTE.
     *
     * This dialog is only ever opened from `/admin/registry`, which is
     * zone-agnostic — there is no zone in the path and no `ScopeBoundary` above
     * it, so `useZoneHref` would fall back to the remembered zone or to
     * FALLBACK_ZONE and hand out a link into whichever zone the operator happened
     * to be in last. That is a link that works, lands somewhere real, and shows a
     * different tenant's keys. The zone is right here in `zone.slug`; use it.
     *
     * On an edit the project exists, so the link selects it. On a create it does
     * not exist yet — a `?project=` naming a row that has not been written 400s
     * every request on the page it lands on — so the link goes to the zone and
     * the copy says to pick the project once it is there.
     */
    const keysHref = isCreate
        ? zoneHref(zone.slug, "/settings")
        : zoneHref(zone.slug, "/settings", project.slug);

    return (
        <Modal
            open
            // Dismissal is disabled while the write is in flight. The old bare-div
            // version left the backdrop live, so a stray click during the request
            // threw away a fully typed form and left the operator unsure whether
            // the project had been created.
            onClose={() => void requestClose()}
            dismissible={!saving}
            title={isCreate ? "New project" : `Edit ${project.display_name}`}
            description={
                <>
                    in zone <span className="font-mono">{zone.slug}</span>
                </>
            }
            initialFocusRef={firstFieldRef}
            widthClass="max-w-lg"
            footer={
                <>
                    <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        onClick={() => void requestClose()}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    {/* `form=` rather than nesting the buttons inside the <form>:
                        Modal renders its footer outside the children slot, and
                        the association is what keeps Enter-to-submit working. */}
                    <Button
                        type="submit"
                        form={FORM_ID}
                        size="lg"
                        loading={saving}
                        disabled={invalid}
                    >
                        {isCreate ? "Create project" : "Save changes"}
                    </Button>
                </>
            }
        >
            <form id={FORM_ID} onSubmit={submit} className="space-y-4">
                {error && <Alert variant="error">{error}</Alert>}

                {isCreate ? (
                    <Input
                        ref={firstFieldRef}
                        label="Slug *"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="atlas"
                        error={slug === "" ? undefined : slugError}
                        hint="Permanent, and unique within this zone. Every event is filed under it."
                    />
                ) : (
                    <FixedSlug slug={slug} kind="project" />
                )}

                <Input
                    ref={isCreate ? undefined : firstFieldRef}
                    label="Display name *"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Atlas"
                    error={displayName === "" ? undefined : nameError}
                    hint="The label in the project switcher. Change it any time."
                />

                {isCreate ? (
                    <Alert variant="info">
                        Creating the project does not start any ingestion. Events arrive once
                        something posts with an API key scoped to it — mint that in{" "}
                        <Link href={keysHref} className="underline underline-offset-2">
                            {zone.slug} → zone settings → API keys
                        </Link>
                        , selecting this project in the header&apos;s scope control once it
                        exists.
                    </Alert>
                ) : (
                    <Alert variant="info">
                        Ingestion for this project is controlled by its API keys, in{" "}
                        <Link href={keysHref} className="underline underline-offset-2">
                            {zone.slug} → zone settings → API keys
                        </Link>
                        .
                    </Alert>
                )}
            </form>
        </Modal>
    );
}
