"use client";

import { useCallback, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowsRotate,
    faCircleCheck,
    faCircleInfo,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { ZoneHealthPanel } from "@/components/admin/ZoneHealth";
import { reqCreateZone, reqProbeZone, reqUpdateZone } from "@/services/api";
import type { Zone } from "@/types";

/**
 * Record a zone, or edit one — and then VERIFY it points where it claims.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS FORM DOES NOT CREATE A ZONE. IT WRITES DOWN ONE THAT ALREADY EXISTS.
 *
 * The stack, its ClickHouse, its MariaDB, the DNS record and the certificate are
 * all provisioned by hand before anyone opens this dialog. Nothing here
 * provisions anything and nothing downstream reconciles the row against reality,
 * so what this form produces is a CLAIM: "the zone `x` is reachable at this
 * address". A claim that is wrong in the ordinary way (a typo) produces an
 * unreachable zone, which is loud. A claim that is wrong in the dangerous way —
 * a URL that points at a DIFFERENT, working zone — produces a dashboard that
 * shows one zone's data under another zone's name, with every request returning
 * 200 and nothing in an error state anywhere.
 *
 * Which is why the dialog has TWO steps and the second one is not optional-
 * looking. Step 1 collects the addresses; step 2 asks the far end who it is and
 * shows the answer next to who we expected. The wording throughout is "record"
 * and "verify", never "create" and "save".
 *
 * ⚠️ WHY VERIFICATION FOLLOWS THE WRITE RATHER THAN PRECEDING IT. The probe is
 * server-side and addresses a zone BY ROW ID (`POST /admin/zones/{id}/probe`) —
 * it re-reads the stored URL, re-runs the SSRF guard against it at probe time,
 * and persists the verdict. There is no endpoint that probes a URL which is not
 * yet a row, and inventing a client-side one would check a different thing from a
 * different place through a different network path, which is worse than useless:
 * it would say "reachable" about a host the control plane cannot reach.
 *
 * So the row is written first, and the dialog compensates in the two ways that
 * actually matter:
 *
 *   1. It does not close on the write. Step 2 probes immediately and stays open
 *      on the verdict, so the operator sees the answer as part of recording the
 *      zone rather than as a separate chore they may never do.
 *   2. A row that was never verified — or verified badly — is marked in the list
 *      and can never pass for a healthy one. See `ZoneHealth.tsx`.
 *
 * ⚠️ IT IS A REAL DIALOG NOW. This was a bare fixed-position div with an overlay
 * — the exact shape `components/ui/modal.tsx` names and forbids. It looked
 * identical and was unusable with a keyboard: no focus trap, so Tab walked into
 * the page behind the backdrop; no Escape; no `role="dialog"`, so a screen
 * reader announced nothing. And the backdrop's onClick stayed live WHILE SAVING,
 * so a stray click during the write discarded a fully typed two-URL form — the
 * most expensive form in the app to retype, and the one whose loss leaves the
 * operator unsure whether the zone was recorded. `Modal` brings all four, and
 * `onClose` is neutered while the write is in flight.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Ties the footer's submit button to the step-1 form Modal renders above it. */
const FORM_ID = "zone-form";

/**
 * Mirrors monitor-core's `tools.SlugPattern` and its length bounds, so an
 * operator is told before submitting rather than after.
 *
 * ⚠️ THE RESERVED-SLUG LIST IS DELIBERATELY *NOT* MIRRORED. It lives in
 * monitor-core's `tools/Slug.tool.go`, it is the authority, and it changes
 * whenever a new top-level route is added — a copy here would drift silently and
 * would then either reject a slug the server allows or, far worse, promise one
 * the server refuses. `reservedSlugs` also protects the frontend's own routing
 * (a zone called `settings` would shadow a page), which is exactly the kind of
 * coupling that must have ONE definition. The server's 400 names the problem;
 * this form shows it verbatim.
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

/**
 * A first pass over the endpoint rules in monitor-core's
 * `tools.NormalizeEndpointURL` + `tools.ValidateExternalURL`.
 *
 * ⚠️ NOT THE ENFORCEMENT, and it cannot be. The server also refuses internal
 * hostnames and anything that RESOLVES to a private or loopback address, and DNS
 * is not a thing a browser can consult. So this catches the shape mistakes early
 * and the server catches the rest; its message is surfaced verbatim when it does.
 */
function urlProblem(raw: string): string | undefined {
    const value = raw.trim();
    if (value === "") return "Required.";

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return "Not a URL. Include the scheme, e.g. https://monitor.example.com";
    }
    if (parsed.protocol !== "https:") return "Must be https://";
    if (parsed.username !== "" || parsed.password !== "")
        return "Must not embed credentials.";
    if (parsed.search !== "")
        return "Must not carry a query string — it is an origin, and paths are appended to it.";
    if (parsed.hash !== "")
        return "Must not carry a fragment — it is an origin, and paths are appended to it.";
    return undefined;
}

