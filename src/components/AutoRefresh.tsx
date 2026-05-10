"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";

interface AutoRefreshProps {
    onRefresh: () => void;
    loading?: boolean;
}

const INTERVALS = [
    { label: "Off", seconds: 0 },
    { label: "10s", seconds: 10 },
    { label: "30s", seconds: 30 },
    { label: "1m", seconds: 60 },
    { label: "5m", seconds: 300 },
];

export function AutoRefresh({ onRefresh, loading }: AutoRefreshProps) {
    const [intervalSeconds, setIntervalSeconds] = useState(0);
    const [open, setOpen] = useState(false);
    const [remaining, setRemaining] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
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
        if (intervalSeconds <= 0) {
            setRemaining(0);
            return;
        }

        setRemaining(intervalSeconds);

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
    }, [intervalSeconds, onRefresh, clearTimers]);

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

    const activeLabel = INTERVALS.find((i) => i.seconds === intervalSeconds)?.label ?? "Off";
    const progress = intervalSeconds > 0 ? remaining / intervalSeconds : 0;

    // SVG circle parameters
    const radius = 7;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progress);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
            >
                {intervalSeconds > 0 ? (
                    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
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
                <span className="text-xs">{activeLabel}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 py-1">
                    {INTERVALS.map((item) => (
                        <button
                            key={item.label}
                            onClick={() => {
                                setIntervalSeconds(item.seconds);
                                setOpen(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
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
