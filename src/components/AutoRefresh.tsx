"use client";

import { useState, useEffect, useEffectEvent, useRef, useId, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faPause } from "@fortawesome/free-solid-svg-icons";
import { usePageVisible } from "@/hooks/usePageVisible";

interface AutoRefreshProps {
    onRefresh: () => void;
    /**
     * Whether the page's refresh is IN FLIGHT right now, not merely whether it
     * has data. A tick that comes due while this is true is skipped. See below.
     */
    loading?: boolean;
    /**
     * Controlled interval, in seconds (0 = off). Pass it with
     * `onIntervalChange` to keep the choice somewhere that survives a reload —
     * the events page keeps it in the URL. Uncontrolled when omitted.
     */
    interval?: number;
    onIntervalChange?: (seconds: number) => void;
    /**
     * Holds the timer without forgetting the interval — e.g. while a detail
     * panel is open, where a refresh would reshuffle the rows being stepped
     * through. The trigger says "Paused" so the stopped countdown is explained.
     */
    paused?: boolean;
    /**
     * Shortest interval offered, in seconds; "Off" is always offered. A page
     * reading a long range drops the fast ticks — 10s over 30 days reruns every
     * slow query six times a minute. A current interval below the floor (a saved
     * URL, a range just widened) reads as Off and stops ticking, rather than
     * running at a speed the menu no longer lists. Defaults to every option.
     */
    minSeconds?: number;
}

export const INTERVALS = [
    { label: "Off", seconds: 0 },
    { label: "10s", seconds: 10 },
    { label: "30s", seconds: 30 },
    { label: "1m", seconds: 60 },
    { label: "5m", seconds: 300 },
];

/**
 * The auto-refresh picker, and the timer behind it.
 *
 * ⚠️ A TICK IS SKIPPED, NOT QUEUED, WHILE THE PREVIOUS REFRESH IS IN FLIGHT.
 * The events page and the dashboard guard their fetch with a latest-wins
 * generation, so a new refresh DISCARDS the one before it. When a refresh took
 * at least the interval (a 30-day dashboard on a 10 s tick), every tick
 * superseded the last one just before it landed: the panels never loaded, while
 * the ClickHouse queries piled up behind them. Skipping lets the slow refresh
 * land, and the next attempt comes one full interval later.
 *
 * ⚠️ NOTHING TICKS WHILE THE TAB IS HIDDEN (usePageVisible). The countdown stops
 * with the timer; coming back to the tab refreshes ONCE, immediately (the data
 * is as old as the absence), through the same in-flight check, and restarts the
 * countdown from full. Coming back while `paused`, that one refresh waits for
 * the pause to end.
 *
 * One 1-second timer drives both the ring and the refresh, so what the ring
 * shows is when the refresh actually fires. `onRefresh` and `loading` are read
 * when a tick fires, not as timer dependencies, so a page recreating its
 * callback (every filter change does) no longer restarts the countdown.
 */
export function AutoRefresh({
    onRefresh,
    loading,
    interval,
    onIntervalChange,
    paused = false,
    minSeconds = 0,
}: AutoRefreshProps) {
    const [ownInterval, setOwnInterval] = useState(0);
    const options = INTERVALS.filter((i) => i.seconds === 0 || i.seconds >= minSeconds);
    const requested = interval ?? ownInterval;
    const intervalSeconds = requested > 0 && requested < minSeconds ? 0 : requested;
    const setIntervalSeconds = (seconds: number) => {
        if (onIntervalChange) onIntervalChange(seconds);
        if (interval === undefined) setOwnInterval(seconds);
    };
    const [open, setOpen] = useState(false);
    const [remaining, setRemaining] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const menuId = useId();
    const visible = usePageVisible();
    /** Set while auto-refresh is on and the tab is hidden: the next show refreshes once. */
    const missedRef = useRef(false);

    const tick = useEffectEvent(() => {
        if (loading) return;
        onRefresh();
    });

    // Puts the ring back to full whenever the timer (re)starts and, after the
    // tab was hidden, refreshes once.
    const restart = useEffectEvent((refreshNow: boolean) => {
        setRemaining(intervalSeconds);
        if (refreshNow) tick();
    });

    useEffect(() => {
        if (intervalSeconds <= 0) {
            missedRef.current = false;
            return;
        }
        if (!visible) {
            missedRef.current = true;
            return;
        }
        if (paused) return;
        restart(missedRef.current);
        missedRef.current = false;

        let left = intervalSeconds;
        const timer = setInterval(() => {
            left -= 1;
            if (left <= 0) {
                left = intervalSeconds;
                tick();
            }
            setRemaining(left);
        }, 1000);
        return () => clearInterval(timer);
    }, [intervalSeconds, paused, visible]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        if (open) {
            document.addEventListener("mousedown", handleClick);
            return () => document.removeEventListener("mousedown", handleClick);
        }
    }, [open]);

    // Focus the checked item when the menu opens, so arrows start from it.
    useEffect(() => {
        if (!open) return;
        const index = Math.max(0, options.findIndex((i) => i.seconds === intervalSeconds));
        itemRefs.current[index]?.focus();
        // Only on open: moving focus again when the value changes would fight the arrows.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            items[(current + step + items.length) % items.length]?.focus();
        } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            items[e.key === "Home" ? 0 : items.length - 1]?.focus();
        } else if (e.key === "Tab") {
            setOpen(false);
        }
    };

    const activeLabel = options.find((i) => i.seconds === intervalSeconds)?.label ?? "Off";
    const isPaused = paused && intervalSeconds > 0;
    const progress = intervalSeconds > 0 ? remaining / intervalSeconds : 0;

    // SVG circle parameters
    const radius = 7;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progress);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                ref={triggerRef}
                onClick={() => setOpen(!open)}
                onKeyDown={(e) => {
                    if (e.key === "Escape" && open) {
                        e.stopPropagation();
                        setOpen(false);
                    }
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={`Auto-refresh: ${isPaused ? `${activeLabel}, paused` : activeLabel}`}
                title={isPaused ? "Auto-refresh is paused while an event is open" : "Auto-refresh"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
            >
                {isPaused ? (
                    <FontAwesomeIcon icon={faPause} className="text-xs" />
                ) : intervalSeconds > 0 ? (
                    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0" aria-hidden>
                        <circle
                            cx="9"
                            cy="9"
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            opacity="0.2"
                        />
                        <circle
                            cx="9"
                            cy="9"
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            transform="rotate(-90 9 9)"
                            className="transition-all duration-1000 linear"
                        />
                    </svg>
                ) : (
                    <FontAwesomeIcon
                        icon={faArrowsRotate}
                        className={`text-xs ${loading ? "animate-spin" : ""}`}
                    />
                )}
                <span className="text-xs">{isPaused ? "Paused" : activeLabel}</span>
                <svg aria-hidden className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div
                    id={menuId}
                    role="menu"
                    aria-label="Auto-refresh interval"
                    onKeyDown={onMenuKeyDown}
                    className="absolute right-0 mt-1 w-32 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 py-1"
                >
                    {options.map((item, index) => (
                        <button
                            key={item.label}
                            ref={(el) => {
                                itemRefs.current[index] = el;
                            }}
                            role="menuitemradio"
                            aria-checked={intervalSeconds === item.seconds}
                            onClick={() => {
                                setIntervalSeconds(item.seconds);
                                setRemaining(item.seconds);
                                close();
                            }}
                            className={`w-full text-left px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800 ${
                                intervalSeconds === item.seconds
                                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