interface ZoneForm {
    slug: string;
    display_name: string;
    ingest_url: string;
    query_url: string;
}

const emptyForm: ZoneForm = {
    slug: "",
    display_name: "",
    ingest_url: "",
    query_url: "",
};

/**
 * The probe's own outcome, which is NOT the zone's health.
 *
 * ⚠️ THE TWO ARE ROUTINELY CONFUSED AND THE CONFUSION IS THE BUG. An unreachable
 * zone is a **200** from `POST .../probe` — the probe worked; what it found was a
 * zone that is down. `phase: "failed"` here means something else entirely: the
 * control plane could not run or record the probe at all, so we have NO verdict.
 * Rendering that as "unreachable" would blame the zone for the control plane's
 * failure; rendering it as anything green would be worse.
 */
type ProbeState =
    | { phase: "idle" }
    | { phase: "running" }
    | { phase: "answered" }
    | { phase: "failed"; message: string };

export function ZoneFormModal({
    /** null → record a new zone. A Zone → edit that row. */
    zone,
    onClose,
    onChanged,
}: {
    zone: Zone | null;
    onClose: () => void;
    /** Fired whenever a write lands, so the list behind the dialog re-reads. */
    onChanged: () => void;
}) {
    const [form, setForm] = useState<ZoneForm>(
        zone
            ? {
                  slug: zone.slug,
                  display_name: zone.display_name,
                  ingest_url: zone.ingest_url,
                  query_url: zone.query_url,
              }
            : emptyForm,
    );

    /**
     * The row this dialog is verifying. Null until the create write lands; for an
     * edit it starts as the row that was passed in.
     *
     * Held as state rather than read from the parent's list because the probe
     * response carries a REFRESHED row (with `last_probe_at` set), and the list
     * behind the dialog is a re-read that may not have landed yet.
     */
    const [saved, setSaved] = useState<Zone | null>(zone);
    const [step, setStep] = useState<"details" | "verify">("details");

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [probe, setProbe] = useState<ProbeState>({ phase: "idle" });

    const set = <K extends keyof ZoneForm>(key: K, value: ZoneForm[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    // Focus the first field the operator has to fill in. On an edit the slug is
    // fixed, so that is the display name. Body-scroll locking moved into `Modal`
    // with the migration — it belongs to every dialog, not to these two.
    const firstFieldRef = useRef<HTMLInputElement>(null);

    const runProbe = useCallback(async (id: number) => {
        setProbe({ phase: "running" });

        // Explicit success branch: the shared client never throws on a non-2xx.
        const res = await reqProbeZone(id);
        if (!res.success) {
            // ⚠️ The PROBE CALL failed — we have no verdict at all. Deliberately
            // not folded into "unreachable": that would report a control-plane
            // fault as a fact about the zone.
            setProbe({ phase: "failed", message: res.error_message });
            return;
        }

        // A 200 here means "we got an answer", not "the zone is fine". The
        // verdict lives in the payload, and `ZoneHealthPanel` is what reads it.
        if (res.data.zone) setSaved(res.data.zone);
        setProbe({ phase: "answered" });

        // ⚠️ The probe WRITES to the row, so the list behind this dialog is now
        // stale. Without this it would go on showing "never checked" for a zone
        // that was just checked — which is not a cosmetic lag: on this page an
        // unverified-looking row is a warning, and one that is wrong teaches the
        // operator to disregard the real ones.
        onChanged();
    }, [onChanged]);

    // Same rule as the submit branch: once the row exists the slug is spent and
    // is no longer an editable field, whichever way the dialog was opened.
    const recorded = saved !== null;
    const slugError = recorded ? undefined : slugProblem(form.slug.trim());
    const ingestError = urlProblem(form.ingest_url);
    const queryError = urlProblem(form.query_url);
    const nameError =
        form.display_name.trim() === "" ? "Required." : undefined;
    const detailsInvalid = Boolean(
        slugError || ingestError || queryError || nameError,
    );

    /**
     * ⚠️ THE BRANCH IS ON WHETHER THE ROW EXISTS (`saved`), NOT ON HOW THE DIALOG
     * OPENED.
     *
     * The two diverge the moment step 2 sends the operator back to fix a URL: the
     * dialog still opened as a create, but the zone has been recorded since. A
     * branch on "did this open as a create" would POST a second time and 409 on
     * the slug it had just spent — an error about a name being taken, produced by
     * the dialog that took it, with no way forward.
     */
    const submitDetails = async (e: React.FormEvent) => {
        e.preventDefault();
        if (detailsInvalid) return;

        setSaving(true);
        setError(null);

        if (saved === null) {
            const res = await reqCreateZone({
                slug: form.slug.trim(),
                display_name: form.display_name.trim(),
                ingest_url: form.ingest_url.trim(),
                query_url: form.query_url.trim(),
            });
            setSaving(false);
            if (!res.success) {
                // The 409 here is the one that matters: a slug that is already
                // spent, INCLUDING by a retired row. Shown verbatim, because the
                // server's message says exactly that and a generic "failed to
                // save" would send the operator looking for a row they cannot see.
                setError(res.error_message || "Failed to record the zone");
                return;
            }
            setSaved(res.data);
            setStep("verify");
            onChanged();
            void runProbe(res.data.id);
            return;
        }

        // ── The row exists. Slug is NOT in the payload: the type has no field
        // for it and the server refuses one with a 400 rather than dropping it.
        const res = await reqUpdateZone(saved.id, {
            display_name: form.display_name.trim(),
            ingest_url: form.ingest_url.trim(),
            query_url: form.query_url.trim(),
        });
        setSaving(false);
        if (!res.success) {
            setError(res.error_message || "Failed to save the zone");
            return;
        }
        setSaved(res.data);
        setStep("verify");
        onChanged();

        // ⚠️ ALWAYS RE-PROBE AFTER AN EDIT, and re-probe even when the URL looks
        // unchanged. The stored verdict describes the URL as it was at the last
        // probe, so leaving it in place after a URL change would show a green
        // tick that was earned by a different address. And an unchanged URL is
        // not a stable one: DNS can be re-pointed under a value nobody edited,
        // which is the exact way a row starts answering as somebody else's zone.
        void runProbe(res.data.id);
    };

    const verified = saved?.reachability === "healthy";

    return (
        <Modal
            open
            // ⚠️ Dismissal is disabled while the write is in flight. The bare-div
            // version left the backdrop live during the request, so a stray click
            // threw away both URLs and left the operator unable to tell whether
            // the zone had been recorded — which then 409s if they retype it.
            onClose={saving ? () => {} : onClose}
            title={
                step === "verify"
                    ? `Verify ${form.slug}`
                    : recorded
                      ? `Edit ${form.display_name || form.slug}`
                      : "Record an existing zone"
            }
            description={
                step === "details"
                    ? "Step 1 of 2 — where the zone already lives"
                    : "Step 2 of 2 — does that address answer as this zone?"
            }
            initialFocusRef={step === "details" ? firstFieldRef : undefined}
            widthClass="max-w-2xl"
            footer={
                step === "details" ? (
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            onClick={onClose}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        {/* `form=` rather than nesting the buttons inside the
                            <form>: Modal renders its footer outside the children
                            slot, and the association is what keeps
                            Enter-to-submit working. */}
                        <Button
                            type="submit"
                            form={FORM_ID}
                            size="lg"
                            loading={saving}
                            disabled={detailsInvalid}
                        >
                            {recorded ? "Save & re-verify" : "Record zone & verify"}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            onClick={() => {
                                setStep("details");
                                setProbe({ phase: "idle" });
                            }}
                        >
                            Edit URLs
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            loading={probe.phase === "running"}
                            onClick={() => saved && void runProbe(saved.id)}
                        >
                            Verify again
                        </Button>
                        <Button type="button" size="lg" onClick={onClose}>
                            Done
                        </Button>
                    </>
                )
            }
        >
            {step === "details" ? (
                    <form id={FORM_ID} onSubmit={submitDetails} className="space-y-4">
                        {error && <Alert variant="error">{error}</Alert>}

                        {/* The sentence the whole feature turns on, said before the
                            first field rather than in a tooltip after it. */}
                        <Alert variant="info">
                            <strong>This records infrastructure; it does not create any.</strong>{" "}
                            The stack, its ClickHouse and its DNS record must already exist.
                            What you are writing down is a claim about where they are — and
                            nothing reconciles it against reality, so step 2 asks the far end
                            who it thinks it is.
                        </Alert>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {!recorded ? (
                                <Input
                                    ref={firstFieldRef}
                                    label="Slug *"
                                    value={form.slug}
                                    onChange={(e) => set("slug", e.target.value)}
                                    placeholder="trailblaze"
                                    error={form.slug === "" ? undefined : slugError}
                                    hint="Permanent. It becomes the URL segment for every page in this zone."
                                />
                            ) : (
                                <FixedSlug slug={form.slug} kind="zone" />
                            )}

                            <Input
                                ref={recorded ? firstFieldRef : undefined}
                                label="Display name *"
                                value={form.display_name}
                                onChange={(e) => set("display_name", e.target.value)}
                                placeholder="Trailblaze"
                                error={form.display_name === "" ? undefined : nameError}
                                hint="The label in the switcher. Change it any time."
                            />
                        </div>

                        <Input
                            label="Ingest URL *"
                            value={form.ingest_url}
                            onChange={(e) => set("ingest_url", e.target.value)}
                            placeholder="https://ingest.monitor.example.com"
                            error={form.ingest_url === "" ? undefined : ingestError}
                            hint="Public origin SDKs POST events to. This ends up copied into other repos' configuration, so treat it as permanent."
                        />

                        <Input
                            label="Query URL *"
                            value={form.query_url}
                            onChange={(e) => set("query_url", e.target.value)}
                            placeholder="https://monitor.example.com"
                            error={form.query_url === "" ? undefined : queryError}
                            hint="Server-to-server origin this control plane reads the zone through, and the address step 2 probes. May be a different hostname from the ingest URL."
                        />

                        <p className="text-xs leading-relaxed text-muted">
                            Both must be https origins with no path query or fragment. The
                            server additionally refuses internal hostnames and anything that
                            resolves to a private address — checks a browser cannot make, so
                            its refusal is the one that counts.
                        </p>
                    </form>
                ) : (
                    <div className="space-y-4">
                        {/* The row exists from here on. Saying so plainly stops the
                            operator reading a failed probe as a failed save and
                            trying to record the zone a second time — which would
                            409 on a slug they just spent. */}
                        <p className="text-xs leading-relaxed text-secondary">
                            <strong className="text-primary">
                                {form.slug} is recorded in the registry.
                            </strong>{" "}
                            The check below is what tells you whether the query URL points at
                            this zone — or at a different one that also answers.
                        </p>

                        {probe.phase === "running" && (
                            <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-elevated/50 px-3.5 py-3 text-xs text-muted">
                                <FontAwesomeIcon icon={faArrowsRotate} className="animate-spin" />
                                Asking {form.query_url} who it is…
                            </div>
                        )}

                        {/* ⚠️ THE PROBE CALL FAILED — not the zone. Separated from
                            every verdict below, because "we could not ask" and "we
                            asked and it is down" are different facts and only one
                            of them is about the zone. */}
                        {probe.phase === "failed" && (
                            <Alert variant="error">
                                <strong>The check could not be run.</strong> {probe.message} This
                                is a failure to ask, not an answer about the zone — its
                                reachability below is whatever the last successful probe found,
                                which may be nothing at all.
                            </Alert>
                        )}

                        {saved && <ZoneHealthPanel zone={saved} />}

                        {probe.phase === "answered" && !verified && (
                            <Alert variant="warning">
                                <strong>Saved, but not verified.</strong> This zone will be
                                marked in the list until a probe comes back healthy — it will
                                never be shown as one that checked out. Correct the query URL
                                and try again, or leave it and come back: the row is already
                                recorded either way.
                            </Alert>
                        )}

                        {verified && (
                            <div className="flex items-start gap-2.5 rounded-lg border border-[#22c55e]/20 bg-[#22c55e]/5 px-3.5 py-2.5 text-xs leading-relaxed text-subtle">
                                <FontAwesomeIcon
                                    icon={faCircleCheck}
                                    className="mt-0.5 shrink-0 text-healthy"
                                />
                                <span>
                                    That address answered as{" "}
                                    <strong className="text-primary">{form.slug}</strong> and
                                    reports itself ready. Verified as of now — nothing re-checks
                                    on a timer, so this is a record of this moment, not a live
                                    status.
                                </span>
                            </div>
                        )}

                        <div className="flex items-center gap-1.5 text-xs text-muted">
                            <FontAwesomeIcon icon={faCircleInfo} className="text-[11px]" />
                            Verifying again is safe: it re-reads the stored URL and overwrites
                            the verdict.
                        </div>
                    </div>
                )}
        </Modal>
    );
}

/**
 * The slug, after creation.
 *
 * ⚠️ A DISABLED INPUT WITH NO EXPLANATION IS THE WRONG ANSWER, which is why this
 * is not one. A greyed-out box reads as "you lack permission" or "this is broken"
 * and invites someone to go find the endpoint that does allow it. There isn't
 * one: the API refuses a slug in an update body with a 400 rather than dropping
 * it, because answering 200 to "rename this zone" having renamed nothing is
 * invisible here and permanent on the other side — events already filed under the
 * old slug keep arriving there while every reference the operator now writes
 * points at a name that does not exist.
 *
 * So it renders as a fact with its reason attached, and points at the field that
 * IS editable.
 */
function FixedSlug({ slug, kind }: { slug: string; kind: "zone" | "project" }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-secondary">
                Slug — permanent
            </span>
            <div className="flex h-9 items-center rounded-lg border border-dashed border-border-strong bg-surface-elevated/50 px-3">
                <code className="font-mono text-sm text-primary">{slug}</code>
            </div>
            <p className="text-xs leading-relaxed text-muted">
                A {kind} slug can never be changed and can never be reused. Events are
                already filed under this one, and a reused slug would reattach them to
                whatever took the name. Edit the display name instead — that is the
                label everything shows.
            </p>
        </div>
    );
}

export { FixedSlug };
