"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Event } from "@/types";
import { getEvents } from "@/services/api";

interface EventDetailPanelProps {
    event: Event | null;
    onClose: () => void;
}

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
        return ts;
    }
}

function formatAbsoluteTime(ts: string): string {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return ts;
    }
}

// Collapsible section
function Section({
    title,
    defaultOpen = true,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
            <button
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

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
    const [contextEvents, setContextEvents] = useState<Event[] | null>(null);
    const [contextLoading, setContextLoading] = useState(false);
    const [traceEvents, setTraceEvents] = useState<Event[] | null>(null);
    const [traceLoading, setTraceLoading] = useState(false);
    const [requestEvents, setRequestEvents] = useState<Event[] | null>(null);
    const [requestLoading, setRequestLoading] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        if (event) {
            document.addEventListener("keydown", handleKey);
            document.body.style.overflow = "hidden";
            return () => {
                document.removeEventListener("keydown", handleKey);
                document.body.style.overflow = "";
            };
        }
    }, [event, onClose]);

    // Reset state when event changes
    useEffect(() => {
        setContextEvents(null);
        setTraceEvents(null);
        setRequestEvents(null);
    }, [event]);

    const fetchContext = useCallback(async () => {
        if (!event) return;
        setContextLoading(true);
        try {
            const ts = new Date(event.timestamp);
            const from = new Date(ts.getTime() - 30000).toISOString();
            const to = new Date(ts.getTime() + 30000).toISOString();
            const res = await getEvents({ service: event.service, from, to, limit: 50 });
            setContextEvents(res.data || []);
        } catch {
            setContextEvents([]);
        } finally {
            setContextLoading(false);
        }
    }, [event]);

    const fetchTrace = useCallback(async () => {
        if (!event?.trace_id) return;
        setTraceLoading(true);
        try {
            const res = await getEvents({ trace_id: event.trace_id, limit: 100 });
            setTraceEvents(res.data || []);
        } catch {
            setTraceEvents([]);
        } finally {
            setTraceLoading(false);
        }
    }, [event]);

    const fetchRequest = useCallback(async () => {
        if (!event?.request_id) return;
        setRequestLoading(true);
        try {
            const res = await getEvents({ request_id: event.request_id, limit: 100 });
            setRequestEvents(res.data || []);
        } catch {
            setRequestEvents([]);
        } finally {
            setRequestLoading(false);
        }
    }, [event]);

    if (!event) return null;

    const data = event.data || {};
    const hasSourceInfo = Boolean(data.source_file);
    const hasRequestInfo = Boolean(data.request_method);

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
                className="fixed top-0 right-0 h-full w-full max-w-[600px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 flex flex-col animate-slide-in-right overflow-hidden"
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
                            <span className="text-zinc-300 dark:text-zinc-600">|</span>
                            <span className="font-mono">{formatAbsoluteTime(event.timestamp)}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
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
                    <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 grid grid-cols-2 gap-3 text-sm">
                        {event.env ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Environment</span>
                                <span className="font-medium text-zinc-900 dark:text-zinc-100">{event.env}</span>
                            </div>
                        ) : null}
                        {event.user_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">User ID</span>
                                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">{event.user_id}</span>
                            </div>
                        ) : null}
                        {event.job_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Job ID</span>
                                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">{event.job_id}</span>
                            </div>
                        ) : null}
                        {event.trace_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Trace ID</span>
                                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">{event.trace_id}</span>
                            </div>
                        ) : null}
                        {event.request_id ? (
                            <div>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Request ID</span>
                                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">{event.request_id}</span>
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
                                        {String(data.request_method)}
                                    </span>
                                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400 break-all">
                                        {String(data.request_path || data.request_url || "")}
                                    </span>
                                    {Boolean(data.response_status) && (
                                        <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${getStatusColor(data.response_status as number)}`}>
                                            {String(data.response_status)}
                                        </span>
                                    )}
                                </div>

                                {/* Duration */}
                                {Boolean(data.duration_ms) && (
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
                        {contextEvents === null ? (
                            <button
                                onClick={fetchContext}
                                disabled={contextLoading}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            >
                                {contextLoading ? (
                                    <FontAwesomeIcon icon={faSpinner} className="animate-spin text-xs" />
                                ) : null}
                                Show surrounding events (+/-30s)
                            </button>
                        ) : (
                            <EventMiniList events={contextEvents} currentTimestamp={event.timestamp} />
                        )}
                    </Section>

                    {/* Trace */}
                    {event.trace_id ? (
                        <Section title="Trace" defaultOpen={false}>
                            {traceEvents === null ? (
                                <button
                                    onClick={fetchTrace}
                                    disabled={traceLoading}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                >
                                    {traceLoading ? (
                                        <FontAwesomeIcon icon={faSpinner} className="animate-spin text-xs" />
                                    ) : null}
                                    Show trace ({event.trace_id.slice(0, 8)}...)
                                </button>
                            ) : (
                                <EventMiniList events={traceEvents} currentTimestamp={event.timestamp} />
                            )}
                        </Section>
                    ) : null}

                    {/* Request */}
                    {event.request_id ? (
                        <Section title="Request" defaultOpen={false}>
                            {requestEvents === null ? (
                                <button
                                    onClick={fetchRequest}
                                    disabled={requestLoading}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                >
                                    {requestLoading ? (
                                        <FontAwesomeIcon icon={faSpinner} className="animate-spin text-xs" />
                                    ) : null}
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

function CollapsibleCode({ title, content }: { title: string; content: unknown }) {
    const [open, setOpen] = useState(false);

    let displayContent: string;
    if (typeof content === "string") {
        try {
            displayContent = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
            displayContent = content;
        }
    } else {
        displayContent = JSON.stringify(content, null, 2);
    }

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
                    {displayContent}
                </pre>
            )}
        </div>
    );
}

function EventMiniList({ events, currentTimestamp }: { events: Event[]; currentTimestamp: string }) {
    if (events.length === 0) {
        return <p className="text-sm text-zinc-400 dark:text-zinc-500">No events found</p>;
    }

    return (
        <div className="space-y-1 max-h-64 overflow-y-auto">
            {events.map((ev, i) => {
                const isCurrent = ev.timestamp === currentTimestamp && ev.name === events.find(e => e.timestamp === currentTimestamp)?.name;
                const ts = new Date(ev.timestamp);
                return (
                    <div
                        key={i}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                            isCurrent
                                ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                    >
                        <span className="font-mono text-zinc-400 dark:text-zinc-500 shrink-0 w-20">
                            {ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
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
