"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faCircle,
    faPlay,
    faPause,
    faTrash,
    faPlug,
    faChevronDown,
    faChevronRight,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Event } from "@/types";
import { getLabelValues } from "@/services/api";
import { firstError } from "@/services/api.service";
import { FailureNote, FailureState } from "@/components/FailureState";
import { useScope } from "@/hooks/useScope";
import { PROJECT_PARAM, ZONE_PARAM } from "@/tools/routing.tools";
import { MAX_STREAM_ATTEMPTS, probeStreamRefusal } from "@/tools/stream.tools";

const MAX_BUFFER = 500;

type ConnectionStatus = "disconnected" | "connecting" | "connected";

const LEVEL_COLORS: Record<string, string> = {
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    fatal: "bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200",
    debug: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function getLevelBadgeClass(level?: string): string {
    if (!level) return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    return LEVEL_COLORS[level.toLowerCase()] || LEVEL_COLORS.debug;
}

function getStatusColor(status: ConnectionStatus): string {
    switch (status) {
        case "connected":
            return "text-emerald-500";
        case "connecting":
            return "text-amber-500 animate-pulse";
        case "disconnected":
            return "text-red-500";
    }
}

function formatTimestamp(ts: string): string {
    return new Date(ts).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });
}

interface LiveEventRowProps {
    event: Event;
}

