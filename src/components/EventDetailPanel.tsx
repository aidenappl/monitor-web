"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faChevronUp, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { ButtonSpinner } from "@/components/ui/spinner";
import { Event } from "@/types";
import { getEvents } from "@/services/api";
import { FailureNote } from "@/components/FailureState";
import { reportError } from "@/services/monitor.service";
import { copyText } from "@/tools/clipboard.tools";
import { timeZoneLabel, useDateTimePrefs } from "@/tools/datetime.tools";
import { formatEventTimestamp } from "@/components/EventTable";

interface EventDetailPanelProps {
    event: Event | null;
    onClose: () => void;
    /** Step to the previous/next event in the table (also `k`/`j`). Omitted at either end. */
    onPrev?: () => void;
    onNext?: () => void;
    /** Adds `field = value` to the table's filters (and the page closes the panel). */
    onAddFilter?: (field: string, value: string) => void;
    /** A permalink to this event, for the "Copy link" button. */
    permalink?: () => string;
}

const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getLevelColor(level?: string) {
    switch (level?.toLowerCase()) {
        case "error":
            return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 ring-1 ring-inset ring-red-200 dark:ring-red-900";
        case "warn":
        case "warning":
            return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-900";
        case "debug":
            return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700";
        case "info":
        default:
            return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 ring-1 ring-inset ring-blue-200 dark:ring-blue-900";
    }
}

