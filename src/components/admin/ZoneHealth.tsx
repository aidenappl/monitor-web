"use client";

import { cn } from "@/lib/utils";
import { formatTimeAgo, formatTimestamp } from "@/tools/format.tools";
import type { Zone, ZoneReachability } from "@/types";

/**
 * How a zone's last probe verdict is rendered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE STATE THIS FILE EXISTS FOR IS `mismatched`, AND IT GETS THE LOUDEST
 * TREATMENT ON THE PAGE.
 *
 * A registry row records infrastructure that already exists; it does not create
 * any. Nothing reconciles the row against reality. So a row whose `query_url`
 * points at ANOTHER zone is syntactically perfect and semantically catastrophic:
 * the dashboard renders one zone's data under a different zone's name, every
 * request succeeds, no error appears anywhere, and the only signal that anything
 * is wrong is this badge. That is the failure the whole registry feature exists
 * to prevent, so it is styled as an alarm — filled, not outlined — rather than as
 * one more amber chip in a row of amber chips.
 *
 * The second rule is that NOTHING HERE IS GREEN UNLESS THE PROBE SAID SO.
 * `unknown` means never probed, and it is not a synonym for OK: it is the value
 * every row carries the moment it is created and the value it keeps forever if
 * nobody presses Verify. Rendering it neutral-and-quiet would make an unchecked
 * claim indistinguishable from a checked one, which is the same class of lie as
 * an errors page rendering "no issues" for a failed query.
 *
 * The third is that a verdict WITHOUT a timestamp is an undated claim. Nothing
 * re-probes on a timer — the value is a record of the last look, and it may be
 * months old. Every renderer below therefore carries "checked 3h ago" or "never
 * checked" beside the word, never the word alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Visual weight, worst first. `alarm` is filled; everything else is a tint. */
type Tone = "alarm" | "bad" | "warn" | "idle" | "good";

interface Meta {
    /** The word shown in the chip. Short enough to sit in a table cell. */
    label: string;
    tone: Tone;
    /** One sentence: what this verdict means about the world. */
    meaning: string;
    /** One sentence: what the operator should do about it. Empty when nothing. */
    remedy: string;
}

/**
 * ⚠️ EVERY VALUE IS SPELLED OUT — no default-to-green fallthrough. An
 * unrecognised reachability (a value monitor-core adds later, a truncated
 * response, `undefined` off a row that predates the field) falls to
 * `unrecognised` below, which reads as a problem rather than as health.
 */
const META: Record<ZoneReachability, Meta> = {
    mismatched: {
        label: "Wrong zone",
        tone: "alarm",
        meaning:
            "Something is answering at that URL, and it is NOT this zone — it named a different zone, or it is a control plane, which serves no events at all.",
        remedy:
            "Every read through this row returns another tenant's data under this zone's name. Fix the query URL before anyone trusts a chart from it.",
    },
    unreachable: {
        label: "Unreachable",
        tone: "bad",
        meaning:
            "The probe ran and got no usable answer — refused, TLS failure, timeout, a redirect it would not follow, or a target the SSRF guard declined.",
        remedy: "Check the zone is up and that this control plane can route to it.",
    },
    unverified: {
        label: "Unverified",
        tone: "warn",
        meaning:
            "Something answered 200 but would not say which zone it is. A 200 proves a server is listening; it does not prove it is this zone's server.",
        remedy:
            "An older build that predates zone identity on /health, a proxy answering on the upstream's behalf, or an unrelated service. Do not read this as healthy.",
    },
    degraded: {
        label: "Degraded",
        tone: "warn",
        meaning:
            "The right zone answered, but its own /ready says it is not serving — a dead store, or alerting switched off.",
        remedy: "Its data may be behind, empty, or absent. Check the zone's own /ready.",
    },
    unconfigured: {
        label: "No query URL",
        tone: "warn",
        meaning:
            "No query URL is recorded, so there was nothing to probe. Nobody failed to reach anything.",
        remedy: "Fill in the query URL, then verify.",
    },
    unknown: {
        label: "Never checked",
        tone: "idle",
        meaning:
            "Nothing has tested the URL this row currently holds — either it was never probed, or the query URL was changed and monitor-core discarded the old verdict with it. Either way it is an untested claim, not a healthy zone.",
        remedy: "Press Verify to find out whether the URL points where it says it does.",
    },
    healthy: {
        label: "Healthy",
        tone: "good",
        meaning: "The right zone answered, and it is ready.",
        remedy: "",
    },
};

const UNRECOGNISED: Meta = {
    label: "Unrecognised state",
    tone: "warn",
    meaning:
        "This row reports a reachability value this build does not know about.",
    remedy: "monitor-web is likely older than monitor-core. Do not read it as healthy.",
};

export function reachabilityMeta(value: ZoneReachability | null | undefined): Meta {
    if (!value) return UNRECOGNISED;
    return META[value] ?? UNRECOGNISED;
}