function LiveEventRow({ event }: LiveEventRowProps) {
    const [expanded, setExpanded] = useState(false);
    const hasData = event.data && Object.keys(event.data).length > 0;

    return (
        <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
            <div
                className={`flex items-center gap-3 px-4 py-2 text-sm ${hasData ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" : ""}`}
                onClick={() => hasData && setExpanded(!expanded)}
            >
                {hasData ? (
                    <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        className="w-3 h-3 text-zinc-400 dark:text-zinc-500 shrink-0"
                    />
                ) : (
                    <span className="w-3 shrink-0" />
                )}
                <span className="text-zinc-400 dark:text-zinc-500 tabular-nums font-mono text-xs shrink-0">
                    {formatTimestamp(event.timestamp)}
                </span>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 shrink-0">
                    {event.service}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${getLevelBadgeClass(event.level)}`}>
                    {event.level || "info"}
                </span>
                <span className="text-zinc-700 dark:text-zinc-300 truncate">
                    {event.name}
                </span>
            </div>
            {expanded && hasData && (
                <div className="px-4 pb-3 pl-14">
                    <pre className="text-xs bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 overflow-x-auto text-zinc-700 dark:text-zinc-300">
                        {JSON.stringify(event.data, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}

function LiveTail() {
    // Scope comes from `ScopeBoundary`, which reads it off the route and keys
    // this whole subtree on it. Two things follow, and both matter here:
    //
    //  • The stream is opened against the zone whose name is in the address bar
    //    and the project in `?project`, never a cookie or a snapshot from mount.
    //  • A scope change REMOUNTS this component, so the EventSource is torn down
    //    by the unmount cleanup rather than by a dependency comparison. The
    //    `connect` callback still lists them, which is now belt-and-braces
    //    rather than the mechanism.
    const { zone, project } = useScope();
    const [events, setEvents] = useState<Event[]>([]);
    const [status, setStatus] = useState<ConnectionStatus>("disconnected");
    const [paused, setPaused] = useState(false);
    const [serviceFilter, setServiceFilter] = useState("");
    const [levelFilter, setLevelFilter] = useState("");
    const [nameFilter, setNameFilter] = useState("");
    const [services, setServices] = useState<string[]>([]);
    const [levels, setLevels] = useState<string[]>([]);
    const [names, setNames] = useState<string[]>([]);
    const [filtersError, setFiltersError] = useState<string | null>(null);
    const [filtersToken, setFiltersToken] = useState(0);
    /**
     * Why the stream gave up, once it has.
     *
     * ⚠️ NULL IS "still trying", NOT "fine". It is deliberately separate from
     * `status`, because `disconnected` covers both the second between two
     * reconnects and the terminal state where reconnecting cannot help — and
     * rendering those the same way is what left this page telling the operator
     * to "Click Connect to start streaming" against a zone the proxy refuses to
     * route to at all.
     */
    const [refusal, setRefusal] = useState<string | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const pausedRef = useRef(false);
    const eventsRef = useRef<Event[]>([]);
    const retryCountRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<Event[]>([]);
    const rafRef = useRef<number | null>(null);
    const connectRef = useRef<() => void>(() => {});

    // Keep refs in sync
    useEffect(() => {
        pausedRef.current = paused;
    }, [paused]);

    // Load filter options.
    //
    // ⚠️ THE CANONICAL SCOPE AMBIGUITY. Three dropdowns reading only "All
    // Services" / "All Levels" / "All Names" is exactly what a working install
    // with an empty project looks like AND exactly what a broken project
    // selector looks like. "silently ignore" made those two indistinguishable
    // on the one page where the operator is watching traffic arrive live.
    useEffect(() => {
        const load = async () => {
            try {
                const [sRes, lRes, nRes] = await Promise.all([
                    getLabelValues("service"),
                    getLabelValues("level"),
                    getLabelValues("name"),
                ]);
                const failed = firstError(sRes, lRes, nRes);
                if (failed) {
                    setFiltersError(failed.error_message || "The request failed.");
                    return;
                }
                setFiltersError(null);
                setServices(sRes.success ? sRes.data : []);
                setLevels(lRes.success ? lRes.data : []);
                setNames(nRes.success ? nRes.data : []);
            } catch {
                setFiltersError("Failed to load filter options");
            }
        };
        load();
    }, [filtersToken]);

    const connect = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const params = new URLSearchParams();
        if (serviceFilter) params.set("service", serviceFilter);
        if (levelFilter) params.set("level", levelFilter);
        if (nameFilter) params.set("name", nameFilter);
        // ⚠️ The project selector is added HERE, explicitly. EventSource does not
        // go through axios, so the request interceptor in api.service.ts never
        // sees this URL — and the failure mode of forgetting it is silent: the
        // stream connects, frames arrive, and they are the default project's
        // while the page around them says otherwise.
        if (project) params.set(PROJECT_PARAM, project);
        // Same reasoning one level up: without this the tail streams from the
        // control plane's zone while the page around it says otherwise.
        if (zone) params.set(ZONE_PARAM, zone);
        const query = params.toString();
        const url = `/api/monitor-stream${query ? `?${query}` : ""}`;

        setStatus("connecting");
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
            setStatus("connected");
            retryCountRef.current = 0;
            setRefusal(null);
        };

        es.onmessage = (msg) => {
            if (pausedRef.current) return;
            try {
                const event: Event = JSON.parse(msg.data);
                pendingRef.current.push(event);
                if (!rafRef.current) {
                    rafRef.current = requestAnimationFrame(() => {
                        const pending = pendingRef.current;
                        pendingRef.current = [];
                        eventsRef.current = [...pending.reverse(), ...eventsRef.current].slice(0, MAX_BUFFER);
                        setEvents([...eventsRef.current]);
                        rafRef.current = null;
                    });
                }
            } catch {
                // ignore parse errors
            }
        };

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
            setStatus("disconnected");

            // ⚠️ THE RETRY IS BOUNDED NOW, AND THAT IS THE POINT. An unroutable
            // zone does not become routable by asking again: the proxy refuses
            // it with a 502 before it ever reaches a backend, and EventSource
            // cannot read that status or that body — so this loop ran forever,
            // silently, under the words "Disconnected. Click Connect to start
            // streaming." An instruction that cannot work is worse than none.
            //
            // Past the bound, ask ONCE with a plain fetch, which CAN read the
            // refusal, and put the server's own sentence on screen.
            if (retryCountRef.current >= MAX_STREAM_ATTEMPTS) {
                void probeStreamRefusal(url).then((found) => {
                    setRefusal(
                        found?.message ??
                            `The event stream for zone “${zone}” dropped ${MAX_STREAM_ATTEMPTS} times in a row and the endpoint gave no reason. The zone may be restarting.`,
                    );
                });
                return;
            }

            // Auto-reconnect with exponential backoff
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
            retryCountRef.current++;
            reconnectTimerRef.current = setTimeout(() => {
                if (!pausedRef.current) connectRef.current();
            }, delay);
        };
    }, [serviceFilter, levelFilter, nameFilter, project, zone]);

    /**
     * The manual "Connect" path.
     *
     * Separate from `connect` because the retry budget has to be handed back:
     * `connect` is also what the backoff timer calls, and resetting the counter
     * inside it would make the bound above unreachable — the loop would run
     * forever again, one attempt at a time.
     */
    const reconnect = useCallback(() => {
        retryCountRef.current = 0;
        setRefusal(null);
        connect();
    }, [connect]);

    useEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    const disconnect = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        retryCountRef.current = 0;
        setStatus("disconnected");
    }, []);

    // Auto-connect on mount and filter changes
    useEffect(() => {
        // connect() subscribes to the EventSource stream — a legitimate
        // external-system effect. Its optimistic setStatus("connecting") is
        // intentional and runs once per (re)connect, not a cascading render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        connect();
        return () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
        };
    }, [connect]);

    const handleClear = () => {
        eventsRef.current = [];
        setEvents([]);
    };

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Live Tail
                        </h1>
                        <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                            <FontAwesomeIcon
                                icon={status === "connecting" ? faSpinner : faCircle}
                                className={`text-xs ${status === "connecting" ? "animate-spin" : getStatusColor(status)}`}
                            />
                            <span className="capitalize">{status}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
                            {events.length} events
                        </span>
                        <button
                            onClick={() => setPaused(!paused)}
                            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                paused
                                    ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            }`}
                        >
                            <FontAwesomeIcon icon={paused ? faPlay : faPause} className="text-xs" />
                            {paused ? "Resume" : "Pause"}
                        </button>
                        <button
                            onClick={handleClear}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                        >
                            <FontAwesomeIcon icon={faTrash} className="text-xs" />
                            Clear
                        </button>
                        {status === "disconnected" ? (
                            <button
                                onClick={reconnect}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlug} className="text-xs" />
                                Connect
                            </button>
                        ) : (
                            <button
                                onClick={disconnect}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlug} className="text-xs" />
                                Disconnect
                            </button>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    {filtersError && (
                        <FailureNote
                            what="the filter options"
                            message={filtersError}
                            onRetry={() => setFiltersToken((t) => t + 1)}
                        />
                    )}
                    <select
                        value={serviceFilter}
                        onChange={(e) => setServiceFilter(e.target.value)}
                        className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Services</option>
                        {services.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <select
                        value={levelFilter}
                        onChange={(e) => setLevelFilter(e.target.value)}
                        className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Levels</option>
                        {levels.map((l) => (
                            <option key={l} value={l}>{l}</option>
                        ))}
                    </select>
                    <select
                        value={nameFilter}
                        onChange={(e) => setNameFilter(e.target.value)}
                        className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">All Names</option>
                        {names.map((n) => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </div>

                {/* Event stream */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Event Stream
                        </span>
                        {paused && (
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                Paused
                            </span>
                        )}
                    </div>
                    <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                        {/* The refusal outranks everything, including a buffer of
                            events already on screen: those are now a snapshot of
                            a stream that has stopped, and leaving them under a
                            live-looking header is the same lie in slower motion. */}
                        {refusal ? (
                            <FailureState
                                what={`the live tail for zone “${zone}”`}
                                message={refusal}
                                onRetry={reconnect}
                                className="rounded-none border-0"
                            />
                        ) : events.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                {status === "connected" ? (
                                    <>
                                        <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin mb-3" />
                                        <p className="text-sm">Waiting for events...</p>
                                    </>
                                ) : status === "connecting" ? (
                                    <>
                                        <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin mb-3" />
                                        <p className="text-sm">Connecting...</p>
                                    </>
                                ) : (
                                    <>
                                        <FontAwesomeIcon icon={faPlug} className="text-2xl mb-3" />
                                        <p className="text-sm">Disconnected. Click Connect to start streaming.</p>
                                    </>
                                )}
                            </div>
                        ) : (
                            events.map((event, i) => (
                                <LiveEventRow key={`${event.timestamp}-${event.service}-${event.name}-${i}`} event={event} />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}

export default function LivePage() {
    // No Suspense boundary of its own any more: the scope no longer comes from
    // `useSearchParams` here, it comes from `useScope`, and the one
    // `useSearchParams` call left in the tree is `ScopeBoundary`'s — which
    // `[zone]/layout.tsx` already wraps.
    return <LiveTail />;
}
