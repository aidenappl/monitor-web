"use client";

import { useState, useEffect, useRef, useCallback, useId, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faPause } from "@fortawesome/free-solid-svg-icons";

interface AutoRefreshProps {
    onRefresh: () => void;
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
}

export const INTERVALS = [
    { label: "Off", seconds: 0 },
    { label: "10s", seconds: 10 },
    { label: "30s", seconds: 30 },
    { label: "1m", seconds: 60 },
    { label: "5m", seconds: 300 },
];

export function AutoRefresh({
    onRefresh,
    loading,
    interval,
    onIntervalChange,
    paused = false,
}: AutoRefreshProps) {
    const [ownInterval, setOwnInterval] = useState(0);
    const intervalSeconds = interval ?? ownInterval;
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
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearTimers = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
        }
    }, []);

    useEffect(() => {
        clearTimers();
        if (intervalSeconds <= 0 || paused) {
            return;
        }

        countdownRef.current = setInterval(() => {
            setRemaining((prev) => {
                if (prev <= 1) return intervalSeconds;
                return prev - 1;
            });
        }, 1000);

        timerRef.current = setInterval(() => {
            onRefresh();
        }, intervalSeconds * 1000);

        return clearTimers;
    }, [intervalSeconds, paused, onRefresh, clearTimers]);

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
        const index = Math.max(0, INTERVALS.findIndex((i) => i.seconds === intervalSeconds));
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

    const activeLabel = INTERVALS.find((i) => i.seconds === intervalSeconds)?.label ?? "Off";
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
                    {INTERVALS.map((item, index) => (
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