/**
 * `alarm` is a FILLED badge and everything else is a tint, so the wrong-zone
 * state is separable at a glance from a column of warnings — the one distinction
 * that matters when a page has ten rows and one of them is lying.
 *
 * Colour is never the only signal: each chip carries its word, and the dot is
 * decorative (`aria-hidden`). A red-green colour-blind reader and a screen-reader
 * user both get "Wrong zone".
 */
const TONE_CHIP: Record<Tone, string> = {
    alarm: "bg-[#ef4444] text-white border-[#ef4444] font-semibold",
    bad: "bg-[#ef4444]/10 text-failed border-[#ef4444]/30",
    warn: "bg-[#f59e0b]/10 text-pending border-[#f59e0b]/30",
    idle: "bg-surface-elevated text-muted border-border-strong",
    good: "bg-[#22c55e]/10 text-healthy border-[#22c55e]/30",
};

const TONE_DOT: Record<Tone, string> = {
    alarm: "bg-white",
    bad: "bg-[#ef4444]",
    warn: "bg-[#f59e0b]",
    idle: "bg-[#888888]",
    good: "bg-[#22c55e]",
};

const TONE_PANEL: Record<Tone, string> = {
    alarm: "border-[#ef4444] bg-[#ef4444]/10",
    bad: "border-[#ef4444]/30 bg-[#ef4444]/5",
    warn: "border-[#f59e0b]/30 bg-[#f59e0b]/5",
    idle: "border-border-strong bg-surface-elevated/50",
    good: "border-[#22c55e]/30 bg-[#22c55e]/5",
};

/** "checked 3h ago" / "never checked" — the freshness the word alone does not carry. */
export function probeAge(lastProbeAt: string | null): string {
    if (!lastProbeAt) return "never checked";
    return `checked ${formatTimeAgo(lastProbeAt)}`;
}

/**
 * The compact form, for a row in the zone list.
 *
 * `role="status"` rather than `role="alert"`: this is rendered on load rather
 * than in response to an action, and an alert interrupts a screen reader
 * mid-sentence for every row on the page.
 */
export function ZoneHealthChip({
    reachability,
    lastProbeAt,
    detail,
    className,
}: {
    reachability: ZoneReachability | null | undefined;
    lastProbeAt: string | null;
    detail?: string;
    className?: string;
}) {
    const meta = reachabilityMeta(reachability);
    return (
        <span className={cn("inline-flex items-center gap-2", className)}>
            <span
                role="status"
                title={detail || meta.meaning}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none",
                    TONE_CHIP[meta.tone],
                )}
            >
                <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[meta.tone])}
                />
                {meta.label}
            </span>
            {/* The timestamp is not optional decoration — see the header. */}
            <span
                className="text-[11px] text-muted"
                title={lastProbeAt ? formatTimestamp(lastProbeAt) : undefined}
            >
                {probeAge(lastProbeAt)}
            </span>
        </span>
    );
}

/**
 * The expanded form: verdict, what it means, what to do, and — when the far end
 * named itself — WHAT IT SAID next to WHAT WE EXPECTED.
 *
 * That last pair is the whole diagnosis for a mismatch, and it is why
 * `reported_zone` is carried through the types at all. "Unreachable" sends an
 * operator to check a box that is fine; "answered as `atlas`, expected
 * `trailblaze`" tells them the URL is wrong in one line.
 *
 * ⚠️ `reported_zone` is UNTRUSTED REMOTE TEXT — whatever the far end chose to
 * say. It is rendered as a quoted value and never used to build a link, a path or
 * a request.
 */
export function ZoneHealthPanel({ zone }: { zone: Zone }) {
    const meta = reachabilityMeta(zone.reachability);
    const mismatch = zone.reachability === "mismatched";

    return (
        <div
            className={cn(
                "rounded-lg border px-3.5 py-3 text-xs leading-relaxed",
                TONE_PANEL[meta.tone],
                mismatch && "border-2",
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <ZoneHealthChip
                    reachability={zone.reachability}
                    lastProbeAt={zone.last_probe_at}
                />
            </div>

            <p className="mt-2 text-subtle">{meta.meaning}</p>
            {meta.remedy && <p className="mt-1 text-muted">{meta.remedy}</p>}

            {/* Expected vs reported, side by side. Only meaningful once something
                answered with a name, so it is suppressed when it did not. */}
            {zone.reported_zone !== "" && (
                <p className="mt-2 font-mono text-[11px] text-secondary">
                    expected <span className="text-primary">{zone.slug}</span> · answered as{" "}
                    <span className={cn(mismatch ? "text-failed font-semibold" : "text-primary")}>
                        {JSON.stringify(zone.reported_zone)}
                    </span>
                </p>
            )}

            {/* The server's own words about the last probe. Shown verbatim: it is
                the only fact about what actually happened on the wire. */}
            {zone.reachability_detail !== "" && (
                <p className="mt-2 font-mono text-[11px] text-muted break-words">
                    {zone.reachability_detail}
                </p>
            )}
        </div>
    );
}