function getStatusColor(status: number | string) {
    const s = typeof status === "string" ? parseInt(status) : status;
    if (s >= 500) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400";
    if (s >= 400) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400";
    if (s >= 300) return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400";
    if (s >= 200) return "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400";
    return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function formatRelativeTime(ts: string): string {
    try {
        const date = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSeconds = Math.floor(diffMs / 1000);
        if (diffSeconds < 60) return `${diffSeconds}s ago`;
        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    } catch {
        // Formatting fallback: show the raw timestamp. Not a failure.
        return ts;
    }
}

// Collapsible section
function Section({
    title,
    defaultOpen = true,
    open,
    onOpenChange,
    id,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    /** Controlled open state — for a section something else can open. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    id?: string;
    children: React.ReactNode;
}) {
    const [ownOpen, setOwnOpen] = useState(defaultOpen);
    const isOpen = open ?? ownOpen;
    const setIsOpen = (next: boolean) => {
        onOpenChange?.(next);
        if (open === undefined) setOwnOpen(next);
    };
    return (
        <div id={id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
            <button
                aria-expanded={isOpen}
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
                {title}
                <svg
                    className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {isOpen && <div className="px-5 pb-4">{children}</div>}
        </div>
    );
}

// Recursive JSON renderer
function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
    const [collapsed, setCollapsed] = useState(depth > 2);

    if (value === null) return <span className="text-zinc-400">null</span>;
    if (value === undefined) return <span className="text-zinc-400">undefined</span>;
    if (typeof value === "boolean")
        return <span className="text-amber-600 dark:text-amber-400">{value.toString()}</span>;
    if (typeof value === "number")
        return <span className="text-blue-600 dark:text-blue-400">{value}</span>;
    if (typeof value === "string") {
        // Check if it's a long string
        if (value.length > 200) {
            return (
                <span className="text-green-600 dark:text-green-400 break-all">
                    &quot;{value}&quot;
                </span>
            );
        }
        return (
            <span className="text-green-600 dark:text-green-400">
                &quot;{value}&quot;
            </span>
        );
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return <span className="text-zinc-500">[]</span>;
        if (collapsed) {
            return (
                <button
                    onClick={() => setCollapsed(false)}
                    className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    [{value.length} items]
                </button>
            );
        }
        return (
            <div>
                <button
                    onClick={() => setCollapsed(true)}
                    className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    [
                </button>
                <div className="ml-4 border-l border-zinc-200 dark:border-zinc-700 pl-3">
                    {value.map((item, i) => (
                        <div key={i} className="py-0.5">
                            <JsonValue value={item} depth={depth + 1} />
                            {i < value.length - 1 && <span className="text-zinc-400">,</span>}
                        </div>
                    ))}
                </div>
                <span className="text-zinc-500">]</span>
            </div>
        );
    }

    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return <span className="text-zinc-500">{"{}"}</span>;
        if (collapsed) {
            return (
                <button
                    onClick={() => setCollapsed(false)}
                    className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    {"{"}{entries.length} keys{"}"}
                </button>
            );
        }
        return (
            <div>
                <button
                    onClick={() => setCollapsed(true)}
                    className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    {"{"}
                </button>
                <div className="ml-4 border-l border-zinc-200 dark:border-zinc-700 pl-3">
                    {entries.map(([key, val], i) => (
                        <div key={key} className="py-0.5">
                            <span className="text-purple-600 dark:text-purple-400">{key}</span>
                            <span className="text-zinc-400">: </span>
                            <JsonValue value={val} depth={depth + 1} />
                            {i < entries.length - 1 && <span className="text-zinc-400">,</span>}
                        </div>
                    ))}
                </div>
                <span className="text-zinc-500">{"}"}</span>
            </div>
        );
    }

    return <span>{String(value)}</span>;
}

export function EventDetailPanel({ event, onClose, onPrev, onNext, onAddFilter, permalink }: EventDetailPanelProps) {
    const [contextEvents, setContextEvents] = useState<Event[] | null>(null);
    const [contextLoading, setContextLoading] = useState(false);
    const [contextError, setContextError] = useState<string | null>(null);
    const [traceEvents, setTraceEvents] = useState<Event[] | null>(null);
    const [traceLoading, setTraceLoading] = useState(false);
    const [traceError, setTraceError] = useState<string | null>(null);
    const [requestEvents, setRequestEvents] = useState<Event[] | null>(null);
    const [requestLoading, setRequestLoading] = useState(false);
    const [requestError, setRequestError] = useState<string | null>(null);
    const [requestOpen, setRequestOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const isOpen = event !== null;
    const prefs = useDateTimePrefs();

    // Close on escape; keep Tab inside the panel.
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
                return;
            }
            if (e.key !== "Tab" || !panelRef.current) return;
            // aria-modal promises the page behind is inert; without the wrap,
            // Tab walked out of the panel into the blurred page underneath.
            const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (nodes.length === 0) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            const active = document.activeElement;
            if (!panelRef.current.contains(active)) {
                e.preventDefault();
                first.focus();
            } else if (e.shiftKey && (active === first || active === panelRef.current)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };
        if (isOpen) {
            document.addEventListener("keydown", handleKey);
            document.body.style.overflow = "hidden";
            return () => {
                document.removeEventListener("keydown", handleKey);
                document.body.style.overflow = "";
            };
        }
    }, [isOpen, onClose]);

    // Focus moves INTO the panel when it opens, and back to whatever opened it
    // when it closes. It used to stay on <body>: a screen reader announced
    // nothing, and the next Tab landed in the page the panel claims to cover.
    // Keyed on open/closed, not on the event, so j/k stepping keeps focus put.
    useEffect(() => {
        if (!isOpen) return;
        const opener = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();
        return () => {
            if (opener && opener !== document.body && document.contains(opener)) opener.focus();
        };
    }, [isOpen]);

    // Reset state when the event changes — during render ("adjust state while
    // rendering"), so j/k never paints a frame of the previous event's
    // context, trace or request under the new one.
    const [shownEvent, setShownEvent] = useState(event);
    if (event !== shownEvent) {
        setShownEvent(event);
        setContextEvents(null);
        setTraceEvents(null);
        setRequestEvents(null);
        setContextError(null);
        setTraceError(null);
        setRequestError(null);
        setRequestOpen(false);
    }

    const fetchContext = useCallback(async () => {
        if (!event) return;
        setContextLoading(true);
        setContextError(null);
        try {
            const ts = new Date(event.timestamp);
            const from = new Date(ts.getTime() - 30000).toISOString();
            const to = new Date(ts.getTime() + 30000).toISOString();
            const res = await getEvents({ service: event.service, from, to, limit: 50 });
            // ⚠️ `[]` here renders EventMiniList's "No events found" — which on a
            // debugging panel is a finding, not a blank. "Nothing else happened
            // in this 60-second window" is the kind of statement an engineer
            // reasons from, so a failed query must never be allowed to make it.
            if (!res.success) {
                setContextError(res.error_message || "The request failed.");
                return;
            }
            setContextEvents(res.data);
        } catch (err) {
            reportError("event_detail.context.load.failed", err, {
                outcome: "context section shows its failure note",
            });
            setContextError("Failed to load surrounding events");
        } finally {
            setContextLoading(false);
        }
    }, [event]);

    const fetchTrace = useCallback(async () => {
        if (!event?.trace_id) return;
        setTraceLoading(true);
        setTraceError(null);
        try {
            const res = await getEvents({ trace_id: event.trace_id, limit: 100, ...aroundEvent(event.timestamp) });
            if (!res.success) {
                setTraceError(res.error_message || "The request failed.");
                return;
            }
            setTraceEvents(res.data);
        } catch (err) {
            reportError("event_detail.trace.load.failed", err, {
                trace_id: event?.trace_id,
                outcome: "trace section shows its failure note",
            });
            setTraceError("Failed to load the trace");
        } finally {
            setTraceLoading(false);
        }
    }, [event]);

    const fetchRequest = useCallback(async () => {
        if (!event?.request_id) return;
        setRequestLoading(true);
        setRequestError(null);
        try {
            const res = await getEvents({ request_id: event.request_id, limit: 100, ...aroundEvent(event.timestamp) });
            if (!res.success) {
                setRequestError(res.error_message || "The request failed.");
                return;
            }
            setRequestEvents(res.data);
        } catch (err) {
            reportError("event_detail.request.load.failed", err, {
                request_id: event?.request_id,
                outcome: "request section shows its failure note",
            });
            setRequestError("Failed to load the request events");
        } finally {
            setRequestLoading(false);
        }
    }, [event]);

    if (!event) return null;

    const data = event.data || {};
    const hasSourceInfo = Boolean(data.source_file);
    // go-monitor and monitor-js send `method`/`path`/`status_code`; older
    // emitters used the `request_*`/`response_status` spellings. The section
    // keyed on `request_method` alone, so it never rendered for the
    // http.request.end events that make up most of the stream.
    const reqMethod = data.request_method ?? data.method;
    const reqPath = data.request_path ?? data.path ?? data.request_url;
    const resStatus = data.response_status ?? data.status_code;
    const hasRequestInfo = Boolean(reqMethod);
    // In the user's zone and format, to the millisecond; the ISO original is
    // the tooltip and what Copy / the JSON view carry.
    const at = formatEventTimestamp(event.timestamp, prefs, { ms: true });

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                onClick={onClose}
            />

            {/* Panel */}
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Event ${event.name}`}
                tabIndex={-1}
                className="focus:outline-none fixed top-0 right-0 h-full w-full max-w-[600px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 flex flex-col animate-slide-in-right overflow-hidden"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start gap-3 shrink-0">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-md">
                                {event.service}
                            </span>
                            {event.level ? (
                                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-md ${getLevelColor(event.level)}`}>
                                    {event.level}
                                </span>
                            ) : null}
                        </div>
                        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {event.name}
                        </h2>
                        <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            <span>{formatRelativeTime(event.timestamp)}</span>
                            <span className="text-zinc-300 dark:text-zinc-400">|</span>
                            <time dateTime={event.timestamp} title={event.timestamp} className="font-mono">
                                {at.date} {at.time}{" "}
                                <span className="text-zinc-400 dark:text-zinc-500">{timeZoneLabel(prefs.timeZone)}</span>
                            </time>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center">
                        <button
                            type="button"
                            onClick={onPrev}
                            disabled={!onPrev}
                            aria-label="Previous event (k)"
                            title="Previous event (k)"
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                            <FontAwesomeIcon icon={faChevronUp} className="text-xs" />
                        </button>
                        <button
                            type="button"
                            onClick={onNext}
                            disabled={!onNext}
                            aria-label="Next event (j)"
                            title="Next event (j)"
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                            <FontAwesomeIcon icon={faChevronDown} className="text-xs" />
                        </button>
                    </div>
                    {permalink && (
                        <CopyButton label="Copy link to this event" copiedLabel="Event link" text={permalink}>
                            Link
                        </CopyButton>
                    )}
                    <CopyButton label="Copy event JSON" copiedLabel="Event JSON" text={() => JSON.stringify(event, null, 2)}>
                        JSON
                    </CopyButton>
                    <button
                        onClick={onClose}
                        aria-label="Close event details"
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                    {/* Metadata */}
                    <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm [&>div]:min-w-0">
                        {event.env ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Environment</span>
                                <span className="font-medium text-zinc-900 dark:text-zinc-100">{event.env}</span>
                            </div>
                        ) : null}
                        {event.user_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">User ID</span>
                                <span className="flex min-w-0 items-center gap-1">
                                    <IdValue value={event.user_id} />
                                    <CopyButton label="Copy User ID" copiedLabel="User ID" text={() => event.user_id ?? ""} />
                                </span>
                            </div>
                        ) : null}
                        {event.job_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Job ID</span>
                                <span className="flex min-w-0 items-center gap-1">
                                    <IdValue value={event.job_id} />
                                    <CopyButton label="Copy Job ID" copiedLabel="Job ID" text={() => event.job_id ?? ""} />
                                    {onAddFilter && (
                                        <FilterButton label="Filter events by this job" onClick={() => onAddFilter("job_id", event.job_id!)} />
                                    )}
                                </span>
                            </div>
                        ) : null}
                        {event.trace_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Trace ID</span>
                                <span className="flex min-w-0 items-center gap-1">
                                    <IdValue value={event.trace_id} />
                                    <CopyButton label="Copy Trace ID" copiedLabel="Trace ID" text={() => event.trace_id ?? ""} />
                                    {onAddFilter && (
                                        <FilterButton label="Filter events by this trace" onClick={() => onAddFilter("trace_id", event.trace_id!)} />
                                    )}
                                </span>
                            </div>
                        ) : null}
                        {event.request_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Request ID</span>
                                <span className="flex min-w-0 items-center gap-1">
                                    <IdValue value={event.request_id} />
                                    <CopyButton label="Copy Request ID" copiedLabel="Request ID" text={() => event.request_id ?? ""} />
                                    {onAddFilter && (
                                        <FilterButton label="Filter events by this request" onClick={() => onAddFilter("request_id", event.request_id!)} />
                                    )}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRequestOpen(true);
                                        if (requestEvents === null && !requestLoading) void fetchRequest();
                                        document.getElementById("event-detail-request")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                                    }}
                                    className="mt-0.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                    View request events
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Source Location */}
                    {hasSourceInfo && (
                        <Section title="Source Location">
                            <div className="space-y-1.5 font-mono text-xs">
                                <div className="flex items-center gap-2">
                                    <span className="text-zinc-500 dark:text-zinc-400 w-16 shrink-0">File:</span>
                                    <span className="text-blue-600 dark:text-blue-400 break-all">
                                        {String(data.source_file)}
                                        {data.source_line ? `:${String(data.source_line)}` : null}
                                    </span>
                                </div>
                                {Boolean(data.source_func) && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-zinc-500 dark:text-zinc-400 w-16 shrink-0">Func:</span>
                                        <span className="text-zinc-700 dark:text-zinc-300 break-all">
                                            {String(data.source_func)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </Section>
                    )}

                    {/* Request/Response */}
                    {hasRequestInfo && (
                        <Section title="Request / Response">
                            <div className="space-y-3">
                                {/* Request line */}
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                        {String(reqMethod)}
                                    </span>
                                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400 break-all">
                                        {String(reqPath ?? "")}
                                    </span>
                                    {Boolean(resStatus) && (
                                        <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${getStatusColor(resStatus as number)}`}>
                                            {String(resStatus)}
                                        </span>
                                    )}
                                </div>

                                {/* Duration */}
                                {data.duration_ms !== undefined && data.duration_ms !== null && (
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Duration: <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{String(data.duration_ms)}ms</span>
                                    </div>
                                )}

                                {/* Request headers */}
                                {Boolean(data.request_headers) && (
                                    <CollapsibleCode title="Request Headers" content={data.request_headers} />
                                )}

                                {/* Request body */}
                                {Boolean(data.request_body) && (
                                    <CollapsibleCode title="Request Body" content={data.request_body} />
                                )}

                                {/* Response body */}
                                {Boolean(data.response_body) && (
                                    <CollapsibleCode title="Response Body" content={data.response_body} />
                                )}
                            </div>
                        </Section>
                    )}

                    {/* Event Data */}
                    {Object.keys(data).length > 0 && (
                        <Section title="Event Data">
                            <div className="font-mono text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 overflow-x-auto border border-zinc-200 dark:border-zinc-700">
                                <JsonValue value={data} />
                            </div>
                        </Section>
                    )}

                    {/* Context Events */}
                    <Section title="Context" defaultOpen={false}>
                        {contextError ? (
                            <FailureNote what="the surrounding events" message={contextError} onRetry={fetchContext} />
                        ) : contextEvents === null ? (
                            <button
                                onClick={fetchContext}
                                disabled={contextLoading}
                                aria-busy={contextLoading || undefined}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            >
                                {contextLoading ? <ButtonSpinner /> : null}
                                Show surrounding events (+/-30s)
                            </button>
                        ) : (
                            <EventMiniList events={contextEvents} currentTimestamp={event.timestamp} />
                        )}
                    </Section>

                    {/* Trace */}
                    {event.trace_id ? (
                        <Section title="Trace" defaultOpen={false}>
                            {traceError ? (
                                <FailureNote what="the trace" message={traceError} onRetry={fetchTrace} />
                            ) : traceEvents === null ? (
                                <button
                                    onClick={fetchTrace}
                                    disabled={traceLoading}
                                    aria-busy={traceLoading || undefined}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                >
                                    {traceLoading ? <ButtonSpinner /> : null}
                                    Show trace ({event.trace_id.slice(0, 8)}...)
                                </button>
                            ) : (
                                <EventMiniList events={traceEvents} currentTimestamp={event.timestamp} />
                            )}
                        </Section>
                    ) : null}

                    {/* Request */}
                    {event.request_id ? (
                        <Section title="Request" id="event-detail-request" open={requestOpen} onOpenChange={setRequestOpen}>
                            {requestError ? (
                                <FailureNote what="the request events" message={requestError} onRetry={fetchRequest} />
                            ) : requestEvents === null ? (
                                <button
                                    onClick={fetchRequest}
                                    disabled={requestLoading}
                                    aria-busy={requestLoading || undefined}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                >
                                    {requestLoading ? <ButtonSpinner /> : null}
                                    Show request events ({event.request_id.slice(0, 8)}...)
                                </button>
                            ) : (
                                <EventMiniList events={requestEvents} currentTimestamp={event.timestamp} />
                            )}
                        </Section>
                    ) : null}
                </div>
            </div>
        </>
    );
}

/** ±1 day around an event: trace and request lookups never scan the whole retention. */
function aroundEvent(ts: string): { from: string; to: string } {
    const t = new Date(ts).getTime();
    return {
        from: new Date(t - 86_400_000).toISOString(),
        to: new Date(t + 86_400_000).toISOString(),
    };
}

/**
 * An id on one line: truncated with the full value in the tooltip. `break-all`
 * wrapped a UUID at an arbitrary character ("…969c2b3e8a" / "c3"), which reads
 * as two values. The copy button beside it is how to get the whole thing.
 */
function IdValue({ value }: { value?: string }) {
    return (
        <span title={value} className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {value}
        </span>
    );
}

function FilterButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
            <FontAwesomeIcon icon={faFilter} className="text-[10px]" />
        </button>
    );
}

function CopyButton({
    label,
    copiedLabel,
    text,
    children,
}: {
    label: string;
    /** What the toast names — "Request ID copied". Never the value. */
    copiedLabel?: string;
    text: () => string;
    children?: React.ReactNode;
}) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                // copyText toasts both outcomes; a refused clipboard used to be
                // a silent no-op here.
                if (await copyText(text(), { label: copiedLabel })) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                }
            }}
            aria-label={label}
            title={label}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
            {copied ? (
                <svg className="h-3 w-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            )}
            {children}
        </button>
    );
}

/** Pretty-prints a value for display: a JSON string is re-indented, anything else is serialised. */
function prettyPrint(content: unknown): string {
    if (typeof content === "string") {
        try {
            return JSON.stringify(JSON.parse(content), null, 2);
        } catch {
            // Not JSON: show the string as-is. Expected, not a failure.
            return content;
        }
    }
    return JSON.stringify(content, null, 2);
}

function CollapsibleCode({ title, content }: { title: string; content: unknown }) {
    const [open, setOpen] = useState(false);

    // Formatted only while OPEN. It used to run on every render of every
    // collapsed block: a parse and a re-serialise of each large value the panel
    // holds (stack traces, request bodies), each time the panel re-rendered, for
    // text nobody had asked to see.
    return (
        <div>
            <button
                onClick={() => setOpen(!open)}
                className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1"
            >
                <svg
                    className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {title}
            </button>
            {open && (
                <pre className="mt-1 p-2 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono text-zinc-700 dark:text-zinc-300 overflow-x-auto max-h-48 overflow-y-auto">
                    {prettyPrint(content)}
                </pre>
            )}
        </div>
    );
}

function EventMiniList({ events, currentTimestamp }: { events: Event[]; currentTimestamp: string }) {
    const prefs = useDateTimePrefs();
    if (events.length === 0) {
        return <p className="text-sm text-zinc-400 dark:text-zinc-500">No events found</p>;
    }

    return (
        <div className="space-y-1 max-h-64 overflow-y-auto">
            {events.map((ev, i) => {
                const isCurrent = ev.timestamp === currentTimestamp && ev.name === events.find(e => e.timestamp === currentTimestamp)?.name;
                return (
                    <div
                        key={i}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                            isCurrent
                                ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                    >
                        <time
                            dateTime={ev.timestamp}
                            title={ev.timestamp}
                            className="font-mono text-zinc-400 dark:text-zinc-500 shrink-0 w-20"
                        >
                            {formatEventTimestamp(ev.timestamp, prefs).time}
                        </time>
                        <span className="inline-flex px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded shrink-0">
                            {ev.service}
                        </span>
                        {ev.level ? (
                            <span className={`inline-flex px-1.5 py-0.5 text-xs rounded shrink-0 ${getLevelColor(ev.level)}`}>
                                {ev.level}
                            </span>
                        ) : null}
                        <span className="text-zinc-700 dark:text-zinc-300 truncate">{ev.name}</span>
                    </div>
                );
            })}
        </div>
    );
}
