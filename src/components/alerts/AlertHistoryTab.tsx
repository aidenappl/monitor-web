"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faArrowsRotate } from "@fortawesome/free-solid-svg-icons";
import { AlertHistoryEntry } from "@/types";
import { FailureState } from "@/components/FailureState";
import { formatTimestamp } from "@/tools/format.tools";
import { useZoneHref } from "@/hooks/useZoneHref";
import {
    AlertRuleRow,
    CONDITION_LABELS,
    formatDuration,
    groupIncidents,
    incidentEventsHref,
    localZoneName,
} from "./alerts.tools";
import { statusBadgeClass } from "./RuleRow";
import { useNow } from "./useNow";

interface AlertHistoryTabProps {
    history: AlertHistoryEntry[];
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    onRetry: () => void;
    onLoadMore: () => void;
    rules: AlertRuleRow[];
    /** id → name of every rule history has mentioned, including deleted ones. */
    knownRules: Record<string, string>;
    ruleFilter: string;
    onRuleFilterChange: (id: string) => void;
}

const th = "px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-wider";

/**
 * History as INCIDENTS: one row per firing → resolved pair, with its duration.
 * It was a flat transition log, so the operator paired rows and did the
 * subtraction themselves; times carried no zone; the message column repeated
 * the other three and was truncated with no way to read it.
 */
export function AlertHistoryTab({
    history,
    loading,
    error,
    hasMore,
    onRetry,
    onLoadMore,
    rules,
    knownRules,
    ruleFilter,
    onRuleFilterChange,
}: AlertHistoryTabProps) {
    const zoned = useZoneHref();
    const now = useNow();
    const incidents = useMemo(() => groupIncidents(history), [history]);
    const rulesById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
    const zone = useMemo(() => localZoneName(), []);

    // Live rules first, then rules history remembers but that no longer exist,
    // so a deleted rule's past stays filterable.
    const deletedOptions = Object.entries(knownRules)
        .filter(([id]) => !rulesById.has(id))
        .sort((a, b) => a[1].localeCompare(b[1]));

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 min-w-0">
                <label htmlFor="history-rule-filter" className="sr-only">Filter history by rule</label>
                <select
                    id="history-rule-filter"
                    value={ruleFilter}
                    onChange={(e) => onRuleFilterChange(e.target.value)}
                    className="min-w-0 w-full max-w-xs truncate px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="">All rules</option>
                    {rules.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                    {deletedOptions.length > 0 && (
                        <optgroup label="Deleted rules">
                            {deletedOptions.map(([id, name]) => (
                                <option key={id} value={id}>{name}</option>
                            ))}
                        </optgroup>
                    )}
                </select>
                <button
                    onClick={onRetry}
                    disabled={loading}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
                    aria-label="Refresh history"
                    title="Refresh history"
                >
                    <FontAwesomeIcon icon={loading ? faSpinner : faArrowsRotate} className={`text-sm ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                {loading && history.length === 0 ? (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                    </div>
                ) : error ? (
                    <FailureState what="alert history" message={error} onRetry={onRetry} className="rounded-none border-0" />
                ) : incidents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
                        <p className="text-sm font-medium">No alert history</p>
                        <p className="text-xs mt-1">Nothing has fired{ruleFilter ? " for this rule" : ""} yet.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <caption className="sr-only">Alert incidents, newest first. Times in {zone}.</caption>
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                                    <th scope="col" className={th}>Started ({zone})</th>
                                    <th scope="col" className={th}>Rule</th>
                                    <th scope="col" className={th}>Status</th>
                                    <th scope="col" className={th}>Duration</th>
                                    <th scope="col" className={`${th} text-right`}>Value vs threshold</th>
                                </tr>
                            </thead>
                            <tbody>
                                {incidents.map((inc) => {
                                    const rule = rulesById.get(inc.rule_id);
                                    const start = inc.fired?.created_at;
                                    const end = inc.resolved?.created_at;
                                    // Only a live, enabled, firing rule is ongoing: a deleted rule never resolves.
                                    const ongoing = inc.ongoing && !!rule && rule.enabled && rule.state?.status === "firing";
                                    const duration =
                                        start && end
                                            ? formatDuration((new Date(end).getTime() - new Date(start).getTime()) / 1000)
                                            : start && ongoing
                                              ? `${formatDuration((now - new Date(start).getTime()) / 1000)} so far`
                                              : "—";
                                    const value = inc.fired?.value ?? inc.resolved?.value;
                                    const message = inc.fired?.message || inc.resolved?.message;
                                    // Not for a deleted rule: its filters are gone, so the link
                                    // would open an unfiltered window labelled as this rule's events.
                                    const eventsLink = rule ? incidentEventsHref(rule, start, end, ongoing, now) : null;
                                    return (
                                        <tr key={inc.key} className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 align-top">
                                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                                                {start ? formatTimestamp(start) : <span title="It started before the oldest loaded entry">earlier</span>}
                                                {end && (
                                                    <span className="block text-xs text-zinc-500 dark:text-zinc-500">
                                                        resolved {formatTimestamp(end)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 max-w-xs [overflow-wrap:anywhere]">
                                                {rule ? (
                                                    <Link
                                                        href={zoned(`/alerts?q=${encodeURIComponent(rule.name)}`)}
                                                        className="hover:underline text-blue-700 dark:text-blue-400"
                                                        title="Show this rule"
                                                    >
                                                        {inc.rule_name}
                                                    </Link>
                                                ) : (
                                                    <>
                                                        {inc.rule_name}
                                                        <span className="ml-1 text-xs font-normal text-zinc-500">(deleted)</span>
                                                    </>
                                                )}
                                                {eventsLink && (
                                                    <Link
                                                        href={zoned(eventsLink)}
                                                        className="block mt-0.5 text-xs font-normal text-blue-700 hover:underline dark:text-blue-400"
                                                        title="The events this rule judged, over this incident's window. Only its service, name and level filters carry over."
                                                    >
                                                        View events →
                                                    </Link>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                                        ongoing ? "firing" : end ? "resolved" : "other",
                                                    )}`}
                                                >
                                                    {ongoing ? "ongoing" : end ? "resolved" : "no resolve recorded"}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 tabular-nums whitespace-nowrap text-zinc-700 dark:text-zinc-300">{duration}</td>
                                            <td
                                                className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-700 dark:text-zinc-300"
                                                title={message || undefined}
                                            >
                                                {value !== undefined ? value.toLocaleString() : "—"}
                                                {rule && rule.type !== "absence" && (
                                                    <span className="text-zinc-500 dark:text-zinc-400">
                                                        {" "}{CONDITION_LABELS[rule.condition] ?? rule.condition} {rule.threshold}
                                                        {rule.type === "rate_change" ? "%" : ""}
                                                    </span>
                                                )}
                                                {rule?.type === "absence" && <span className="text-zinc-500 dark:text-zinc-400"> events</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {hasMore && !loading && (
                <div className="flex justify-center">
                    <button
                        onClick={onLoadMore}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                    >
                        Load more
                    </button>
                </div>
            )}
        </div>
    );
}
