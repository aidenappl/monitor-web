"use client";

import { memo, type ReactNode } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faChevronDown,
    faChevronRight,
    faCopy,
    faThumbtack,
    faArrowUpRightFromSquare,
    faDiagramProject,
} from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils";
import { copyText } from "@/tools/clipboard.tools";
import { formatClock, levelBadgeClass, type LiveEvent, type TimeZoneMode } from "./live.tools";

/** Wraps every case-insensitive occurrence of `terms` in `<mark>`. */
export function highlight(text: string, terms: string[]): ReactNode {
    const live = terms.filter(Boolean);
    if (live.length === 0 || !text) return text;
    const escaped = live.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
    return parts.map((part, i) =>
        i % 2 === 1 ? (
            <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40">
                {part}
            </mark>
        ) : (
            part
        ),
    );
}

const ID_FIELDS = ["env", "trace_id", "request_id", "user_id", "job_id"] as const;

interface LiveEventRowProps {
    le: LiveEvent;
    /** Unique per rendered row (the pinned tray renders the same event again). */
    domId: string;
    /** The key `expanded` is tracked under; handed back to `onToggle`. */
    expandKey: string;
    expanded: boolean;
    onToggle: (expandKey: string) => void;
    pinned: boolean;
    onTogglePin: (le: LiveEvent) => void;
    /** Must be referentially stable (memoised, or a module constant). */
    terms: string[];
    snippet: string | null;
    timeZone: TimeZoneMode;
    eventsHref: string;
    traceHref: string | null;
}

/**
 * One event. The header is a real disclosure button (`aria-expanded`,
 * `aria-controls`) — it used to be a `<div onClick>`, so keyboard and screen
 * reader users could not open a payload at all. Pin sits beside it rather than
 * inside it: a button may not contain a button.
 *
 * Below `sm` the row is two lines (time · level, then service · name):
 * three `shrink-0` pills on one line left the name about one character wide.
 *
 * ⚠️ MEMOISED, and every prop is stable across a batch: callbacks take the row's
 * own identity as an argument instead of closing over it, and the rest are
 * strings, booleans or the buffer's own LiveEvent objects (mergeNewestFirst keeps
 * them). So a new batch renders only the new rows, not all MAX_BUFFER of them.
 * A per-row arrow or an inline `[]` at the call site silently undoes that.
 */
export const LiveEventRow = memo(function LiveEventRow({
    le,
    domId,
    expandKey,
    expanded,
    onToggle,
    pinned,
    onTogglePin,
    terms,
    snippet,
    timeZone,
    eventsHref,
    traceHref,
}: LiveEventRowProps) {
    const { event } = le;
    const hasData = !!event.data && Object.keys(event.data).length > 0;
    const panelId = `${domId}-panel`;
    const iso = new Date(le.t).toISOString();
    const ids = ID_FIELDS.filter((f) => event[f]);

    return (
        <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
            <div className="flex items-stretch">
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => onToggle(expandKey)}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-left text-sm transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-zinc-800/50"
                >
                    <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500"
                        aria-hidden
                    />
                    <time
                        dateTime={event.timestamp}
                        title={`${iso} (UTC) · ${new Date(le.t).toLocaleString()}`}
                        className="shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                    >
                        {formatClock(le.t, timeZone)}
                    </time>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", levelBadgeClass(le.level))}>
                        {highlight(le.level, terms)}
                    </span>
                    {/* Phone: line break here, so line two is service + name. */}
                    <span aria-hidden className="h-0 basis-full sm:hidden" />
                    <span className="ml-6 max-w-[50%] truncate rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 sm:ml-0 sm:max-w-[16rem] dark:bg-indigo-900/40 dark:text-indigo-300">
                        {highlight(event.service, terms)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                        {highlight(event.name, terms)}
                    </span>
                    {snippet && (
                        <span className="min-w-0 basis-full truncate pl-6 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            {highlight(snippet, terms)}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => onTogglePin(le)}
                    aria-pressed={pinned}
                    aria-label={pinned ? "Unpin event" : "Pin event"}
                    title={pinned ? "Unpin event" : "Pin event — keeps it above the stream"}
                    className={cn(
                        "shrink-0 px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
                        pinned
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300",
                    )}
                >
                    <FontAwesomeIcon icon={faThumbtack} aria-hidden />
                </button>
            </div>
            {expanded && (
                <div id={panelId} className="space-y-2 px-4 pb-3 sm:pl-14">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            href={eventsHref}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px]" aria-hidden />
                            View in Events
                        </Link>
                        {traceHref && (
                            <Link
                                href={traceHref}
                                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                <FontAwesomeIcon icon={faDiagramProject} className="text-[10px]" aria-hidden />
                                Open trace
                            </Link>
                        )}
                        <button
                            type="button"
                            onClick={() => void copyText(JSON.stringify(event, null, 2), { label: "Event JSON" })}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            <FontAwesomeIcon icon={faCopy} className="text-[10px]" aria-hidden />
                            Copy JSON
                        </button>
                    </div>
                    {ids.length > 0 && (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                            {ids.map((f) => (
                                <div key={f} className="contents">
                                    <dt className="text-zinc-500 dark:text-zinc-400">{f}</dt>
                                    <dd className="min-w-0 break-all font-mono text-zinc-700 dark:text-zinc-300">{event[f]}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    {hasData ? (
                        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                            {highlight(JSON.stringify(event.data, null, 2), terms)}
                        </pre>
                    ) : (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">No payload.</p>
                    )}
                </div>
            )}
        </div>
    );
});
