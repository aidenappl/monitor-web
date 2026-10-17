"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs`, so "firing for 4m" and
 * "notified 2m ago" keep moving while the page is open — and render stays pure.
 */
export function useNow(intervalMs = 30_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(id);
    }, [intervalMs]);
    return now;
}
