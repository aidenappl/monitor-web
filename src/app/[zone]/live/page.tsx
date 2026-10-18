"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faCircle,
    faPlay,
    faPause,
    faTrash,
    faPlug,
    faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import { Event } from "@/types";
import { getLabelValues } from "@/services/api";
import { firstError } from "@/services/api.service";
import { FailureNote, FailureState } from "@/components/FailureState";
import { Segmented } from "@/components/ui/segmented";
import { LiveEventRow } from "@/components/live/LiveEventRow";
import { RateMeter } from "@/components/live/RateMeter";
import {
    MAX_BUFFER,
    TIME_ZONE_MODES,
    createRateTracker,
    formatClockShort,
    formatSpan,
    freeTerms,
    localZoneLabel,
    matchSearch,
    matchesStreamFilters,
    mergeNewestFirst,
    parseSearch,
    toLiveEvent,
    type LiveEvent,
    type StreamFilters,
} from "@/components/live/live.tools";
import { useScope } from "@/hooks/useScope";
import { useUrlState, urlEnum, urlString } from "@/hooks/useUrlState";
import { PROJECT_PARAM, ZONE_PARAM, zoneHref } from "@/tools/routing.tools";
import { MAX_STREAM_ATTEMPTS, probeStreamRefusal } from "@/tools/stream.tools";
import { reportError, reportWarn } from "@/services/monitor.service";
import { refreshSession } from "@/tools/session.tools";
import { suggestionWindow, withSelected } from "@/tools/timeRange.tools";

/** The most events the pinned tray holds. */
const MAX_PINNED = 10;

/**
 * `reconnecting` is the gap between automatic attempts and `offline` is the
 * browser reporting no network; both used to read "Disconnected" beside a
 * Connect button, which said "stopped" about a stream that was retrying.
 */
type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "offline";

const SELECT_CLASS =
    "min-w-[9rem] px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500";
const SECONDARY_BUTTON_CLASS =
    "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const noopSubscribe = () => () => {};

/** Ends a server sentence with punctuation so FailureState's own line does not run into it. */
function sentence(message: string): string {
    const m = message.trim();
    return /[.!?…]$/.test(m) ? m : `${m}.`;
}

