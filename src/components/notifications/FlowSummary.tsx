"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { AlertRule, NotificationChannel, NotificationPolicy } from "@/types";
import { useZoneHref } from "@/hooks/useZoneHref";
import { computeRoutingFlow } from "./notifications.helpers";

interface FlowSummaryProps {
    rules: AlertRule[];
    policies: NotificationPolicy[];
    channels: NotificationChannel[];
    /** Any of the three reads still in flight. */
    loading: boolean;
    /** Which reads failed. A failed read is shown as unknown — never as zero. */
    failed: { rules: boolean; policies: boolean; channels: boolean };
    onOpenTab: (tab: "policies" | "channels") => void;
}

const STEP =
    "inline-flex items-baseline gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/**
 * "How does an alert reach a person?" in one line: rules → policies → channels,
 * plus the two gaps worth chasing — enabled rules nothing routes, and channels
 * nothing sends to.
 *
 * ⚠️ DOWN IS NOT EMPTY here either. If the rules read failed, "0 rules
 * unrouted" would be the most reassuring possible lie, so a failed input makes
 * its count "?" and suppresses every gap computed from it.
 *
 * Icons carry explicit h/w: this strip is server-rendered and Font Awesome's
 * CSS is injected at runtime, so an unsized SVG painted ~600px wide first and
 * shoved the whole page down when the CSS landed (most of this page's CLS).
 */
export function FlowSummary({ rules, policies, channels, loading, failed, onOpenTab }: FlowSummaryProps) {
    const zoned = useZoneHref();
    const flow = computeRoutingFlow(rules, policies, channels);
    const known = !loading && !failed.rules && !failed.policies && !failed.channels;
    const n = (value: number, isFailed: boolean) => (loading ? "…" : isFailed ? "?" : String(value));
    const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

    const gaps: ReactNode[] = [];
    if (known && flow.unroutedRules.length > 0) {
        const names = flow.unroutedRules.map((r) => r.name);
        gaps.push(
            <Link
                key="rules"
                href={zoned("/alerts")}
                title={`Not routed to any channel: ${names.join(", ")}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
            >
                <FontAwesomeIcon icon={faTriangleExclamation} className="text-[10px] h-[1em] w-[1em]" aria-hidden="true" />
                {flow.unroutedRules.length} {plural(flow.unroutedRules.length, "rule", "rules")} unrouted
            </Link>,
        );
    }
    if (known && flow.unusedChannels.length > 0) {
        gaps.push(
            <button
                key="channels"
                type="button"
                onClick={() => onOpenTab("channels")}
                title={`Nothing routes to: ${flow.unusedChannels.map((c) => c.name).join(", ")}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
                {flow.unusedChannels.length} {plural(flow.unusedChannels.length, "channel", "channels")} unused
            </button>,
        );
    }

    return (
        <section
            aria-label="Alert routing summary"
            className="flex min-h-[52px] flex-wrap items-center gap-x-1 gap-y-2 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
            <Link href={zoned("/alerts")} className={STEP} title="Alert rules (enabled)">
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {n(flow.rulesActive, failed.rules)}
                </span>
                {plural(flow.rulesActive, "rule", "rules")}
                {!loading && !failed.rules && flow.rulesDisabled > 0 && (
                    <span className="text-xs text-zinc-400">+{flow.rulesDisabled} off</span>
                )}
            </Link>
            <FontAwesomeIcon icon={faArrowRight} className="text-xs h-[1em] w-[1em] text-zinc-400" aria-hidden="true" />
            <button type="button" onClick={() => onOpenTab("policies")} className={STEP} title="Notification policies (enabled)">
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {n(flow.policiesActive, failed.policies)}
                </span>
                {plural(flow.policiesActive, "policy", "policies")}
                {!loading && !failed.policies && flow.policiesTotal > flow.policiesActive && (
                    <span className="text-xs text-zinc-400">+{flow.policiesTotal - flow.policiesActive} off</span>
                )}
            </button>
            <FontAwesomeIcon icon={faArrowRight} className="text-xs h-[1em] w-[1em] text-zinc-400" aria-hidden="true" />
            <button type="button" onClick={() => onOpenTab("channels")} className={STEP} title="Delivery channels">
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {n(flow.channelsTotal, failed.channels)}
                </span>
                {plural(flow.channelsTotal, "channel", "channels")}
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2 pl-1">
                {gaps.length > 0
                    ? gaps
                    : known && (
                          <span className="text-xs text-emerald-700 dark:text-emerald-400">
                              Every enabled rule reaches a channel
                          </span>
                      )}
            </div>
        </section>
    );
}
