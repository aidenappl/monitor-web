"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ApiResult } from "@/types/auth.types";

/**
 * The retirement confirmation, for a zone or a project.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS DIALOG IS NOT A DELETE CONFIRMATION AND MUST NOT READ LIKE ONE.
 *
 * There is no DELETE verb anywhere on the registry API. Retiring sets
 * `status = "deleted"` and keeps the row FOREVER, which is what makes the UNIQUE
 * key on slug spend the name permanently. That is deliberate: events carry a
 * 30-day TTL and the occurrence rollup has none, so a recycled slug would
 * reattach a month of one tenant's events — plus a permanent daily rollup — to a
 * different tenant, with every reference still syntactically valid and nothing
 * logged anywhere.
 *
 * So the copy has to say two things a "are you sure?" dialog never says:
 *
 *   1. WHAT IS SPENT — the slug, forever, including for a future re-creation.
 *      An operator who thinks they can undo this by making it again is going to
 *      hit a 409 and read it as a bug.
 *   2. WHAT IS *NOT* DONE — retiring a zone tears down no infrastructure, and
 *      retiring a project does not stop a single event arriving. The key keeps
 *      working until someone revokes it, and those events keep landing.
 *
 * Both of those are things the operator can only learn here. Everything else on
 * this page is recoverable; this is the one action that is not.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type RetireKind = "zone" | "project";

export function RetireDialog({
    kind,
    slug,
    displayName,
    onCancel,
    onRetire,
    onRetired,
}: {
    kind: RetireKind;
    slug: string;
    displayName: string;
    onCancel: () => void;
    /** The req* call. Returns the ApiResult so this dialog can show a refusal. */
    onRetire: () => Promise<ApiResult<unknown>>;
    onRetired: () => void;
}) {
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Focus lands on Cancel, not on the destructive button. A dialog that opens
    // with the irreversible action pre-focused turns a stray Enter into a
    // permanently spent slug.
    const cancelRef = useRef<HTMLButtonElement>(null);

    const submit = async () => {
        setWorking(true);
        setError(null);

        // ⚠️ Explicit success branch. The shared axios client sets
        // `validateStatus: () => true`, so a 409 — "this zone still has active
        // projects", the refusal that matters most here — arrives as a VALUE and
        // throws nothing. A try/catch around this call is dead code for every
        // HTTP failure, and without this branch the dialog would close as though
        // the retirement had happened.
        const res = await onRetire();
        if (!res.success) {
            setError(res.error_message || `Failed to retire ${kind}`);
            setWorking(false);
            return;
        }
        onRetired();
    };

    return (
        <Modal
            open
            onClose={working ? () => {} : onCancel}
            title={`Retire ${kind} “${displayName}”?`}
            initialFocusRef={cancelRef}
            widthClass="max-w-md"
            footer={
                <>
                    <Button
                        ref={cancelRef}
                        type="button"
                        variant="secondary"
                        onClick={onCancel}
                        disabled={working}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        loading={working}
                        onClick={submit}
                    >
                        Retire {kind}
                    </Button>
                </>
            }
        >
            <div className="space-y-3 text-xs leading-relaxed text-secondary">
                {error && <Alert variant="error">{error}</Alert>}

                {/* (1) What is spent. Same for both kinds, and it is the half most
                    likely to be assumed reversible. */}
                <p>
                    The row is <strong className="text-primary">kept forever</strong>. Retiring
                    marks it retired; it never deletes it. That is what makes the slug{" "}
                    <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px] text-primary">
                        {slug}
                    </code>{" "}
                    <strong className="text-primary">permanently spent</strong> — you cannot
                    create another {kind} with this slug, now or ever. A reused slug would
                    silently reattach this {kind}&apos;s surviving events, and its permanent
                    daily rollup, to whatever took the name.
                </p>

                {/* (2) What is NOT done. Different per kind, and this is the part
                    an operator cannot infer from the word "retire". */}
                {kind === "zone" ? (
                    <p>
                        <strong className="text-primary">
                            This tears down no infrastructure.
                        </strong>{" "}
                        The stack, its ClickHouse, its MariaDB, the DNS record and the
                        certificate are all still there and still running. This only removes
                        the zone from the registry, so nothing offers it as a destination any
                        more. Retiring is refused while the zone still has active projects.
                    </p>
                ) : (
                    <p>
                        <strong className="text-primary">
                            Events do not stop arriving.
                        </strong>{" "}
                        Anything still holding an API key for this project keeps posting, and
                        those events keep landing and keep counting against the zone —
                        retiring hides the project from the switcher, it does not close the
                        door. Revoke the project&apos;s API keys in{" "}
                        <span className="text-primary">Settings → API keys</span> to actually
                        stop ingestion.
                    </p>
                )}
            </div>
        </Modal>
    );
}