/** "retry in 4s", ticking on its own so the page does not re-render every second. */
function RetryCountdown({ at }: { at: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, []);
    const s = Math.max(0, Math.ceil((at - now) / 1000));
    return <span className="tabular-nums">{s > 0 ? `retry in ${s}s` : "retrying…"}</span>;
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
    const [events, setEvents] = useState<LiveEvent[]>([]);
    // "connecting", not "disconnected": the mount effect connects at once, and a
    // first paint of "Disconnected" + a Connect button that swaps a frame later
    // for "Connecting" + Disconnect was most of this page's layout shift.
    const [status, setStatus] = useState<ConnectionStatus>("connecting");
    const [paused, setPaused] = useState(false);
    // The three subscription filters and the search live in the URL, so a
    // "live errors from forta-api" view can be bookmarked, shared and reloaded.
    const [serviceFilter, setServiceFilter] = useUrlState("service", urlString, { default: "" });
    const [levelFilter, setLevelFilter] = useUrlState("level", urlString, { default: "" });
    const [nameFilter, setNameFilter] = useUrlState("name", urlString, { default: "" });
    // Client-side, over what is already buffered: narrowing the server
    // subscription by free text is not something the stream supports, and a
    // search should not reconnect the stream on every keystroke.
    const [search, setSearch] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
    const [timeZone, setTimeZone] = useUrlState("tz", urlEnum(TIME_ZONE_MODES), { default: "local" });
    // The browser's zone, which the server render cannot know — "Local" until hydrated.
    const zoneLabel = useSyncExternalStore(noopSubscribe, localZoneLabel, () => "Local");
    const [services, setServices] = useState<string[]>([]);
    const [levels, setLevels] = useState<string[]>([]);
    const [names, setNames] = useState<string[]>([]);
    const [filtersError, setFiltersError] = useState<string | null>(null);
    const [filtersToken, setFiltersToken] = useState(0);
    /**
     * Why the stream gave up, once it has.
     *
     * ⚠️ NULL IS "still trying", NOT "fine". It is deliberately separate from
     * `status`, because `disconnected` covers both a manual stop and the
     * terminal state where reconnecting cannot help — and rendering those the
     * same way is what left this page telling the operator to "Click Connect to
     * start streaming" against a zone the proxy refuses to route to at all.
     */
    const [refusal, setRefusal] = useState<string | null>(null);
    /** The automatic retry in progress: which attempt, and when it fires (null = refreshing the session). */
    const [retry, setRetry] = useState<{ attempt: number; at: number | null } | null>(null);
    /** When the stream last stopped being live. Null while connected. */
    const [stoppedAt, setStoppedAt] = useState<number | null>(null);
    /** Events received while paused — held, not dropped. */
    const [held, setHeld] = useState({ count: 0, dropped: 0 });
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [pinned, setPinned] = useState<LiveEvent[]>([]);
    const [tracker] = useState(createRateTracker);

    const eventSourceRef = useRef<EventSource | null>(null);
    const pausedRef = useRef(false);
    const eventsRef = useRef<LiveEvent[]>([]);
    /**
     * ⚠️ PAUSE FREEZES THE VIEW; IT DOES NOT STOP COLLECTING. `onmessage` used to
     * return early while paused, so a ten-second pause was a ten-second hole in
     * the tail with nothing to say so. Frames now land here (arrival order,
     * capped at MAX_BUFFER, overflow counted) and are merged in on Resume.
     */
    const heldRef = useRef<LiveEvent[]>([]);
    const heldDroppedRef = useRef(0);
    const seqRef = useRef(0);
    /** The filters the CURRENT subscription was opened with; frames are re-checked against them. */
    const filtersRef = useRef<StreamFilters>({ service: "", level: "", name: "" });
    const retryCountRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<LiveEvent[]>([]);
    const rafRef = useRef<number | null>(null);
    const connectRef = useRef<() => void>(() => {});
    /** Set when the browser went offline under a live stream, so `online` knows to resume it. */
    const autoOfflineRef = useRef(false);
    /** Whether this connection cycle has already spent its one session refresh. */
    const refreshTriedRef = useRef(false);
    /**
     * Bumped by every connect, disconnect and unmount, so an async refresh that
     * resolves after the stream it was rescuing has been superseded does nothing.
     */
    const streamGenRef = useRef(0);

    // Load filter options.
    //
    // ⚠️ THE CANONICAL SCOPE AMBIGUITY. Three dropdowns reading only "All
    // Services" / "All Levels" / "All Names" is exactly what a working install
    // with an empty project looks like AND exactly what a broken project
    // selector looks like. "silently ignore" made those two indistinguishable
    // on the one page where the operator is watching traffic arrive live.
    useEffect(() => {
        const load = async () => {
            // The live tail has no range of its own, so the default label window.
            const labelsWindow = suggestionWindow("labels");
            try {
                const [sRes, lRes, nRes] = await Promise.all([
                    getLabelValues("service", { window: labelsWindow }),
                    getLabelValues("level", { window: labelsWindow }),
                    getLabelValues("name", { window: labelsWindow }),
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
            } catch (err) {
                reportError("live_tail.filters.load.failed", err, {
                    outcome: "filter dropdowns show their failure note",
                });
                setFiltersError("Failed to load filter options");
            }
        };
        load();
    }, [filtersToken]);

    /** One state write per animation frame, however many frames arrived. */
    const scheduleFlush = useCallback(() => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const f = filtersRef.current;
            const batch = pendingRef.current.filter((le) => matchesStreamFilters(le, f));
            pendingRef.current = [];
            if (batch.length === 0) return;
            if (pausedRef.current) {
                const next = [...heldRef.current, ...batch];
                const over = next.length - MAX_BUFFER;
                if (over > 0) {
                    next.splice(0, over);
                    heldDroppedRef.current += over;
                }
                heldRef.current = next;
                setHeld({ count: next.length, dropped: heldDroppedRef.current });
                return;
            }
            eventsRef.current = mergeNewestFirst(eventsRef.current, batch);
            setEvents(eventsRef.current);
        });
    }, []);

    const clearRetryTimer = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
    }, []);

    const connect = useCallback(() => {
        // Any connect supersedes a pending backoff — otherwise "Retry now"
        // mid-backoff fired a second connect when the old timer came due.
        clearRetryTimer();
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        // Filters are applied to what is already on screen BEFORE the new
        // subscription opens, so a Level=error view never shows the info rows
        // the previous subscription delivered.
        const filters: StreamFilters = { service: serviceFilter, level: levelFilter, name: nameFilter };
        filtersRef.current = filters;
        const kept = eventsRef.current.filter((le) => matchesStreamFilters(le, filters));
        if (kept.length !== eventsRef.current.length) {
            eventsRef.current = kept;
            setEvents(kept);
        }
        const keptHeld = heldRef.current.filter((le) => matchesStreamFilters(le, filters));
        if (keptHeld.length !== heldRef.current.length) {
            heldRef.current = keptHeld;
            setHeld({ count: keptHeld.length, dropped: heldDroppedRef.current });
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

        setStatus((s) => (s === "reconnecting" ? s : "connecting"));
        const gen = ++streamGenRef.current;
        const es = new EventSource(url);
        eventSourceRef.current = es;
        // One report per connection: a stream whose every frame fails renders
        // as a quiet tail — DOWN as EMPTY — and nothing else would say so.
        let frameErrorReported = false;
        /** A 401 prevents onopen, so only a never-opened stream is a refresh candidate. */
        let opened = false;

        es.onopen = () => {
            opened = true;
            setStatus("connected");
            setRetry(null);
            setStoppedAt(null);
            retryCountRef.current = 0;
            refreshTriedRef.current = false;
            setRefusal(null);
        };

        es.onmessage = (msg) => {
            try {
                const raw: Event = JSON.parse(msg.data);
                const le = toLiveEvent(raw, ++seqRef.current);
                tracker.record(le.level);
                pendingRef.current.push(le);
                scheduleFlush();
            } catch (err) {
                // The frame is dropped either way.
                if (!frameErrorReported) {
                    frameErrorReported = true;
                    reportError("live_tail.frame.parse.failed", err, {
                        frame_length: typeof msg.data === "string" ? msg.data.length : undefined,
                        outcome: "frame dropped from the live tail",
                    });
                }
            }
        };

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
            setStatus("reconnecting");
            setStoppedAt((s) => s ?? Date.now());

            // ⚠️ AN EXPIRED ACCESS TOKEN LOOKS LIKE EVERY OTHER DROP. EventSource
            // cannot see the 401, and it never goes through the axios 401 path
            // that refreshes the session — so a tab left open past the access
            // token's lifetime burned its whole retry budget against a stream it
            // could never reopen. Refresh ONCE per connection cycle, and only
            // for a stream that never opened (a drop after open is not a 401,
            // and refreshing it would skip the backoff); on success reconnect
            // immediately without spending an attempt. On failure, fall through
            // to the bounded retry below. Never endSession() from here: the
            // page's own requests own that decision.
            if (!opened && !refreshTriedRef.current) {
                refreshTriedRef.current = true;
                setRetry({ attempt: retryCountRef.current, at: null });
                void refreshSession().then((ok) => {
                    if (gen !== streamGenRef.current) return;
                    if (!ok) {
                        retryOrGiveUp();
                        return;
                    }
                    connectRef.current();
                });
                return;
            }
            retryOrGiveUp();
        };

        function retryOrGiveUp() {
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
                setRetry(null);
                setStatus("disconnected");
                void probeStreamRefusal(url).then((found) => {
                    if (gen !== streamGenRef.current) return;
                    // A refusal was already reported server-side by the bridge
                    // (proxy.zone.unroutable / stream.upstream.*). Drops with NO
                    // refusal are invisible there — every connect succeeded.
                    if (!found) {
                        reportWarn("live_tail.stream.failed", {
                            attempts: MAX_STREAM_ATTEMPTS,
                            reason: "the stream dropped repeatedly and the probe found no refusal",
                            outcome: "live tail stopped; user shown a reconnect prompt",
                        });
                    }
                    setRefusal(
                        sentence(
                            found?.message ??
                                `The event stream for zone “${zone}” dropped ${MAX_STREAM_ATTEMPTS} times in a row and the endpoint gave no reason. The zone may be restarting.`,
                        ),
                    );
                });
                return;
            }

            // Auto-reconnect with exponential backoff
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
            retryCountRef.current++;
            setRetry({ attempt: retryCountRef.current, at: Date.now() + delay });
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                connectRef.current();
            }, delay);
        }
    }, [serviceFilter, levelFilter, nameFilter, project, zone, scheduleFlush, tracker, clearRetryTimer]);

    /**
     * The manual "Connect" / "Retry now" path.
     *
     * Separate from `connect` because the retry budget has to be handed back:
     * `connect` is also what the backoff timer calls, and resetting the counter
     * inside it would make the bound above unreachable — the loop would run
     * forever again, one attempt at a time.
     */
    const reconnect = useCallback(() => {
        autoOfflineRef.current = false;
        retryCountRef.current = 0;
        refreshTriedRef.current = false;
        setRefusal(null);
        setRetry(null);
        setStatus("connecting");
        connect();
    }, [connect]);

    useEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    /** Closes the stream and cancels any retry. Says nothing about why. */
    const stop = useCallback(() => {
        streamGenRef.current++;
        clearRetryTimer();
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        retryCountRef.current = 0;
        setRetry(null);
        setStoppedAt((s) => s ?? Date.now());
    }, [clearRetryTimer]);

    const disconnect = useCallback(() => {
        autoOfflineRef.current = false;
        stop();
        setStatus("disconnected");
    }, [stop]);

    // Auto-connect on mount and filter changes
    useEffect(() => {
        // The ref OBJECT, captured so the cleanup can invalidate any refresh
        // still in flight for the stream it is tearing down.
        const streamGen = streamGenRef;
        // connect() subscribes to the EventSource stream — a legitimate
        // external-system effect. Its optimistic setStatus("connecting") is
        // intentional and runs once per (re)connect, not a cascading render.
        connect();
        return () => {
            streamGen.current++;
            clearRetryTimer();
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
        };
    }, [connect, clearRetryTimer]);

    // ⚠️ THE BROWSER KNOWS BEFORE TCP DOES. Offline, the navbar pill turned red
    // while this said "Connected" until the socket timed out, minutes later.
    // Stop on `offline`; resume on `online` only if it was offline that stopped us.
    useEffect(() => {
        const onOffline = () => {
            if (!eventSourceRef.current && !reconnectTimerRef.current) return;
            autoOfflineRef.current = true;
            stop();
            setStatus("offline");
        };
        const onOnline = () => {
            if (autoOfflineRef.current) reconnect();
        };
        window.addEventListener("offline", onOffline);
        window.addEventListener("online", onOnline);
        return () => {
            window.removeEventListener("offline", onOffline);
            window.removeEventListener("online", onOnline);
        };
    }, [stop, reconnect]);

    const togglePause = () => {
        if (pausedRef.current) {
            pausedRef.current = false;
            eventsRef.current = mergeNewestFirst(eventsRef.current, heldRef.current);
            heldRef.current = [];
            heldDroppedRef.current = 0;
            setEvents(eventsRef.current);
            setHeld({ count: 0, dropped: 0 });
            setPaused(false);
        } else {
            pausedRef.current = true;
            setPaused(true);
        }
    };

    const handleClear = () => {
        eventsRef.current = [];
        heldRef.current = [];
        heldDroppedRef.current = 0;
        setEvents([]);
        setHeld({ count: 0, dropped: 0 });
        setExpanded(new Set());
    };

    const toggleExpanded = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const togglePin = (le: LiveEvent) => {
        if (pinned.some((p) => p.id === le.id)) {
            setPinned(pinned.filter((p) => p.id !== le.id));
            return;
        }
        if (pinned.length >= MAX_PINNED) {
            toast.error(`The tray holds ${MAX_PINNED} events — unpin one first`);
            return;
        }
        setPinned([le, ...pinned]);
    };

    const tokens = useMemo(() => parseSearch(search), [search]);
    const terms = useMemo(() => freeTerms(tokens), [tokens]);
    const visible = useMemo(() => {
        if (tokens.length === 0) return events.map((le) => ({ le, snippet: null as string | null }));
        const out: { le: LiveEvent; snippet: string | null }[] = [];
        for (const le of events) {
            const m = matchSearch(le, tokens);
            if (m) out.push({ le, snippet: m.snippet });
        }
        return out;
    }, [events, tokens]);

    const eventsHref = (le: LiveEvent) =>
        zoneHref(
            zone,
            `?event=${encodeURIComponent(`${le.event.timestamp}|${le.event.service}|${le.event.name}`)}`,
            project,
        );
    const traceHref = (le: LiveEvent) =>
        le.event.trace_id
            ? zoneHref(zone, `?q=${encodeURIComponent(new URLSearchParams({ trace_id: le.event.trace_id }).toString())}`, project)
            : null;

    const pinnedIds = new Set(pinned.map((p) => p.id));
    const bufferFull = events.length >= MAX_BUFFER;
    const span = events.length > 1 ? events[0].t - events[events.length - 1].t : 0;
    const stale = refusal !== null || (stoppedAt !== null && status !== "connected");

    const statusLabel = refusal
        ? "Stopped"
        : status === "reconnecting"
          ? retry?.at === null
              ? "Reconnecting — refreshing session"
              : `Reconnecting (attempt ${retry?.attempt ?? 1} of ${MAX_STREAM_ATTEMPTS})`
          : status === "offline"
            ? "Offline — resumes when the network returns"
            : status === "connecting"
              ? "Connecting"
              : status === "connected"
                ? "Connected"
                : "Disconnected";
    const statusDot =
        refusal || status === "offline"
            ? "text-red-500"
            : status === "connected"
              ? "text-emerald-500"
              : status === "reconnecting"
                ? "text-amber-500 animate-pulse"
                : "text-zinc-400";

    const renderRow = (le: LiveEvent, prefix: string, snippet: string | null, rowTerms: string[]) => (
        <LiveEventRow
            key={le.id}
            le={le}
            domId={`live-${prefix}-${le.id}`}
            expanded={expanded.has(`${prefix}-${le.id}`)}
            onToggle={() => toggleExpanded(`${prefix}-${le.id}`)}
            pinned={pinnedIds.has(le.id)}
            onTogglePin={() => togglePin(le)}
            terms={rowTerms}
            snippet={snippet}
            timeZone={timeZone}
            eventsHref={eventsHref(le)}
            traceHref={traceHref(le)}
        />
    );

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                {/* Header */}
                <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 items-start lg:items-center justify-between">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-8">
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Live Tail
                        </h1>
                        <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                            <FontAwesomeIcon
                                icon={status === "connecting" ? faSpinner : faCircle}
                                className={`text-xs ${status === "connecting" ? "animate-spin text-amber-500" : statusDot}`}
                                aria-hidden
                            />
                            <span role="status">{statusLabel}</span>
                            {status === "reconnecting" && retry?.at != null && !refusal && (
                                <span aria-hidden className="text-zinc-400 dark:text-zinc-500">
                                    · <RetryCountdown key={retry.at} at={retry.at} />
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={togglePause}
                            aria-pressed={paused}
                            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                paused
                                    ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            }`}
                        >
                            <FontAwesomeIcon icon={paused ? faPlay : faPause} className="text-xs" aria-hidden />
                            {paused ? (held.count > 0 ? `Resume (${held.count} new)` : "Resume") : "Pause"}
                        </button>
                        <button type="button" onClick={handleClear} className={SECONDARY_BUTTON_CLASS}>
                            <FontAwesomeIcon icon={faTrash} className="text-xs" aria-hidden />
                            Clear
                        </button>
                        {status === "reconnecting" && !refusal && (
                            <button type="button" onClick={reconnect} className={SECONDARY_BUTTON_CLASS}>
                                <FontAwesomeIcon icon={faRotateRight} className="text-xs" aria-hidden />
                                Retry now
                            </button>
                        )}
                        {status === "disconnected" ? (
                            <button
                                type="button"
                                onClick={reconnect}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            >
                                <FontAwesomeIcon icon={refusal ? faRotateRight : faPlug} className="text-xs" aria-hidden />
                                {refusal ? "Try again" : "Connect"}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={disconnect}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                                <FontAwesomeIcon icon={faPlug} className="text-xs" aria-hidden />
                                Disconnect
                            </button>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search, or key:value…"
                        aria-label="Search buffered events"
                        title="Matches service, name, level, ids and payload values. key:value matches one field, e.g. trace_id:abc or method:POST"
                        className="min-w-[200px] flex-1 max-w-md px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select aria-label="Service" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className={SELECT_CLASS}>
                        <option value="">All Services</option>
                        {withSelected(services, serviceFilter).map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <select aria-label="Level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className={SELECT_CLASS}>
                        <option value="">All Levels</option>
                        {withSelected(levels, levelFilter).map((l) => (
                            <option key={l} value={l}>{l}</option>
                        ))}
                    </select>
                    <select aria-label="Event name" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} className={SELECT_CLASS}>
                        <option value="">All Names</option>
                        {withSelected(names, nameFilter).map((n) => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2">
                        <Segmented
                            label="Time zone"
                            options={[
                                {
                                    value: "local",
                                    // Fixed width: "Local" (server) becomes e.g. "PDT" on hydration.
                                    label: <span className="inline-block min-w-[2.25rem] text-center">{zoneLabel}</span>,
                                    title: "Show times in your local time zone",
                                },
                                { value: "utc", label: "UTC", title: "Show times in UTC" },
                            ]}
                            value={timeZone}
                            onChange={setTimeZone}
                        />
                    </div>
                    {/* After the controls, so its arrival does not shove them sideways. */}
                    {filtersError && (
                        <FailureNote
                            what="the filter options"
                            message={filtersError}
                            onRetry={() => setFiltersToken((t) => t + 1)}
                        />
                    )}
                </div>

                {/* Pinned tray — survives buffer churn, Clear and filter changes. */}
                {pinned.length > 0 && (
                    <section
                        aria-label="Pinned events"
                        className="bg-white dark:bg-zinc-900 rounded-xl border border-blue-200 dark:border-blue-900/60 shadow-sm overflow-hidden"
                    >
                        <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-blue-50/60 dark:bg-blue-900/20 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Pinned <span className="text-zinc-400 tabular-nums">({pinned.length}/{MAX_PINNED})</span>
                            </h2>
                            <button
                                type="button"
                                onClick={() => setPinned([])}
                                className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                            >
                                Unpin all
                            </button>
                        </div>
                        <div className="max-h-72 overflow-y-auto">{pinned.map((le) => renderRow(le, "p", null, []))}</div>
                    </section>
                )}

                {/* Event stream */}
                <section
                    aria-labelledby="live-stream-title"
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden"
                >
                    <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                            <h2 id="live-stream-title" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Event Stream
                            </h2>
                            <RateMeter tracker={tracker} />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                            <span className="whitespace-nowrap">
                                {tokens.length > 0 ? `${visible.length} of ${events.length}` : events.length} events
                                {stale && events.length > 0 ? " (snapshot)" : ""}
                            </span>
                            {span > 0 && (
                                <span className="whitespace-nowrap" title="Time between the oldest and newest buffered event">
                                    · covers {formatSpan(span)}
                                </span>
                            )}
                            {bufferFull && (
                                <span
                                    className="whitespace-nowrap font-medium text-amber-600 dark:text-amber-400"
                                    title={`The tail keeps the newest ${MAX_BUFFER} events; older ones are dropped. Use the Events page for history.`}
                                >
                                    · buffer full, oldest dropped
                                </span>
                            )}
                            <span className="hidden sm:inline whitespace-nowrap" title="Rows are ordered by the event's own timestamp, not arrival">
                                · newest first by event time
                            </span>
                        </div>
                    </div>

                    {paused && (
                        <div className="px-4 py-2 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-300">
                            <span>
                                Paused — {held.count === 0 ? "new events are being held" : `${held.count} new event${held.count === 1 ? "" : "s"} held`}
                                {held.dropped > 0 && ` (${held.dropped} older dropped past ${MAX_BUFFER})`}.
                            </span>
                            <button type="button" onClick={togglePause} className="font-medium underline underline-offset-2">
                                Resume{held.count > 0 ? ` and show ${held.count}` : ""}
                            </button>
                        </div>
                    )}

                    {/* The refusal is a banner ABOVE the buffer, not a replacement
                        for it: those rows are the last evidence the operator has.
                        They are dimmed and labelled a snapshot so nobody reads
                        them as live. */}
                    {refusal && (
                        <FailureState
                            what={`the live tail for zone “${zone}”`}
                            message={refusal}
                            className="rounded-none border-x-0 border-t-0 py-5!"
                        />
                    )}
                    {stale && events.length > 0 && (
                        <p className="px-4 py-1.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 text-xs text-zinc-500 dark:text-zinc-400">
                            {refusal ? "Snapshot — stream stopped" : "Stream interrupted"}
                            {stoppedAt !== null && ` at ${formatClockShort(stoppedAt, timeZone)}${timeZone === "utc" ? " UTC" : ""}`}
                            . Rows below may be out of date.
                        </p>
                    )}

                    <div
                        role="log"
                        aria-live="off"
                        aria-label="Live events. Pause to read without the list moving."
                        className={`min-h-[320px] max-h-[calc(100vh-320px)] overflow-y-auto transition-opacity ${stale && events.length > 0 ? "opacity-60" : ""}`}
                    >
                        {events.length === 0 ? (
                            refusal ? null : (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    {status === "connected" ? (
                                        <>
                                            <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin mb-3" aria-hidden />
                                            <p className="text-sm">Connected — waiting for events…</p>
                                        </>
                                    ) : status === "connecting" || status === "reconnecting" ? (
                                        <>
                                            <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin mb-3" aria-hidden />
                                            <p className="text-sm">{status === "connecting" ? "Connecting…" : "Reconnecting…"}</p>
                                        </>
                                    ) : status === "offline" ? (
                                        <>
                                            <FontAwesomeIcon icon={faPlug} className="text-2xl mb-3" aria-hidden />
                                            <p className="text-sm">You&apos;re offline. The stream resumes when the network returns.</p>
                                        </>
                                    ) : (
                                        <>
                                            <FontAwesomeIcon icon={faPlug} className="text-2xl mb-3" aria-hidden />
                                            <p className="text-sm">Disconnected. Click Connect to start streaming.</p>
                                        </>
                                    )}
                                </div>
                            )
                        ) : visible.length === 0 ? (
                            <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                None of the {events.length} buffered events match “{search}”.
                            </p>
                        ) : (
                            visible.map(({ le, snippet }) => renderRow(le, "s", snippet, terms))
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

export default function LivePage() {
    // No Suspense boundary of its own: the one `useSearchParams` caller above
    // is `useUrlState` (for the filters), and `[zone]/layout.tsx` already
    // wraps every zone page in one.
    return <LiveTail />;
}
